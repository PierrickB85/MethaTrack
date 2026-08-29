"""MethaTrack backend regression suite — auth, RBAC, sites, equipments, stock, failures, analyses, maintenance, dashboard."""
import os
import pytest
import requests
from datetime import datetime, timezone, timedelta
from dotenv import dotenv_values

from conftest import BASE_URL, ADMIN, TECH, VIEWER


# ---------------- Health / Auth ----------------
class TestHealthAndAuth:
    def test_root(self, api_client):
        r = api_client.get(f"{BASE_URL}/api/", timeout=30)
        assert r.status_code == 200
        assert r.json()["status"] == "ok"

    def test_admin_login_returns_token_and_cookies(self, api_client):
        r = api_client.post(f"{BASE_URL}/api/auth/login", json=ADMIN, timeout=30)
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["email"] == ADMIN["email"].lower()
        assert d["role"] == "admin"
        assert isinstance(d["token"], str) and len(d["token"]) > 20
        assert isinstance(d["site_ids"], list) and len(d["site_ids"]) >= 2
        # httpOnly cookies
        cookie_header = "; ".join(r.headers.get_all("Set-Cookie")) if hasattr(r.headers, "get_all") else r.headers.get("Set-Cookie", "")
        assert "access_token" in cookie_header
        assert "HttpOnly" in cookie_header or "httponly" in cookie_header.lower()
        assert "access_token" in r.cookies
        assert "refresh_token" in r.cookies

    def test_login_bad_password(self, api_client):
        r = api_client.post(f"{BASE_URL}/api/auth/login", json={"email": ADMIN["email"], "password": "wrong"}, timeout=30)
        assert r.status_code == 401
        assert "detail" in r.json()

    def test_login_unknown_email(self, api_client):
        r = api_client.post(f"{BASE_URL}/api/auth/login", json={"email": "nobody@nowhere.fr", "password": "x"}, timeout=30)
        assert r.status_code == 401

    def test_me_with_bearer(self, admin_client):
        r = admin_client.get(f"{BASE_URL}/api/auth/me", timeout=30)
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["email"] == ADMIN["email"].lower()
        assert d["role"] == "admin"
        assert "password_hash" not in d
        assert "_id" not in d
        assert isinstance(d["id"], str)

    def test_me_without_token(self, api_client):
        r = requests.get(f"{BASE_URL}/api/auth/me", timeout=30)
        assert r.status_code == 401

    def test_me_with_invalid_token(self):
        r = requests.get(f"{BASE_URL}/api/auth/me", headers={"Authorization": "Bearer garbage.token.here"}, timeout=30)
        assert r.status_code == 401

    def test_refresh_with_cookie(self, api_client):
        s = requests.Session()
        r = s.post(f"{BASE_URL}/api/auth/login", json=ADMIN, timeout=30)
        assert r.status_code == 200
        r2 = s.post(f"{BASE_URL}/api/auth/refresh", timeout=30)
        assert r2.status_code == 200, r2.text
        assert r2.json()["ok"] is True

    def test_refresh_without_cookie(self):
        r = requests.post(f"{BASE_URL}/api/auth/refresh", timeout=30)
        assert r.status_code == 401

    def test_logout(self, api_client):
        s = requests.Session()
        s.post(f"{BASE_URL}/api/auth/login", json=ADMIN, timeout=30)
        r = s.post(f"{BASE_URL}/api/auth/logout", timeout=30)
        assert r.status_code == 200
        assert r.json()["ok"] is True

    def test_bcrypt_hash_format(self):
        """Verify stored password hash uses $2b$ bcrypt format (direct DB check)."""
        import asyncio
        from motor.motor_asyncio import AsyncIOMotorClient
        env = dotenv_values("/app/backend/.env")

        async def _check():
            cl = AsyncIOMotorClient(env["MONGO_URL"])
            u = await cl[env["DB_NAME"]].users.find_one({"email": ADMIN["email"].lower()})
            cl.close()
            return u

        u = asyncio.get_event_loop().run_until_complete(_check()) if False else asyncio.run(_check())
        assert u is not None, "Admin user not seeded"
        assert u["password_hash"].startswith("$2b$"), f"Unexpected hash prefix: {u['password_hash'][:4]}"

    def test_brute_force_lockout(self, api_client):
        """Playbook: account should lock after 5 failed attempts."""
        email = "lockout_probe@methatrack.fr"
        codes = []
        for _ in range(7):
            r = requests.post(f"{BASE_URL}/api/auth/login", json={"email": email, "password": "bad"}, timeout=30)
            codes.append(r.status_code)
        assert 423 in codes or 429 in codes, f"No lockout/rate-limit observed after 7 failures: {codes}"

    def test_cors_credentials_on_actual_request(self):
        """Actual (non-preflight) CORS headers must allow credentials.
        NOTE: OPTIONS preflight is answered by the ingress/CDN, not the app, so only the
        actual request headers are asserted here."""
        r = requests.post(f"{BASE_URL}/api/auth/login",
                          json={"email": ADMIN["email"], "password": "wrong"},
                          headers={"Origin": BASE_URL}, timeout=30)
        assert r.headers.get("access-control-allow-credentials") == "true", dict(r.headers)
        assert r.headers.get("access-control-allow-origin") is not None


# ---------------- Sites ----------------
class TestSites:
    def test_list_sites_admin(self, admin_client):
        r = admin_client.get(f"{BASE_URL}/api/sites", timeout=30)
        assert r.status_code == 200
        data = r.json()
        assert len(data) >= 2
        names = [s["name"] for s in data]
        assert any("Nord" in n for n in names)
        assert any("Sud" in n for n in names)
        for s in data:
            assert "_id" not in s and "id" in s

    def test_list_sites_technicien_scoped(self, tech_client):
        r = tech_client.get(f"{BASE_URL}/api/sites", timeout=30)
        assert r.status_code == 200
        data = r.json()
        assert len(data) == 1, f"Technicien should see 1 site, got {len(data)}"
        assert "Nord" in data[0]["name"]

    def test_create_update_delete_site(self, admin_client):
        payload = {"name": "TEST_Site QA", "location": "Nantes, FR", "capacity_kw": 250}
        r = admin_client.post(f"{BASE_URL}/api/sites", json=payload, timeout=30)
        assert r.status_code == 200, r.text
        sid = r.json()["id"]
        try:
            g = admin_client.get(f"{BASE_URL}/api/sites", timeout=30)
            found = [s for s in g.json() if s["id"] == sid]
            assert found, "Created site not persisted"
            assert found[0]["name"] == payload["name"]
            assert found[0]["capacity_kw"] == 250

            p = admin_client.patch(f"{BASE_URL}/api/sites/{sid}", json={**payload, "location": "Brest, FR"}, timeout=30)
            assert p.status_code == 200
            g2 = admin_client.get(f"{BASE_URL}/api/sites", timeout=30)
            assert [s for s in g2.json() if s["id"] == sid][0]["location"] == "Brest, FR"
        finally:
            d = admin_client.delete(f"{BASE_URL}/api/sites/{sid}", timeout=30)
            assert d.status_code == 200
        g3 = admin_client.get(f"{BASE_URL}/api/sites", timeout=30)
        assert not [s for s in g3.json() if s["id"] == sid]

    def test_create_site_forbidden_for_tech(self, tech_client):
        r = tech_client.post(f"{BASE_URL}/api/sites", json={"name": "TEST_nope"}, timeout=30)
        assert r.status_code == 403


# ---------------- Equipments ----------------
class TestEquipments:
    def test_list_all_and_filtered(self, admin_client, sites):
        r = admin_client.get(f"{BASE_URL}/api/equipments", timeout=30)
        assert r.status_code == 200
        all_eq = r.json()
        assert len(all_eq) >= 5
        sid = sites[0]["id"]
        r2 = admin_client.get(f"{BASE_URL}/api/equipments", params={"site_id": sid}, timeout=30)
        assert r2.status_code == 200
        filtered = r2.json()
        assert len(filtered) > 0
        assert all(e["site_id"] == sid for e in filtered)
        assert len(filtered) < len(all_eq)

    def test_get_single_equipment(self, admin_client):
        eqs = admin_client.get(f"{BASE_URL}/api/equipments", timeout=30).json()
        eid = eqs[0]["id"]
        r = admin_client.get(f"{BASE_URL}/api/equipments/{eid}", timeout=30)
        assert r.status_code == 200
        assert r.json()["id"] == eid
        assert "photos" in r.json()

    def test_get_equipment_bad_id(self, admin_client):
        r = admin_client.get(f"{BASE_URL}/api/equipments/notanid", timeout=30)
        assert r.status_code == 400
        r2 = admin_client.get(f"{BASE_URL}/api/equipments/507f1f77bcf86cd799439011", timeout=30)
        assert r2.status_code == 404

    def test_tech_site_scoping(self, tech_client, sites):
        r = tech_client.get(f"{BASE_URL}/api/equipments", timeout=30)
        assert r.status_code == 200
        tech_site = tech_client.get(f"{BASE_URL}/api/sites", timeout=30).json()[0]["id"]
        assert all(e["site_id"] == tech_site for e in r.json())
        other = [s["id"] for s in sites if s["id"] != tech_site][0]
        r2 = tech_client.get(f"{BASE_URL}/api/equipments", params={"site_id": other}, timeout=30)
        assert r2.status_code == 403

    def test_crud_equipment(self, admin_client, sites):
        sid = sites[0]["id"]
        payload = {"site_id": sid, "name": "TEST_Pompe QA", "type": "Pompe", "serial": "QA-1", "installed_at": "2024-01-01", "notes": "qa"}
        r = admin_client.post(f"{BASE_URL}/api/equipments", json=payload, timeout=30)
        assert r.status_code == 200, r.text
        eid = r.json()["id"]
        try:
            g = admin_client.get(f"{BASE_URL}/api/equipments/{eid}", timeout=30)
            assert g.status_code == 200
            assert g.json()["name"] == "TEST_Pompe QA"
            assert g.json()["serial"] == "QA-1"
            admin_client.patch(f"{BASE_URL}/api/equipments/{eid}", json={**payload, "name": "TEST_Pompe QA2"}, timeout=30)
            assert admin_client.get(f"{BASE_URL}/api/equipments/{eid}", timeout=30).json()["name"] == "TEST_Pompe QA2"
        finally:
            admin_client.delete(f"{BASE_URL}/api/equipments/{eid}", timeout=30)
        assert admin_client.get(f"{BASE_URL}/api/equipments/{eid}", timeout=30).status_code == 404

    def test_viewer_cannot_create_equipment(self, viewer_client, sites):
        r = viewer_client.post(f"{BASE_URL}/api/equipments", json={"site_id": sites[0]["id"], "name": "TEST_x", "type": "t"}, timeout=30)
        assert r.status_code == 403

    def test_tech_cannot_patch_equipment_of_other_site(self, tech_client, admin_client, sites):
        """RBAC HOLE: PATCH /api/equipments/{id} never validates the target's current site."""
        tech_site = tech_client.get(f"{BASE_URL}/api/sites", timeout=30).json()[0]["id"]
        other = [s["id"] for s in sites if s["id"] != tech_site][0]
        eq = admin_client.post(f"{BASE_URL}/api/equipments", json={
            "site_id": other, "name": "TEST_rbac patch probe", "type": "Pompe"}, timeout=30).json()
        eid = eq["id"]
        try:
            r = tech_client.patch(f"{BASE_URL}/api/equipments/{eid}", json={
                "site_id": other, "name": "TEST_HACKED", "type": "Pompe"}, timeout=30)
            assert r.status_code == 403, (
                f"Technicien modified an equipment of a non-assigned site (status {r.status_code}); "
                f"name is now {admin_client.get(f'{BASE_URL}/api/equipments/{eid}', timeout=30).json()['name']}")
        finally:
            admin_client.delete(f"{BASE_URL}/api/equipments/{eid}", timeout=30)


# ---------------- Parts / Stock ----------------
class TestStock:
    def test_list_parts(self, admin_client, sites):
        r = admin_client.get(f"{BASE_URL}/api/parts", timeout=30)
        assert r.status_code == 200
        assert len(r.json()) >= 5
        sid = sites[0]["id"]
        r2 = admin_client.get(f"{BASE_URL}/api/parts", params={"site_id": sid}, timeout=30)
        assert all(p["site_id"] == sid for p in r2.json())

    def test_tech_parts_scoped(self, tech_client):
        r = tech_client.get(f"{BASE_URL}/api/parts", timeout=30)
        assert r.status_code == 200
        tech_site = tech_client.get(f"{BASE_URL}/api/sites", timeout=30).json()[0]["id"]
        assert all(p["site_id"] == tech_site for p in r.json())

    def test_list_movements(self, admin_client, sites):
        r = admin_client.get(f"{BASE_URL}/api/stock-movements", timeout=30)
        assert r.status_code == 200
        assert isinstance(r.json(), list)
        r2 = admin_client.get(f"{BASE_URL}/api/stock-movements", params={"site_id": sites[0]["id"]}, timeout=30)
        assert r2.status_code == 200

    def test_movements_kinds_update_quantity(self, admin_client, sites):
        sid = sites[0]["id"]
        r = admin_client.post(f"{BASE_URL}/api/parts", json={
            "site_id": sid, "name": "TEST_Part Stock", "sku": "TEST-SKU-1",
            "quantity": 10, "threshold": 2, "price": 5.0, "supplier": "QA", "location": "QA"}, timeout=30)
        assert r.status_code == 200, r.text
        pid = r.json()["id"]
        try:
            # entree +5 => 15
            m = admin_client.post(f"{BASE_URL}/api/stock-movements", json={"part_id": pid, "kind": "entree", "quantity": 5, "reason": "TEST entree"}, timeout=30)
            assert m.status_code == 200, m.text
            assert m.json()["new_quantity"] == 15
            # sortie -3 => 12
            m = admin_client.post(f"{BASE_URL}/api/stock-movements", json={"part_id": pid, "kind": "sortie", "quantity": 3, "reason": "TEST sortie"}, timeout=30)
            assert m.json()["new_quantity"] == 12
            # ajustement signed -2 => 10
            m = admin_client.post(f"{BASE_URL}/api/stock-movements", json={"part_id": pid, "kind": "ajustement", "quantity": -2, "reason": "TEST ajust"}, timeout=30)
            assert m.status_code == 200, m.text
            assert m.json()["new_quantity"] == 10
            # persisted
            parts = admin_client.get(f"{BASE_URL}/api/parts", params={"site_id": sid}, timeout=30).json()
            assert [p for p in parts if p["id"] == pid][0]["quantity"] == 10
            # movements listed for that part
            mv = admin_client.get(f"{BASE_URL}/api/stock-movements", params={"part_id": pid}, timeout=30).json()
            assert len(mv) == 3, f"expected 3 movements, got {len(mv)}"
            assert {x["kind"] for x in mv} == {"entree", "sortie", "ajustement"}
            assert all("_id" not in x for x in mv)
            # insufficient stock
            bad = admin_client.post(f"{BASE_URL}/api/stock-movements", json={"part_id": pid, "kind": "sortie", "quantity": 9999}, timeout=30)
            assert bad.status_code == 400
            # invalid kind
            bad2 = admin_client.post(f"{BASE_URL}/api/stock-movements", json={"part_id": pid, "kind": "bogus", "quantity": 1}, timeout=30)
            assert bad2.status_code == 422
        finally:
            admin_client.delete(f"{BASE_URL}/api/parts/{pid}", timeout=30)

    def test_movement_unknown_part(self, admin_client):
        r = admin_client.post(f"{BASE_URL}/api/stock-movements", json={"part_id": "507f1f77bcf86cd799439011", "kind": "entree", "quantity": 1}, timeout=30)
        assert r.status_code == 404

    def test_viewer_cannot_move_stock(self, viewer_client, admin_client):
        parts = admin_client.get(f"{BASE_URL}/api/parts", timeout=30).json()
        r = viewer_client.post(f"{BASE_URL}/api/stock-movements", json={"part_id": parts[0]["id"], "kind": "entree", "quantity": 1}, timeout=30)
        assert r.status_code == 403


# ---------------- Failures ----------------
class TestFailures:
    def test_list_failures_and_filters(self, admin_client, sites):
        r = admin_client.get(f"{BASE_URL}/api/failures", timeout=30)
        assert r.status_code == 200
        assert len(r.json()) >= 3
        r2 = admin_client.get(f"{BASE_URL}/api/failures", params={"severity": "critique"}, timeout=30)
        assert all(f["severity"] == "critique" for f in r2.json())
        r3 = admin_client.get(f"{BASE_URL}/api/failures", params={"status": "resolu"}, timeout=30)
        assert all(f["status"] == "resolu" for f in r3.json())

    def test_create_failure_decrements_stock(self, admin_client, sites):
        sid = sites[0]["id"]
        eq = admin_client.get(f"{BASE_URL}/api/equipments", params={"site_id": sid}, timeout=30).json()[0]
        pr = admin_client.post(f"{BASE_URL}/api/parts", json={
            "site_id": sid, "name": "TEST_Part Failure", "sku": "TEST-SKU-2",
            "quantity": 20, "threshold": 2, "price": 10.0}, timeout=30)
        pid = pr.json()["id"]
        fid = None
        try:
            payload = {
                "site_id": sid, "equipment_id": eq["id"],
                "date": datetime.now(timezone.utc).isoformat(),
                "type": "Mécanique", "severity": "moyenne", "status": "ouvert",
                "description": "TEST_panne QA", "cause": "c", "action": "a",
                "duration_hours": 2, "cost": 99.5, "responsible": "QA",
                "parts_used": [{"part_id": pid, "quantity": 4}],
            }
            r = admin_client.post(f"{BASE_URL}/api/failures", json=payload, timeout=30)
            assert r.status_code == 200, r.text
            fid = r.json()["id"]
            # verify persisted
            lst = admin_client.get(f"{BASE_URL}/api/failures", params={"site_id": sid}, timeout=30).json()
            got = [f for f in lst if f["id"] == fid]
            assert got, "Failure not persisted"
            assert got[0]["description"] == "TEST_panne QA"
            assert got[0]["cost"] == 99.5
            assert got[0]["parts_used"] == [{"part_id": pid, "quantity": 4}]
            # stock decremented
            parts = admin_client.get(f"{BASE_URL}/api/parts", params={"site_id": sid}, timeout=30).json()
            assert [p for p in parts if p["id"] == pid][0]["quantity"] == 16
            # movement created with failure link
            mv = admin_client.get(f"{BASE_URL}/api/stock-movements", params={"part_id": pid}, timeout=30).json()
            assert len(mv) == 1
            assert mv[0]["kind"] == "sortie"
            assert mv[0]["failure_id"] == fid
            # update failure
            up = admin_client.patch(f"{BASE_URL}/api/failures/{fid}", json={**payload, "status": "resolu", "parts_used": []}, timeout=30)
            assert up.status_code == 200
            lst2 = admin_client.get(f"{BASE_URL}/api/failures", params={"site_id": sid}, timeout=30).json()
            assert [f for f in lst2 if f["id"] == fid][0]["status"] == "resolu"
        finally:
            if fid:
                admin_client.delete(f"{BASE_URL}/api/failures/{fid}", timeout=30)
            admin_client.delete(f"{BASE_URL}/api/parts/{pid}", timeout=30)

    def test_invalid_severity_rejected(self, admin_client, sites):
        r = admin_client.post(f"{BASE_URL}/api/failures", json={
            "site_id": sites[0]["id"], "equipment_id": "x", "date": "2026-01-01",
            "type": "t", "severity": "enorme", "status": "ouvert", "description": "d"}, timeout=30)
        assert r.status_code == 422

    def test_viewer_cannot_create_failure(self, viewer_client, sites):
        r = viewer_client.post(f"{BASE_URL}/api/failures", json={
            "site_id": sites[0]["id"], "equipment_id": "x",
            "date": datetime.now(timezone.utc).isoformat(),
            "type": "t", "severity": "faible", "status": "ouvert", "description": "d"}, timeout=30)
        assert r.status_code == 403

    def test_tech_cannot_delete_failure_of_other_site(self, tech_client, admin_client, sites):
        """RBAC HOLE: DELETE /api/failures/{id} does not verify site ownership."""
        tech_site = tech_client.get(f"{BASE_URL}/api/sites", timeout=30).json()[0]["id"]
        other = [s["id"] for s in sites if s["id"] != tech_site][0]
        eq = admin_client.get(f"{BASE_URL}/api/equipments", params={"site_id": other}, timeout=30).json()[0]
        created = admin_client.post(f"{BASE_URL}/api/failures", json={
            "site_id": other, "equipment_id": eq["id"],
            "date": datetime.now(timezone.utc).isoformat(),
            "type": "Process", "severity": "faible", "status": "ouvert",
            "description": "TEST_rbac delete probe"}, timeout=30)
        fid = created.json()["id"]
        try:
            r = tech_client.delete(f"{BASE_URL}/api/failures/{fid}", timeout=30)
            assert r.status_code == 403, f"Technicien deleted a failure of a non-assigned site (status {r.status_code})"
        finally:
            admin_client.delete(f"{BASE_URL}/api/failures/{fid}", timeout=30)

    def test_tech_cannot_create_failure_other_site(self, tech_client, sites):
        tech_site = tech_client.get(f"{BASE_URL}/api/sites", timeout=30).json()[0]["id"]
        other = [s["id"] for s in sites if s["id"] != tech_site][0]
        r = tech_client.post(f"{BASE_URL}/api/failures", json={
            "site_id": other, "equipment_id": "x",
            "date": datetime.now(timezone.utc).isoformat(),
            "type": "t", "severity": "faible", "status": "ouvert", "description": "d"}, timeout=30)
        assert r.status_code == 403


# ---------------- Analyses ----------------
class TestAnalyses:
    def test_list_analyses(self, admin_client, sites):
        r = admin_client.get(f"{BASE_URL}/api/analyses", timeout=30)
        assert r.status_code == 200
        assert len(r.json()) >= 5
        sid = sites[0]["id"]
        r2 = admin_client.get(f"{BASE_URL}/api/analyses", params={"site_id": sid}, timeout=30)
        assert all(a["site_id"] == sid for a in r2.json())

    def test_create_and_delete_analysis(self, admin_client, sites):
        sid = sites[0]["id"]
        payload = {"site_id": sid, "date": datetime.now(timezone.utc).isoformat(),
                   "ph": 7.8, "ms": 4.5, "mo": 70.0, "agv": 1.5, "tac": 13.0,
                   "n_nh4": 2.2, "n_total": 5.0, "p2o5": 1.7, "k2o": 3.3, "notes": "TEST_analyse"}
        r = admin_client.post(f"{BASE_URL}/api/analyses", json=payload, timeout=30)
        assert r.status_code == 200, r.text
        aid = r.json()["id"]
        try:
            lst = admin_client.get(f"{BASE_URL}/api/analyses", params={"site_id": sid}, timeout=30).json()
            got = [a for a in lst if a["id"] == aid]
            assert got, "Analysis not persisted"
            assert got[0]["ph"] == 7.8
            assert got[0]["notes"] == "TEST_analyse"
            up = admin_client.patch(f"{BASE_URL}/api/analyses/{aid}", json={**payload, "ph": 8.1}, timeout=30)
            assert up.status_code == 200
            lst2 = admin_client.get(f"{BASE_URL}/api/analyses", params={"site_id": sid}, timeout=30).json()
            assert [a for a in lst2 if a["id"] == aid][0]["ph"] == 8.1
        finally:
            d = admin_client.delete(f"{BASE_URL}/api/analyses/{aid}", timeout=30)
            assert d.status_code == 200

    def test_viewer_cannot_create_analysis(self, viewer_client, sites):
        r = viewer_client.post(f"{BASE_URL}/api/analyses", json={
            "site_id": sites[0]["id"], "date": "2026-01-01", "ph": 7, "ms": 1, "mo": 1,
            "agv": 1, "tac": 1, "n_nh4": 1, "n_total": 1, "p2o5": 1, "k2o": 1}, timeout=30)
        assert r.status_code == 403


# ---------------- Maintenance ----------------
class TestMaintenance:
    def test_list_maintenance(self, admin_client):
        r = admin_client.get(f"{BASE_URL}/api/maintenance", timeout=30)
        assert r.status_code == 200
        assert len(r.json()) >= 1

    def test_full_maintenance_flow(self, admin_client, sites):
        sid = sites[0]["id"]
        eq = admin_client.get(f"{BASE_URL}/api/equipments", params={"site_id": sid}, timeout=30).json()[0]
        next_due = (datetime.now(timezone.utc) + timedelta(days=5)).isoformat()
        payload = {"site_id": sid, "equipment_id": eq["id"], "title": "TEST_Maint QA",
                   "frequency_days": 15, "next_due": next_due, "notes": "qa"}
        r = admin_client.post(f"{BASE_URL}/api/maintenance", json=payload, timeout=30)
        assert r.status_code == 200, r.text
        mid = r.json()["id"]
        try:
            lst = admin_client.get(f"{BASE_URL}/api/maintenance", params={"site_id": sid}, timeout=30).json()
            task = [t for t in lst if t["id"] == mid][0]
            assert task["frequency_days"] == 15
            assert task["last_done"] is None

            done_at = datetime.now(timezone.utc).replace(microsecond=0)
            c = admin_client.post(f"{BASE_URL}/api/maintenance/{mid}/complete",
                                 json={"done_at": done_at.isoformat(), "notes": "TEST_done"}, timeout=30)
            assert c.status_code == 200, c.text

            lst2 = admin_client.get(f"{BASE_URL}/api/maintenance", params={"site_id": sid}, timeout=30).json()
            t2 = [t for t in lst2 if t["id"] == mid][0]
            assert t2["last_done"] is not None
            expected = (done_at + timedelta(days=15))
            assert datetime.fromisoformat(t2["next_due"]).date() == expected.date(), f"{t2['next_due']} vs {expected}"

            hist = admin_client.get(f"{BASE_URL}/api/maintenance-history", params={"site_id": sid}, timeout=30)
            assert hist.status_code == 200, hist.text
            entries = [h for h in hist.json() if h.get("task_id") == mid]
            assert entries, "Maintenance history entry not created"
            assert entries[0]["notes"] == "TEST_done"
        finally:
            admin_client.delete(f"{BASE_URL}/api/maintenance/{mid}", timeout=30)

    def test_complete_unknown_task(self, admin_client):
        r = admin_client.post(f"{BASE_URL}/api/maintenance/507f1f77bcf86cd799439011/complete",
                              json={"done_at": datetime.now(timezone.utc).isoformat()}, timeout=30)
        assert r.status_code == 404

    def test_viewer_cannot_complete(self, viewer_client, admin_client):
        tasks = admin_client.get(f"{BASE_URL}/api/maintenance", timeout=30).json()
        r = viewer_client.post(f"{BASE_URL}/api/maintenance/{tasks[0]['id']}/complete",
                               json={"done_at": datetime.now(timezone.utc).isoformat()}, timeout=30)
        assert r.status_code == 403


# ---------------- Dashboard ----------------
class TestDashboard:
    def test_summary_admin(self, admin_client):
        r = admin_client.get(f"{BASE_URL}/api/dashboard/summary", timeout=30)
        assert r.status_code == 200, r.text
        d = r.json()
        for k in ["equipments", "failures_total", "failures_open", "failures_critical",
                  "cost_total", "stock_value", "low_stock_count"]:
            assert k in d, f"missing {k}"
        assert d["equipments"] >= 5
        assert d["failures_total"] >= 3
        assert d["stock_value"] > 0
        assert d["low_stock_count"] >= 1

    def test_summary_site_scoped(self, admin_client, sites):
        total = admin_client.get(f"{BASE_URL}/api/dashboard/summary", timeout=30).json()
        s0 = admin_client.get(f"{BASE_URL}/api/dashboard/summary", params={"site_id": sites[0]["id"]}, timeout=30).json()
        assert s0["equipments"] <= total["equipments"]
        assert s0["failures_total"] <= total["failures_total"]

    def test_summary_tech_scoped(self, tech_client):
        r = tech_client.get(f"{BASE_URL}/api/dashboard/summary", timeout=30)
        assert r.status_code == 200
        assert r.json()["equipments"] >= 1


# ---------------- Users / RBAC admin endpoints ----------------
class TestUsersAdmin:
    def test_list_users_admin(self, admin_client):
        r = admin_client.get(f"{BASE_URL}/api/users", timeout=30)
        assert r.status_code == 200
        emails = [u["email"] for u in r.json()]
        assert ADMIN["email"].lower() in emails
        assert TECH["email"] in emails
        assert VIEWER["email"] in emails
        for u in r.json():
            assert "password_hash" not in u

    def test_users_forbidden_for_tech_and_viewer(self, tech_client, viewer_client):
        assert tech_client.get(f"{BASE_URL}/api/users", timeout=30).status_code == 403
        assert viewer_client.get(f"{BASE_URL}/api/users", timeout=30).status_code == 403

    def test_create_update_delete_user(self, admin_client, sites):
        sid = sites[0]["id"]
        payload = {"email": "TEST_qa_user@methatrack.fr", "password": "QaPass2026!",
                   "name": "TEST QA User", "role": "technicien", "site_ids": [sid]}
        r = admin_client.post(f"{BASE_URL}/api/users", json=payload, timeout=30)
        assert r.status_code == 200, r.text
        uid = r.json()["id"]
        try:
            assert r.json()["email"] == payload["email"].lower()
            assert r.json()["role"] == "technicien"
            lst = admin_client.get(f"{BASE_URL}/api/users", timeout=30).json()
            got = [u for u in lst if u["id"] == uid]
            assert got and got[0]["site_ids"] == [sid]
            # new user can log in
            s = requests.Session()
            lr = s.post(f"{BASE_URL}/api/auth/login", json={"email": payload["email"], "password": payload["password"]}, timeout=30)
            assert lr.status_code == 200, lr.text
            assert lr.json()["role"] == "technicien"
            # duplicate email
            dup = admin_client.post(f"{BASE_URL}/api/users", json=payload, timeout=30)
            assert dup.status_code == 400
            # patch role + password
            p = admin_client.patch(f"{BASE_URL}/api/users/{uid}", json={"role": "viewer", "password": "NewPass2026!"}, timeout=30)
            assert p.status_code == 200
            lst2 = admin_client.get(f"{BASE_URL}/api/users", timeout=30).json()
            assert [u for u in lst2 if u["id"] == uid][0]["role"] == "viewer"
            lr2 = requests.post(f"{BASE_URL}/api/auth/login", json={"email": payload["email"], "password": "NewPass2026!"}, timeout=30)
            assert lr2.status_code == 200
        finally:
            d = admin_client.delete(f"{BASE_URL}/api/users/{uid}", timeout=30)
            assert d.status_code == 200
        lst3 = admin_client.get(f"{BASE_URL}/api/users", timeout=30).json()
        assert not [u for u in lst3 if u["id"] == uid]

    def test_create_user_invalid_role(self, admin_client):
        r = admin_client.post(f"{BASE_URL}/api/users", json={
            "email": "TEST_bad@methatrack.fr", "password": "x", "name": "n", "role": "superuser"}, timeout=30)
        assert r.status_code == 422


# ---------------- Files ----------------
class TestFiles:
    def test_file_download_requires_auth(self):
        r = requests.get(f"{BASE_URL}/api/files/some/missing/path.jpg", timeout=30)
        assert r.status_code == 401

    def test_file_download_missing_returns_404(self, admin_client):
        r = admin_client.get(f"{BASE_URL}/api/files/methatrack/does-not-exist.jpg", timeout=30)
        assert r.status_code == 404

"""Iteration-2 regression: site-scope enforcement on mutating endpoints, cascade deletes,
stock-movement filter preservation, health route, brute-force lockout."""
import asyncio
from datetime import datetime, timedelta, timezone

import pytest
import requests
from dotenv import dotenv_values
from motor.motor_asyncio import AsyncIOMotorClient

from conftest import BASE_URL, TECH

ENV = dotenv_values("/app/backend/.env")


def _db_call(coro_fn):
    async def _run():
        cl = AsyncIOMotorClient(ENV["MONGO_URL"])
        try:
            return await coro_fn(cl[ENV["DB_NAME"]])
        finally:
            cl.close()
    return asyncio.run(_run())


@pytest.fixture(scope="module")
def tech_site(tech_client):
    return tech_client.get(f"{BASE_URL}/api/sites", timeout=30).json()[0]["id"]


@pytest.fixture(scope="module")
def other_site(sites, tech_site):
    return [s["id"] for s in sites if s["id"] != tech_site][0]


@pytest.fixture(scope="module")
def other_equipment(admin_client, other_site):
    return admin_client.get(f"{BASE_URL}/api/equipments", params={"site_id": other_site}, timeout=30).json()[0]


# ---------------- Site-scope on every mutating single-doc route ----------------
class TestSiteScopeMutations:
    def test_equipment_patch_delete_forbidden(self, admin_client, tech_client, other_site):
        eq = admin_client.post(f"{BASE_URL}/api/equipments", json={
            "site_id": other_site, "name": "TEST_scope eq", "type": "Pompe"}, timeout=30).json()
        eid = eq["id"]
        try:
            r = tech_client.patch(f"{BASE_URL}/api/equipments/{eid}", json={
                "site_id": other_site, "name": "TEST_HACKED", "type": "Pompe"}, timeout=30)
            assert r.status_code == 403, r.text
            d = tech_client.delete(f"{BASE_URL}/api/equipments/{eid}", timeout=30)
            assert d.status_code == 403, d.text
            # unchanged
            cur = admin_client.get(f"{BASE_URL}/api/equipments/{eid}", timeout=30).json()
            assert cur["name"] == "TEST_scope eq"
        finally:
            admin_client.delete(f"{BASE_URL}/api/equipments/{eid}", timeout=30)

    def test_part_patch_delete_forbidden(self, admin_client, tech_client, other_site):
        p = admin_client.post(f"{BASE_URL}/api/parts", json={
            "site_id": other_site, "name": "TEST_scope part", "sku": "TEST-SCOPE-1",
            "quantity": 5, "threshold": 1, "price": 2.0}, timeout=30).json()
        pid = p["id"]
        try:
            r = tech_client.patch(f"{BASE_URL}/api/parts/{pid}", json={
                "site_id": other_site, "name": "TEST_HACKED", "sku": "TEST-SCOPE-1",
                "quantity": 99, "threshold": 1, "price": 2.0}, timeout=30)
            assert r.status_code == 403, r.text
            d = tech_client.delete(f"{BASE_URL}/api/parts/{pid}", timeout=30)
            assert d.status_code == 403, d.text
            cur = [x for x in admin_client.get(f"{BASE_URL}/api/parts", params={"site_id": other_site}, timeout=30).json() if x["id"] == pid][0]
            assert cur["quantity"] == 5
        finally:
            admin_client.delete(f"{BASE_URL}/api/parts/{pid}", timeout=30)

    def test_failure_patch_delete_forbidden(self, admin_client, tech_client, other_site, other_equipment):
        payload = {"site_id": other_site, "equipment_id": other_equipment["id"],
                   "date": datetime.now(timezone.utc).isoformat(), "type": "Process",
                   "severity": "faible", "status": "ouvert", "description": "TEST_scope failure"}
        f = admin_client.post(f"{BASE_URL}/api/failures", json=payload, timeout=30).json()
        fid = f["id"]
        try:
            r = tech_client.patch(f"{BASE_URL}/api/failures/{fid}", json={**payload, "description": "TEST_HACKED"}, timeout=30)
            assert r.status_code == 403, r.text
            d = tech_client.delete(f"{BASE_URL}/api/failures/{fid}", timeout=30)
            assert d.status_code == 403, d.text
            cur = [x for x in admin_client.get(f"{BASE_URL}/api/failures", params={"site_id": other_site}, timeout=30).json() if x["id"] == fid]
            assert cur and cur[0]["description"] == "TEST_scope failure"
        finally:
            admin_client.delete(f"{BASE_URL}/api/failures/{fid}", timeout=30)

    def test_analysis_patch_delete_forbidden(self, admin_client, tech_client, other_site):
        payload = {"site_id": other_site, "date": datetime.now(timezone.utc).isoformat(),
                   "ph": 7.5, "ms": 4.0, "mo": 65.0, "agv": 1.2, "tac": 12.0,
                   "n_nh4": 2.0, "n_total": 4.5, "p2o5": 1.5, "k2o": 3.0, "notes": "TEST_scope analyse"}
        a = admin_client.post(f"{BASE_URL}/api/analyses", json=payload, timeout=30).json()
        aid = a["id"]
        try:
            r = tech_client.patch(f"{BASE_URL}/api/analyses/{aid}", json={**payload, "ph": 9.9}, timeout=30)
            assert r.status_code == 403, r.text
            d = tech_client.delete(f"{BASE_URL}/api/analyses/{aid}", timeout=30)
            assert d.status_code == 403, d.text
            cur = [x for x in admin_client.get(f"{BASE_URL}/api/analyses", params={"site_id": other_site}, timeout=30).json() if x["id"] == aid][0]
            assert cur["ph"] == 7.5
        finally:
            admin_client.delete(f"{BASE_URL}/api/analyses/{aid}", timeout=30)

    def test_maintenance_patch_complete_delete_forbidden(self, admin_client, tech_client, other_site, other_equipment):
        payload = {"site_id": other_site, "equipment_id": other_equipment["id"],
                   "title": "TEST_scope maint", "frequency_days": 30,
                   "next_due": (datetime.now(timezone.utc) + timedelta(days=3)).isoformat()}
        t = admin_client.post(f"{BASE_URL}/api/maintenance", json=payload, timeout=30).json()
        mid = t["id"]
        try:
            r = tech_client.patch(f"{BASE_URL}/api/maintenance/{mid}", json={**payload, "title": "TEST_HACKED"}, timeout=30)
            assert r.status_code == 403, r.text
            c = tech_client.post(f"{BASE_URL}/api/maintenance/{mid}/complete",
                                 json={"done_at": datetime.now(timezone.utc).isoformat(), "notes": "hack"}, timeout=30)
            assert c.status_code == 403, c.text
            d = tech_client.delete(f"{BASE_URL}/api/maintenance/{mid}", timeout=30)
            assert d.status_code == 403, d.text
            cur = [x for x in admin_client.get(f"{BASE_URL}/api/maintenance", params={"site_id": other_site}, timeout=30).json() if x["id"] == mid][0]
            assert cur["title"] == "TEST_scope maint"
            assert cur["last_done"] is None
        finally:
            admin_client.delete(f"{BASE_URL}/api/maintenance/{mid}", timeout=30)

    def test_cannot_reassign_own_doc_to_foreign_site(self, admin_client, tech_client, tech_site, other_site):
        """Tech owns the doc but tries to move it to a site it does not own => 403."""
        eq = admin_client.post(f"{BASE_URL}/api/equipments", json={
            "site_id": tech_site, "name": "TEST_reassign eq", "type": "Pompe"}, timeout=30).json()
        eid = eq["id"]
        try:
            r = tech_client.patch(f"{BASE_URL}/api/equipments/{eid}", json={
                "site_id": other_site, "name": "TEST_reassign eq", "type": "Pompe"}, timeout=30)
            assert r.status_code == 403, r.text
            cur = admin_client.get(f"{BASE_URL}/api/equipments/{eid}", timeout=30).json()
            assert cur["site_id"] == tech_site
        finally:
            admin_client.delete(f"{BASE_URL}/api/equipments/{eid}", timeout=30)

    def test_tech_can_still_patch_own_site_doc(self, admin_client, tech_client, tech_site):
        """Positive control: scope checks must not break legitimate writes."""
        eq = admin_client.post(f"{BASE_URL}/api/equipments", json={
            "site_id": tech_site, "name": "TEST_own eq", "type": "Pompe"}, timeout=30).json()
        eid = eq["id"]
        try:
            r = tech_client.patch(f"{BASE_URL}/api/equipments/{eid}", json={
                "site_id": tech_site, "name": "TEST_own eq v2", "type": "Pompe"}, timeout=30)
            assert r.status_code == 200, r.text
            assert admin_client.get(f"{BASE_URL}/api/equipments/{eid}", timeout=30).json()["name"] == "TEST_own eq v2"
        finally:
            admin_client.delete(f"{BASE_URL}/api/equipments/{eid}", timeout=30)


# ---------------- Health route ----------------
class TestHealthRoute:
    def test_root_returns_app_and_status(self, api_client):
        r = api_client.get(f"{BASE_URL}/api/", timeout=30)
        assert r.status_code == 200, r.text
        d = r.json()
        assert d.get("app") == "MethaTrack"
        assert d.get("status") == "ok"


# ---------------- Brute force ----------------
class TestBruteForce:
    def test_lockout_on_sixth_attempt(self):
        email = "bf_probe_iter2@methatrack.fr"
        _db_call(lambda db: db.login_attempts.delete_many({"_id": {"$regex": email}}))
        codes = []
        for _ in range(6):
            r = requests.post(f"{BASE_URL}/api/auth/login", json={"email": email, "password": "bad"}, timeout=30)
            codes.append(r.status_code)
        assert codes[:5] == [401] * 5, codes
        assert codes[5] == 423, codes

    def test_lockout_does_not_leak_valid_login_of_other_account(self):
        """A locked probe email must not lock a different account."""
        r = requests.post(f"{BASE_URL}/api/auth/login", json=TECH, timeout=30)
        assert r.status_code == 200, r.text


# ---------------- stock-movements filter preservation ----------------
class TestMovementFilter:
    def test_part_id_filter_preserved_for_admin_and_tech(self, admin_client, tech_client, tech_site):
        p1 = admin_client.post(f"{BASE_URL}/api/parts", json={
            "site_id": tech_site, "name": "TEST_filter p1", "sku": "TEST-F1",
            "quantity": 10, "threshold": 1, "price": 1.0}, timeout=30).json()
        p2 = admin_client.post(f"{BASE_URL}/api/parts", json={
            "site_id": tech_site, "name": "TEST_filter p2", "sku": "TEST-F2",
            "quantity": 10, "threshold": 1, "price": 1.0}, timeout=30).json()
        try:
            admin_client.post(f"{BASE_URL}/api/stock-movements", json={"part_id": p1["id"], "kind": "entree", "quantity": 2}, timeout=30)
            admin_client.post(f"{BASE_URL}/api/stock-movements", json={"part_id": p2["id"], "kind": "entree", "quantity": 3}, timeout=30)

            mv = admin_client.get(f"{BASE_URL}/api/stock-movements", params={"part_id": p1["id"]}, timeout=30).json()
            assert mv and all(m["part_id"] == p1["id"] for m in mv), mv

            mv2 = admin_client.get(f"{BASE_URL}/api/stock-movements",
                                   params={"part_id": p1["id"], "site_id": tech_site}, timeout=30).json()
            assert mv2 and all(m["part_id"] == p1["id"] for m in mv2), mv2

            mv3 = tech_client.get(f"{BASE_URL}/api/stock-movements", params={"part_id": p1["id"]}, timeout=30).json()
            assert mv3 and all(m["part_id"] == p1["id"] for m in mv3), mv3
        finally:
            admin_client.delete(f"{BASE_URL}/api/parts/{p1['id']}", timeout=30)
            admin_client.delete(f"{BASE_URL}/api/parts/{p2['id']}", timeout=30)


# ---------------- Cascade deletes ----------------
class TestCascadeDeletes:
    def test_delete_part_removes_movements(self, admin_client, tech_site):
        p = admin_client.post(f"{BASE_URL}/api/parts", json={
            "site_id": tech_site, "name": "TEST_cascade part", "sku": "TEST-C1",
            "quantity": 10, "threshold": 1, "price": 1.0}, timeout=30).json()
        pid = p["id"]
        admin_client.post(f"{BASE_URL}/api/stock-movements", json={"part_id": pid, "kind": "entree", "quantity": 4}, timeout=30)
        admin_client.post(f"{BASE_URL}/api/stock-movements", json={"part_id": pid, "kind": "sortie", "quantity": 1}, timeout=30)
        before = admin_client.get(f"{BASE_URL}/api/stock-movements", params={"part_id": pid}, timeout=30).json()
        assert len(before) == 2

        d = admin_client.delete(f"{BASE_URL}/api/parts/{pid}", timeout=30)
        assert d.status_code == 200, d.text
        remaining = _db_call(lambda db: db.stock_movements.count_documents({"part_id": pid}))
        assert remaining == 0, f"{remaining} orphan stock_movements left after part delete"

    def test_delete_maintenance_removes_history(self, admin_client, tech_site):
        eq = admin_client.get(f"{BASE_URL}/api/equipments", params={"site_id": tech_site}, timeout=30).json()[0]
        t = admin_client.post(f"{BASE_URL}/api/maintenance", json={
            "site_id": tech_site, "equipment_id": eq["id"], "title": "TEST_cascade maint",
            "frequency_days": 10,
            "next_due": (datetime.now(timezone.utc) + timedelta(days=2)).isoformat()}, timeout=30).json()
        mid = t["id"]
        c = admin_client.post(f"{BASE_URL}/api/maintenance/{mid}/complete",
                              json={"done_at": datetime.now(timezone.utc).isoformat(), "notes": "TEST_cascade done"}, timeout=30)
        assert c.status_code == 200, c.text
        hist = admin_client.get(f"{BASE_URL}/api/maintenance-history", params={"site_id": tech_site}, timeout=30).json()
        assert [h for h in hist if h.get("task_id") == mid]

        d = admin_client.delete(f"{BASE_URL}/api/maintenance/{mid}", timeout=30)
        assert d.status_code == 200, d.text
        remaining = _db_call(lambda db: db.maintenance_history.count_documents({"task_id": mid}))
        assert remaining == 0, f"{remaining} orphan maintenance_history rows left after task delete"

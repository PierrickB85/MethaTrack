"""Seed demo data (sites, users, equipments, parts, failures, analyses, maintenance)."""
import os
from datetime import datetime, timezone, timedelta
from bson import ObjectId
from auth_utils import hash_password, verify_password

DEMO_SITES = [
    {"name": "Site Nord — Bretagne", "location": "Rennes, FR", "capacity_kw": 500},
    {"name": "Site Sud — Provence", "location": "Aix, FR", "capacity_kw": 800},
]

DEMO_USERS = [
    {"email": "tech@methatrack.fr", "password": "Tech2026!", "name": "Julien Martin", "role": "technicien"},
    {"email": "viewer@methatrack.fr", "password": "Viewer2026!", "name": "Direction", "role": "viewer"},
]

DEMO_EQUIPMENTS = [
    {"name": "Digesteur principal", "type": "Digesteur", "serial": "DIG-001", "installed_at": "2020-05-12"},
    {"name": "Pompe recirculation P1", "type": "Pompe", "serial": "PMP-045", "installed_at": "2021-03-01"},
    {"name": "Torchère de sécurité", "type": "Sécurité", "serial": "TRC-011", "installed_at": "2020-05-12"},
    {"name": "Cogénérateur CHP-A", "type": "Cogénération", "serial": "CHP-A2", "installed_at": "2020-06-01"},
    {"name": "Séparateur de phases", "type": "Traitement digestat", "serial": "SEP-023", "installed_at": "2022-09-14"},
]

DEMO_PARTS = [
    {"name": "Roulement pompe 6205", "sku": "RLM-6205", "quantity": 12, "threshold": 4, "price": 35.5, "supplier": "TechnoPièces", "location": "Étagère A2"},
    {"name": "Joint EPDM DN80", "sku": "JT-EPDM-80", "quantity": 3, "threshold": 5, "price": 12.9, "supplier": "SealPro", "location": "Bac B1"},
    {"name": "Sonde pH digestat", "sku": "SND-PH-01", "quantity": 2, "threshold": 2, "price": 245.0, "supplier": "AquaMesure", "location": "Armoire C"},
    {"name": "Filtre à huile CHP", "sku": "FLT-CHP-88", "quantity": 8, "threshold": 3, "price": 48.0, "supplier": "MotorParts", "location": "Étagère A3"},
    {"name": "Vanne pneumatique DN50", "sku": "VNP-DN50", "quantity": 1, "threshold": 2, "price": 320.0, "supplier": "TechnoPièces", "location": "Armoire D"},
]


def _pwd_should_update(admin_email, admin_password, user):
    return not verify_password(admin_password, user["password_hash"])


async def seed_all(db):
    now = datetime.now(timezone.utc).isoformat()

    # Admin user (owner)
    admin_email = os.environ.get("ADMIN_EMAIL", "admin@example.com").lower()
    admin_password = os.environ.get("ADMIN_PASSWORD", "admin123")
    existing_admin = await db.users.find_one({"email": admin_email})
    if not existing_admin:
        await db.users.insert_one({
            "email": admin_email,
            "password_hash": hash_password(admin_password),
            "name": "Admin",
            "role": "admin",
            "site_ids": [],
            "created_at": now,
        })
    elif _pwd_should_update(admin_email, admin_password, existing_admin):
        await db.users.update_one(
            {"email": admin_email},
            {"$set": {"password_hash": hash_password(admin_password), "role": "admin"}},
        )

    # Sites
    site_ids = []
    for s in DEMO_SITES:
        existing = await db.sites.find_one({"name": s["name"]})
        if existing:
            site_ids.append(str(existing["_id"]))
        else:
            r = await db.sites.insert_one({**s, "created_at": now})
            site_ids.append(str(r.inserted_id))

    # Grant admin access to all sites
    await db.users.update_one({"email": admin_email}, {"$set": {"site_ids": site_ids}})

    # Demo users
    tech_site = [site_ids[0]] if site_ids else []
    for u in DEMO_USERS:
        existing = await db.users.find_one({"email": u["email"]})
        assigned = tech_site if u["role"] == "technicien" else site_ids
        if not existing:
            await db.users.insert_one({
                "email": u["email"],
                "password_hash": hash_password(u["password"]),
                "name": u["name"],
                "role": u["role"],
                "site_ids": assigned,
                "created_at": now,
            })

    # Equipments (spread across sites)
    if await db.equipments.count_documents({}) == 0 and site_ids:
        for i, e in enumerate(DEMO_EQUIPMENTS):
            site_id = site_ids[i % len(site_ids)]
            await db.equipments.insert_one({**e, "site_id": site_id, "photos": [], "docs": [], "created_at": now})

    # Parts (global — shared inventory per site)
    if await db.parts.count_documents({}) == 0 and site_ids:
        for i, p in enumerate(DEMO_PARTS):
            site_id = site_ids[i % len(site_ids)]
            await db.parts.insert_one({**p, "site_id": site_id, "created_at": now})

    # Failures — a few sample entries
    if await db.failures.count_documents({}) == 0:
        equips = await db.equipments.find({}).to_list(50)
        samples = [
            {"type": "Mécanique", "severity": "critique", "status": "resolu", "description": "Fuite hydraulique sur pompe P1", "cause": "Joint EPDM usé", "action": "Remplacement joint + purge", "duration_hours": 3.5, "cost": 145.0, "days_ago": 5},
            {"type": "Électrique", "severity": "moyenne", "status": "en_cours", "description": "Défaut variateur", "cause": "Surchauffe carte puissance", "action": "Diagnostic en cours", "duration_hours": 0, "cost": 0, "days_ago": 1},
            {"type": "Process", "severity": "faible", "status": "resolu", "description": "Baisse rendement CHP", "cause": "Filtre à huile encrassé", "action": "Changement filtre", "duration_hours": 1.0, "cost": 48.0, "days_ago": 10},
        ]
        for i, s in enumerate(samples):
            if i < len(equips):
                eq = equips[i]
                dt = datetime.now(timezone.utc) - timedelta(days=s["days_ago"])
                await db.failures.insert_one({
                    "site_id": eq["site_id"],
                    "equipment_id": str(eq["_id"]),
                    "date": dt.isoformat(),
                    "type": s["type"],
                    "severity": s["severity"],
                    "status": s["status"],
                    "description": s["description"],
                    "cause": s["cause"],
                    "action": s["action"],
                    "duration_hours": s["duration_hours"],
                    "cost": s["cost"],
                    "responsible": "Julien Martin",
                    "parts_used": [],
                    "created_at": now,
                })

    # Analyses
    if await db.analyses.count_documents({}) == 0 and site_ids:
        for i, days in enumerate([30, 22, 14, 7, 1]):
            dt = datetime.now(timezone.utc) - timedelta(days=days)
            site_id = site_ids[i % len(site_ids)]
            await db.analyses.insert_one({
                "site_id": site_id,
                "date": dt.isoformat(),
                "ph": 7.6 + (i * 0.05),
                "ms": 4.2,
                "mo": 68.0,
                "agv": 1.2 + (i * 0.15),
                "tac": 12.5,
                "n_nh4": 2.1,
                "n_total": 4.8,
                "p2o5": 1.6,
                "k2o": 3.2,
                "notes": "",
                "created_at": now,
            })

    # Maintenance tasks
    if await db.maintenance_tasks.count_documents({}) == 0:
        equips = await db.equipments.find({}).to_list(50)
        if equips:
            eq = equips[0]
            await db.maintenance_tasks.insert_one({
                "site_id": eq["site_id"],
                "equipment_id": str(eq["_id"]),
                "title": "Contrôle mensuel digesteur",
                "frequency_days": 30,
                "next_due": (datetime.now(timezone.utc) + timedelta(days=3)).isoformat(),
                "last_done": None,
                "notes": "Vérifier étanchéité, agitation, sondes",
                "created_at": now,
            })

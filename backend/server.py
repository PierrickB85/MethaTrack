"""MethaTrack backend — FastAPI + MongoDB + JWT auth + Emergent Object Storage."""
from dotenv import load_dotenv
from pathlib import Path
ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / ".env")

import os
import io
import uuid
import logging
from datetime import datetime, timezone, timedelta
from typing import List, Optional

from fastapi import FastAPI, APIRouter, HTTPException, Depends, Request, Response, UploadFile, File, Query, Header
from fastapi.responses import Response as FastAPIResponse
from pydantic import BaseModel, EmailStr, Field
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
from bson import ObjectId

from auth_utils import (
    hash_password, verify_password, create_access_token, create_refresh_token,
    decode_token, get_current_user_from_db, user_site_ids, can_write, is_admin,
)
from storage import init_storage, put_object, get_object, APP_NAME
from seed_data import seed_all

logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(levelname)s - %(message)s")
logger = logging.getLogger(__name__)

# --- DB ---
mongo_url = os.environ["MONGO_URL"]
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ["DB_NAME"]]

app = FastAPI(title="MethaTrack API")
api = APIRouter(prefix="/api")


# ---------------- helpers ----------------
def _oid(x: str) -> ObjectId:
    try:
        return ObjectId(x)
    except Exception:
        raise HTTPException(status_code=400, detail="ID invalide")


def _serialize(doc: dict) -> dict:
    if not doc:
        return doc
    doc["id"] = str(doc.pop("_id"))
    return doc


async def current_user(request: Request) -> dict:
    return await get_current_user_from_db(request, db)


async def require_writer(user: dict = Depends(current_user)):
    if not can_write(user):
        raise HTTPException(status_code=403, detail="Accès en lecture seule")
    return user


async def require_admin(user: dict = Depends(current_user)):
    if not is_admin(user):
        raise HTTPException(status_code=403, detail="Réservé aux administrateurs")
    return user


def _site_filter(user: dict, site_id: Optional[str] = None) -> dict:
    """Return a Mongo filter restricting to user's accessible sites."""
    if is_admin(user):
        return {"site_id": site_id} if site_id else {}
    allowed = user_site_ids(user)
    if site_id:
        if site_id not in allowed:
            raise HTTPException(status_code=403, detail="Site non autorisé")
        return {"site_id": site_id}
    return {"site_id": {"$in": allowed}} if allowed else {"site_id": {"$in": []}}


def _check_site(user: dict, site_id: str):
    """Assert user can access a site_id (write ops)."""
    if is_admin(user):
        return
    if site_id not in user_site_ids(user):
        raise HTTPException(status_code=403, detail="Site non autorisé")


async def _assert_owned(collection, doc_id: str, user: dict) -> dict:
    """Fetch doc & assert user has access via site_id. Returns the doc."""
    doc = await collection.find_one({"_id": _oid(doc_id)})
    if not doc:
        raise HTTPException(status_code=404, detail="Introuvable")
    if not is_admin(user) and doc.get("site_id") not in user_site_ids(user):
        raise HTTPException(status_code=403, detail="Site non autorisé")
    return doc


# ---------------- Models ----------------
class LoginIn(BaseModel):
    email: EmailStr
    password: str


class UserOut(BaseModel):
    id: str
    email: str
    name: str
    role: str
    site_ids: List[str] = []


class UserCreate(BaseModel):
    email: EmailStr
    password: str
    name: str
    role: str = Field(..., pattern="^(admin|technicien|viewer)$")
    site_ids: List[str] = []


class UserUpdate(BaseModel):
    name: Optional[str] = None
    role: Optional[str] = Field(None, pattern="^(admin|technicien|viewer)$")
    site_ids: Optional[List[str]] = None
    password: Optional[str] = None


class SiteIn(BaseModel):
    name: str
    location: str = ""
    capacity_kw: Optional[float] = None


class EquipmentIn(BaseModel):
    site_id: str
    name: str
    type: str
    serial: Optional[str] = ""
    installed_at: Optional[str] = ""
    notes: Optional[str] = ""


class PartIn(BaseModel):
    site_id: str
    name: str
    sku: str
    quantity: float = 0
    threshold: float = 0
    price: float = 0
    supplier: Optional[str] = ""
    location: Optional[str] = ""


class PartUsage(BaseModel):
    part_id: str
    quantity: float


class FailureIn(BaseModel):
    site_id: str
    equipment_id: str
    date: str
    type: str
    severity: str = Field(..., pattern="^(faible|moyenne|critique)$")
    status: str = Field(..., pattern="^(ouvert|en_cours|resolu)$")
    description: str
    cause: Optional[str] = ""
    action: Optional[str] = ""
    duration_hours: float = 0
    cost: float = 0
    responsible: Optional[str] = ""
    parts_used: List[PartUsage] = []


class StockMoveIn(BaseModel):
    part_id: str
    kind: str = Field(..., pattern="^(entree|sortie|ajustement)$")
    quantity: float
    reason: Optional[str] = ""
    failure_id: Optional[str] = None


class AnalysisIn(BaseModel):
    site_id: str
    date: str
    ph: float
    ms: float
    mo: float
    agv: float
    tac: float
    n_nh4: float
    n_total: float
    p2o5: float
    k2o: float
    notes: Optional[str] = ""


class MaintenanceIn(BaseModel):
    site_id: str
    equipment_id: str
    title: str
    frequency_days: int
    next_due: str
    notes: Optional[str] = ""


class MaintenanceComplete(BaseModel):
    done_at: str
    notes: Optional[str] = ""


# ---------------- Auth ----------------
def _set_auth_cookies(response: Response, access: str, refresh: str):
    response.set_cookie("access_token", access, httponly=True, secure=True, samesite="none", max_age=43200, path="/")
    response.set_cookie("refresh_token", refresh, httponly=True, secure=True, samesite="none", max_age=604800, path="/")


@api.post("/auth/login")
async def login(data: LoginIn, request: Request, response: Response):
    email = data.email.lower()
    key = email  # key by email only — multi-pod ingress makes IP unreliable
    now = datetime.now(timezone.utc)
    attempt = await db.login_attempts.find_one({"_id": key})
    if attempt and attempt.get("count", 0) >= 5:
        locked_until = attempt.get("locked_until")
        if locked_until and datetime.fromisoformat(locked_until) > now:
            raise HTTPException(status_code=423, detail="Trop de tentatives. Réessayez plus tard.")
    user = await db.users.find_one({"email": email})
    if not user or not verify_password(data.password, user["password_hash"]):
        new_count = (attempt.get("count", 0) if attempt else 0) + 1
        upd = {"count": new_count, "last_at": now.isoformat()}
        if new_count >= 5:
            upd["locked_until"] = (now + timedelta(minutes=15)).isoformat()
        await db.login_attempts.update_one({"_id": key}, {"$set": upd}, upsert=True)
        raise HTTPException(status_code=401, detail="Identifiants incorrects")
    if attempt:
        await db.login_attempts.delete_one({"_id": key})
    uid = str(user["_id"])
    access = create_access_token(uid, email)
    refresh = create_refresh_token(uid)
    _set_auth_cookies(response, access, refresh)
    return {
        "id": uid, "email": email, "name": user["name"], "role": user["role"],
        "site_ids": user.get("site_ids", []), "token": access,
    }


@api.post("/auth/logout")
async def logout(response: Response):
    response.delete_cookie("access_token", path="/")
    response.delete_cookie("refresh_token", path="/")
    return {"ok": True}


@api.get("/auth/me")
async def me(user=Depends(current_user)):
    return user


@api.post("/auth/refresh")
async def refresh(request: Request, response: Response):
    token = request.cookies.get("refresh_token")
    if not token:
        raise HTTPException(status_code=401, detail="Refresh manquant")
    try:
        payload = decode_token(token)
        if payload.get("type") != "refresh":
            raise HTTPException(status_code=401, detail="Type invalide")
        user = await db.users.find_one({"_id": _oid(payload["sub"])})
        if not user:
            raise HTTPException(status_code=401, detail="Utilisateur introuvable")
        access = create_access_token(str(user["_id"]), user["email"])
        response.set_cookie("access_token", access, httponly=True, secure=True, samesite="none", max_age=43200, path="/")
        return {"ok": True}
    except Exception:
        raise HTTPException(status_code=401, detail="Refresh invalide")


# ---------------- Users (admin) ----------------
@api.get("/users")
async def list_users(_=Depends(require_admin)):
    users = await db.users.find({}).to_list(500)
    return [{
        "id": str(u["_id"]), "email": u["email"], "name": u["name"],
        "role": u["role"], "site_ids": u.get("site_ids", []),
    } for u in users]


@api.post("/users")
async def create_user(data: UserCreate, _=Depends(require_admin)):
    email = data.email.lower()
    if await db.users.find_one({"email": email}):
        raise HTTPException(status_code=400, detail="Email déjà utilisé")
    r = await db.users.insert_one({
        "email": email, "password_hash": hash_password(data.password),
        "name": data.name, "role": data.role, "site_ids": data.site_ids,
        "created_at": datetime.now(timezone.utc).isoformat(),
    })
    return {"id": str(r.inserted_id), "email": email, "name": data.name, "role": data.role, "site_ids": data.site_ids}


@api.patch("/users/{user_id}")
async def update_user(user_id: str, data: UserUpdate, _=Depends(require_admin)):
    upd = {}
    if data.name is not None: upd["name"] = data.name
    if data.role is not None: upd["role"] = data.role
    if data.site_ids is not None: upd["site_ids"] = data.site_ids
    if data.password: upd["password_hash"] = hash_password(data.password)
    if not upd:
        return {"ok": True}
    await db.users.update_one({"_id": _oid(user_id)}, {"$set": upd})
    return {"ok": True}


@api.delete("/users/{user_id}")
async def delete_user(user_id: str, _=Depends(require_admin)):
    await db.users.delete_one({"_id": _oid(user_id)})
    return {"ok": True}


# ---------------- Sites ----------------
@api.get("/sites")
async def list_sites(user=Depends(current_user)):
    q = {} if is_admin(user) else {"_id": {"$in": [_oid(s) for s in user_site_ids(user)]}}
    sites = await db.sites.find(q).to_list(200)
    return [_serialize(s) for s in sites]


@api.post("/sites")
async def create_site(data: SiteIn, _=Depends(require_admin)):
    r = await db.sites.insert_one({**data.model_dump(), "created_at": datetime.now(timezone.utc).isoformat()})
    return {"id": str(r.inserted_id), **data.model_dump()}


@api.patch("/sites/{site_id}")
async def update_site(site_id: str, data: SiteIn, _=Depends(require_admin)):
    await db.sites.update_one({"_id": _oid(site_id)}, {"$set": data.model_dump()})
    return {"ok": True}


@api.delete("/sites/{site_id}")
async def delete_site(site_id: str, _=Depends(require_admin)):
    await db.sites.delete_one({"_id": _oid(site_id)})
    return {"ok": True}


# ---------------- Equipments ----------------
@api.get("/equipments")
async def list_equipments(site_id: Optional[str] = None, user=Depends(current_user)):
    q = _site_filter(user, site_id)
    docs = await db.equipments.find(q).sort("name", 1).to_list(500)
    return [_serialize(d) for d in docs]


@api.get("/equipments/{eq_id}")
async def get_equipment(eq_id: str, user=Depends(current_user)):
    d = await db.equipments.find_one({"_id": _oid(eq_id)})
    if not d:
        raise HTTPException(status_code=404, detail="Équipement introuvable")
    if not is_admin(user) and d["site_id"] not in user_site_ids(user):
        raise HTTPException(status_code=403, detail="Site non autorisé")
    return _serialize(d)


@api.post("/equipments")
async def create_equipment(data: EquipmentIn, user=Depends(require_writer)):
    if not is_admin(user) and data.site_id not in user_site_ids(user):
        raise HTTPException(status_code=403, detail="Site non autorisé")
    r = await db.equipments.insert_one({
        **data.model_dump(), "photos": [], "docs": [],
        "created_at": datetime.now(timezone.utc).isoformat(),
    })
    return {"id": str(r.inserted_id)}


@api.patch("/equipments/{eq_id}")
async def update_equipment(eq_id: str, data: EquipmentIn, user=Depends(require_writer)):
    await _assert_owned(db.equipments, eq_id, user)
    _check_site(user, data.site_id)
    await db.equipments.update_one({"_id": _oid(eq_id)}, {"$set": data.model_dump()})
    return {"ok": True}


@api.delete("/equipments/{eq_id}")
async def delete_equipment(eq_id: str, user=Depends(require_admin)):
    await _assert_owned(db.equipments, eq_id, user)
    await db.equipments.delete_one({"_id": _oid(eq_id)})
    return {"ok": True}


@api.post("/equipments/{eq_id}/photos")
async def upload_photo(eq_id: str, file: UploadFile = File(...), user=Depends(require_writer)):
    eq = await _assert_owned(db.equipments, eq_id, user)
    if len(eq.get("photos", [])) >= 6:
        raise HTTPException(status_code=400, detail="Maximum 6 photos par équipement")
    ext = (file.filename.rsplit(".", 1)[-1] or "bin").lower()
    path = f"{APP_NAME}/equipments/{eq_id}/{uuid.uuid4()}.{ext}"
    data = await file.read()
    result = put_object(path, data, file.content_type or "image/jpeg")
    photo_ref = {"path": result["path"], "filename": file.filename, "content_type": file.content_type, "size": result.get("size", len(data))}
    await db.equipments.update_one({"_id": _oid(eq_id)}, {"$push": {"photos": photo_ref}})
    return photo_ref


@api.post("/equipments/{eq_id}/docs")
async def upload_doc(eq_id: str, file: UploadFile = File(...), user=Depends(require_writer)):
    await _assert_owned(db.equipments, eq_id, user)
    ext = (file.filename.rsplit(".", 1)[-1] or "bin").lower()
    path = f"{APP_NAME}/equipments/{eq_id}/docs/{uuid.uuid4()}.{ext}"
    data = await file.read()
    result = put_object(path, data, file.content_type or "application/pdf")
    doc_ref = {"path": result["path"], "filename": file.filename, "content_type": file.content_type, "size": result.get("size", len(data))}
    await db.equipments.update_one({"_id": _oid(eq_id)}, {"$push": {"docs": doc_ref}})
    return doc_ref


@api.get("/files/{path:path}")
async def download_file(path: str, request: Request, auth: Optional[str] = Query(None)):
    # Auth via query param OR cookie/header
    if auth:
        try:
            decode_token(auth)
        except Exception:
            raise HTTPException(status_code=401, detail="Token invalide")
    else:
        await get_current_user_from_db(request, db)
    try:
        data, ctype = get_object(path)
    except Exception:
        raise HTTPException(status_code=404, detail="Fichier introuvable")
    return FastAPIResponse(content=data, media_type=ctype)


# ---------------- Parts / Stock ----------------
@api.get("/parts")
async def list_parts(site_id: Optional[str] = None, user=Depends(current_user)):
    q = _site_filter(user, site_id)
    docs = await db.parts.find(q).sort("name", 1).to_list(500)
    return [_serialize(d) for d in docs]


@api.post("/parts")
async def create_part(data: PartIn, user=Depends(require_writer)):
    if not is_admin(user) and data.site_id not in user_site_ids(user):
        raise HTTPException(status_code=403, detail="Site non autorisé")
    r = await db.parts.insert_one({**data.model_dump(), "created_at": datetime.now(timezone.utc).isoformat()})
    return {"id": str(r.inserted_id)}


@api.patch("/parts/{part_id}")
async def update_part(part_id: str, data: PartIn, user=Depends(require_writer)):
    await _assert_owned(db.parts, part_id, user)
    _check_site(user, data.site_id)
    await db.parts.update_one({"_id": _oid(part_id)}, {"$set": data.model_dump()})
    return {"ok": True}


@api.delete("/parts/{part_id}")
async def delete_part(part_id: str, user=Depends(require_admin)):
    await _assert_owned(db.parts, part_id, user)
    await db.parts.delete_one({"_id": _oid(part_id)})
    await db.stock_movements.delete_many({"part_id": part_id})
    return {"ok": True}


@api.get("/stock-movements")
async def list_movements(part_id: Optional[str] = None, site_id: Optional[str] = None, user=Depends(current_user)):
    q = {}
    # Determine accessible parts set (respect site scoping)
    if site_id or not is_admin(user):
        pq = _site_filter(user, site_id)
        parts = await db.parts.find(pq, {"_id": 1}).to_list(2000)
        accessible = [str(p["_id"]) for p in parts]
        if part_id:
            if part_id not in accessible:
                raise HTTPException(status_code=403, detail="Pièce non autorisée")
            q["part_id"] = part_id
        else:
            q["part_id"] = {"$in": accessible}
    else:
        if part_id:
            q["part_id"] = part_id
    docs = await db.stock_movements.find(q).sort("date", -1).to_list(1000)
    return [_serialize(d) for d in docs]


async def _apply_stock_move(part_id: str, kind: str, qty: float, reason: str, user: dict, failure_id: Optional[str] = None):
    part = await db.parts.find_one({"_id": _oid(part_id)})
    if not part:
        raise HTTPException(status_code=404, detail="Pièce introuvable")
    if not is_admin(user) and part["site_id"] not in user_site_ids(user):
        raise HTTPException(status_code=403, detail="Site non autorisé")
    delta = qty if kind == "entree" else (-qty if kind == "sortie" else qty)  # ajustement = delta signé fourni
    new_qty = float(part.get("quantity", 0)) + delta
    if new_qty < 0:
        raise HTTPException(status_code=400, detail="Stock insuffisant")
    await db.parts.update_one({"_id": _oid(part_id)}, {"$set": {"quantity": new_qty}})
    mv = {
        "part_id": part_id, "kind": kind, "quantity": qty, "reason": reason,
        "failure_id": failure_id, "user_id": user["id"], "user_name": user["name"],
        "date": datetime.now(timezone.utc).isoformat(),
    }
    r = await db.stock_movements.insert_one(mv)
    return str(r.inserted_id), new_qty


@api.post("/stock-movements")
async def create_movement(data: StockMoveIn, user=Depends(require_writer)):
    mid, new_qty = await _apply_stock_move(data.part_id, data.kind, data.quantity, data.reason or "", user, data.failure_id)
    return {"id": mid, "new_quantity": new_qty}


# ---------------- Failures ----------------
@api.get("/failures")
async def list_failures(site_id: Optional[str] = None, status: Optional[str] = None, severity: Optional[str] = None, equipment_id: Optional[str] = None, user=Depends(current_user)):
    q = _site_filter(user, site_id)
    if status: q["status"] = status
    if severity: q["severity"] = severity
    if equipment_id: q["equipment_id"] = equipment_id
    docs = await db.failures.find(q).sort("date", -1).to_list(1000)
    return [_serialize(d) for d in docs]


@api.post("/failures")
async def create_failure(data: FailureIn, user=Depends(require_writer)):
    if not is_admin(user) and data.site_id not in user_site_ids(user):
        raise HTTPException(status_code=403, detail="Site non autorisé")
    doc = data.model_dump()
    doc["parts_used"] = [p.model_dump() if hasattr(p, "model_dump") else p for p in data.parts_used]
    doc["created_at"] = datetime.now(timezone.utc).isoformat()
    r = await db.failures.insert_one(doc)
    failure_id = str(r.inserted_id)
    # Apply stock outputs
    for pu in data.parts_used:
        if pu.quantity > 0:
            await _apply_stock_move(pu.part_id, "sortie", pu.quantity, f"Panne {failure_id}", user, failure_id)
    return {"id": failure_id}


@api.patch("/failures/{fid}")
async def update_failure(fid: str, data: FailureIn, user=Depends(require_writer)):
    await _assert_owned(db.failures, fid, user)
    _check_site(user, data.site_id)
    doc = data.model_dump()
    doc["parts_used"] = [p.model_dump() if hasattr(p, "model_dump") else p for p in data.parts_used]
    await db.failures.update_one({"_id": _oid(fid)}, {"$set": doc})
    return {"ok": True}


@api.delete("/failures/{fid}")
async def delete_failure(fid: str, user=Depends(require_writer)):
    await _assert_owned(db.failures, fid, user)
    await db.failures.delete_one({"_id": _oid(fid)})
    return {"ok": True}


# ---------------- Analyses ----------------
@api.get("/analyses")
async def list_analyses(site_id: Optional[str] = None, user=Depends(current_user)):
    q = _site_filter(user, site_id)
    docs = await db.analyses.find(q).sort("date", -1).to_list(1000)
    return [_serialize(d) for d in docs]


@api.post("/analyses")
async def create_analysis(data: AnalysisIn, user=Depends(require_writer)):
    if not is_admin(user) and data.site_id not in user_site_ids(user):
        raise HTTPException(status_code=403, detail="Site non autorisé")
    r = await db.analyses.insert_one({**data.model_dump(), "created_at": datetime.now(timezone.utc).isoformat()})
    return {"id": str(r.inserted_id)}


@api.patch("/analyses/{aid}")
async def update_analysis(aid: str, data: AnalysisIn, user=Depends(require_writer)):
    await _assert_owned(db.analyses, aid, user)
    _check_site(user, data.site_id)
    await db.analyses.update_one({"_id": _oid(aid)}, {"$set": data.model_dump()})
    return {"ok": True}


@api.delete("/analyses/{aid}")
async def delete_analysis(aid: str, user=Depends(require_writer)):
    await _assert_owned(db.analyses, aid, user)
    await db.analyses.delete_one({"_id": _oid(aid)})
    return {"ok": True}


# ---------------- Maintenance ----------------
@api.get("/maintenance")
async def list_maintenance(site_id: Optional[str] = None, user=Depends(current_user)):
    q = _site_filter(user, site_id)
    docs = await db.maintenance_tasks.find(q).sort("next_due", 1).to_list(1000)
    return [_serialize(d) for d in docs]


@api.post("/maintenance")
async def create_maintenance(data: MaintenanceIn, user=Depends(require_writer)):
    if not is_admin(user) and data.site_id not in user_site_ids(user):
        raise HTTPException(status_code=403, detail="Site non autorisé")
    r = await db.maintenance_tasks.insert_one({
        **data.model_dump(), "last_done": None,
        "created_at": datetime.now(timezone.utc).isoformat(),
    })
    return {"id": str(r.inserted_id)}


@api.patch("/maintenance/{mid}")
async def update_maintenance(mid: str, data: MaintenanceIn, user=Depends(require_writer)):
    await _assert_owned(db.maintenance_tasks, mid, user)
    _check_site(user, data.site_id)
    await db.maintenance_tasks.update_one({"_id": _oid(mid)}, {"$set": data.model_dump()})
    return {"ok": True}


@api.post("/maintenance/{mid}/complete")
async def complete_maintenance(mid: str, data: MaintenanceComplete, user=Depends(require_writer)):
    task = await _assert_owned(db.maintenance_tasks, mid, user)
    from datetime import timedelta
    done_at = datetime.fromisoformat(data.done_at.replace("Z", "+00:00"))
    next_due = done_at + timedelta(days=int(task["frequency_days"]))
    await db.maintenance_tasks.update_one(
        {"_id": _oid(mid)},
        {"$set": {"last_done": done_at.isoformat(), "next_due": next_due.isoformat()}},
    )
    await db.maintenance_history.insert_one({
        "task_id": mid, "equipment_id": task["equipment_id"], "site_id": task["site_id"],
        "done_at": done_at.isoformat(), "notes": data.notes or "",
        "user_name": user["name"], "created_at": datetime.now(timezone.utc).isoformat(),
    })
    return {"ok": True}


@api.delete("/maintenance/{mid}")
async def delete_maintenance(mid: str, user=Depends(require_writer)):
    await _assert_owned(db.maintenance_tasks, mid, user)
    await db.maintenance_tasks.delete_one({"_id": _oid(mid)})
    await db.maintenance_history.delete_many({"task_id": mid})
    return {"ok": True}


@api.get("/maintenance-history")
async def maintenance_history(site_id: Optional[str] = None, user=Depends(current_user)):
    q = _site_filter(user, site_id)
    docs = await db.maintenance_history.find(q).sort("done_at", -1).to_list(500)
    return [_serialize(d) for d in docs]


# ---------------- Dashboard ----------------
@api.get("/dashboard/summary")
async def dashboard_summary(site_id: Optional[str] = None, user=Depends(current_user)):
    q = _site_filter(user, site_id)
    failures = await db.failures.find(q).to_list(2000)
    parts = await db.parts.find(q).to_list(2000)
    equips = await db.equipments.count_documents(q)
    open_failures = [f for f in failures if f.get("status") != "resolu"]
    critical = [f for f in failures if f.get("severity") == "critique"]
    total_cost = sum(float(f.get("cost", 0)) for f in failures)
    stock_value = sum(float(p.get("quantity", 0)) * float(p.get("price", 0)) for p in parts)
    low_stock = [p for p in parts if float(p.get("quantity", 0)) <= float(p.get("threshold", 0))]
    return {
        "equipments": equips,
        "failures_total": len(failures),
        "failures_open": len(open_failures),
        "failures_critical": len(critical),
        "cost_total": total_cost,
        "stock_value": stock_value,
        "low_stock_count": len(low_stock),
    }


@api.get("/")
async def root():
    return {"app": "MethaTrack", "status": "ok"}


# ---------------- Startup ----------------
app.include_router(api)

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=os.environ.get("CORS_ORIGINS", "*").split(","),
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
async def startup():
    try:
        await db.users.create_index("email", unique=True)
        await db.stock_movements.create_index("part_id")
        await db.failures.create_index([("site_id", 1), ("date", -1)])
        await db.equipments.create_index("site_id")
        await db.parts.create_index("site_id")
        await db.analyses.create_index([("site_id", 1), ("date", -1)])
        await db.maintenance_tasks.create_index("next_due")
        # Cleanup orphan movements/history (one-off)
        parts_ids = {str(p["_id"]) for p in await db.parts.find({}, {"_id": 1}).to_list(5000)}
        tasks_ids = {str(t["_id"]) for t in await db.maintenance_tasks.find({}, {"_id": 1}).to_list(5000)}
        await db.stock_movements.delete_many({"part_id": {"$nin": list(parts_ids)}})
        await db.maintenance_history.delete_many({"task_id": {"$nin": list(tasks_ids)}})
    except Exception as e:
        logger.warning(f"Index warning: {e}")
    try:
        init_storage()
        logger.info("Storage initialisé")
    except Exception as e:
        logger.error(f"Storage init failed: {e}")
    try:
        await seed_all(db)
        logger.info("Seed OK")
    except Exception as e:
        logger.exception(f"Seed error: {e}")


@app.on_event("shutdown")
async def shutdown():
    client.close()

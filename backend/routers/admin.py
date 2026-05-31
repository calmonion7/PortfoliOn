# backend/routers/admin.py
from fastapi import APIRouter, Depends
from pydantic import BaseModel
from typing import Dict, List

from auth import require_admin
from services.db import query, execute

ALL_MENUS = ["portfolio", "research", "market", "guru", "settings"]

router = APIRouter(prefix="/api/admin", tags=["admin"])


def _get_user_permissions(user_id: str) -> Dict[str, bool]:
    rows = query(
        "SELECT menu, enabled FROM user_menu_permissions WHERE user_id = %s",
        (user_id,),
    )
    base = {m: False for m in ALL_MENUS}
    for r in rows:
        base[r["menu"]] = r["enabled"]
    return base


@router.get("/users")
def list_users(admin_id: str = Depends(require_admin)):
    users = query("SELECT id, email, role FROM users ORDER BY created_at")
    result = []
    for u in users:
        perms = _get_user_permissions(str(u["id"])) if u["role"] != "admin" else {m: True for m in ALL_MENUS}
        result.append({"id": str(u["id"]), "email": u["email"], "role": u["role"], "permissions": perms})
    return result


class PermissionsBody(BaseModel):
    permissions: Dict[str, bool]


class BulkPermissionsBody(BaseModel):
    user_ids: List[str]
    permissions: Dict[str, bool]


@router.put("/users/{user_id}/permissions")
def set_permissions(user_id: str, body: PermissionsBody, admin_id: str = Depends(require_admin)):
    for menu, enabled in body.permissions.items():
        if menu not in ALL_MENUS:
            continue
        execute(
            """INSERT INTO user_menu_permissions (user_id, menu, enabled)
               VALUES (%s, %s, %s)
               ON CONFLICT (user_id, menu) DO UPDATE SET enabled = EXCLUDED.enabled""",
            (user_id, menu, enabled),
        )
    return {"ok": True}


@router.post("/users/bulk-permissions")
def bulk_permissions(body: BulkPermissionsBody, admin_id: str = Depends(require_admin)):
    for uid in body.user_ids:
        for menu, enabled in body.permissions.items():
            if menu not in ALL_MENUS:
                continue
            execute(
                """INSERT INTO user_menu_permissions (user_id, menu, enabled)
                   VALUES (%s, %s, %s)
                   ON CONFLICT (user_id, menu) DO UPDATE SET enabled = EXCLUDED.enabled""",
                (uid, menu, enabled),
            )
    return {"ok": True, "updated": len(body.user_ids)}


@router.get("/default-permissions")
def get_default_permissions(admin_id: str = Depends(require_admin)):
    rows = query("SELECT menu, enabled FROM default_menu_permissions")
    base = {m: False for m in ALL_MENUS}
    for r in rows:
        base[r["menu"]] = r["enabled"]
    return base


@router.put("/default-permissions")
def set_default_permissions(body: PermissionsBody, admin_id: str = Depends(require_admin)):
    for menu, enabled in body.permissions.items():
        if menu not in ALL_MENUS:
            continue
        execute(
            """INSERT INTO default_menu_permissions (menu, enabled)
               VALUES (%s, %s)
               ON CONFLICT (menu) DO UPDATE SET enabled = EXCLUDED.enabled""",
            (menu, enabled),
        )
    base = {m: False for m in ALL_MENUS}
    base.update({m: v for m, v in body.permissions.items() if m in ALL_MENUS})
    return base

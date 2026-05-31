# backend/routers/admin.py
from fastapi import APIRouter, Depends, HTTPException
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
    users = query("SELECT id, email, role, oauth_provider FROM users ORDER BY created_at")
    result = []
    for u in users:
        perms = _get_user_permissions(str(u["id"])) if u["role"] != "admin" else {m: True for m in ALL_MENUS}
        result.append({"id": str(u["id"]), "email": u["email"], "role": u["role"], "oauth_provider": u["oauth_provider"], "permissions": perms})
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


@router.delete("/users/{user_id}")
def delete_user(user_id: str, admin_id: str = Depends(require_admin)):
    rows = query("SELECT role, oauth_provider FROM users WHERE id = %s", (user_id,))
    if not rows:
        raise HTTPException(status_code=404, detail="사용자를 찾을 수 없습니다")
    if rows[0]["role"] == "admin":
        raise HTTPException(status_code=403, detail="어드민 계정은 삭제할 수 없습니다")
    if rows[0]["oauth_provider"]:
        raise HTTPException(status_code=403, detail="소셜 로그인 계정은 삭제할 수 없습니다")
    for table, col in [
        ("user_stocks", "user_id"),
        ("user_menu_permissions", "user_id"),
        ("refresh_tokens", "user_id"),
        ("digests", "user_id"),
        ("calendar_cache", "user_id"),
    ]:
        execute(f"DELETE FROM {table} WHERE {col} = %s", (user_id,))
    execute("DELETE FROM users WHERE id = %s", (user_id,))
    return {"ok": True}


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

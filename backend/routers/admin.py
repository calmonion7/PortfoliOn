# backend/routers/admin.py
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from typing import Dict, List

from auth import require_admin, require_admin_or_api_key
from services.db import query, execute
from services import cache as cache_svc

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
    non_admin_ids = [str(u["id"]) for u in users if u["role"] != "admin"]
    perm_rows = (
        query(
            "SELECT user_id, menu, enabled FROM user_menu_permissions WHERE user_id = ANY(%s::uuid[])",
            (non_admin_ids,),
        )
        if non_admin_ids
        else []
    )
    perm_map: Dict[str, Dict[str, bool]] = {}
    for r in perm_rows:
        uid = str(r["user_id"])
        if uid not in perm_map:
            perm_map[uid] = {m: False for m in ALL_MENUS}
        perm_map[uid][r["menu"]] = r["enabled"]
    result = []
    for u in users:
        uid = str(u["id"])
        if u["role"] == "admin":
            perms = {m: True for m in ALL_MENUS}
        else:
            perms = perm_map.get(uid, {m: False for m in ALL_MENUS})
        result.append({"id": uid, "email": u["email"], "role": u["role"], "oauth_provider": u["oauth_provider"], "permissions": perms})
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


@router.delete("/stocks/{ticker}")
def delete_stock_all_users(ticker: str, admin_id: str = Depends(require_admin)):
    """관리자: 한 종목을 모든 사용자의 보유·관심(user_stocks)에서 제거. 스냅샷은 유지."""
    deleted = execute("DELETE FROM user_stocks WHERE UPPER(ticker) = %s", (ticker.upper(),))
    cache_svc.invalidate_portfolio_caches()
    return {"deleted": deleted, "ticker": ticker.upper()}


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


# --- Analytics (admin only) ---
from datetime import datetime, timedelta, timezone as _tz


def _cutoff(days: int):
    if days >= 9999:
        return datetime(2000, 1, 1, tzinfo=_tz.utc)
    return datetime.now(_tz.utc) - timedelta(days=days)


@router.get("/analytics/summary")
def analytics_summary(days: int = 7, admin_id: str = Depends(require_admin)):
    cut = _cutoff(days)
    dau_rows = query(
        "SELECT COUNT(DISTINCT user_id) AS dau FROM user_events WHERE created_at >= %s",
        (cut,),
    )
    total_rows = query(
        "SELECT COUNT(*) AS total FROM user_events WHERE created_at >= %s",
        (cut,),
    )
    top_rows = query(
        "SELECT event_name, COUNT(*) AS cnt FROM user_events "
        "WHERE created_at >= %s GROUP BY event_name ORDER BY cnt DESC LIMIT 10",
        (cut,),
    )
    return {
        "dau":          dau_rows[0]["dau"] if dau_rows else 0,
        "total_events": total_rows[0]["total"] if total_rows else 0,
        "top_events":   [{"name": r["event_name"], "count": r["cnt"]} for r in top_rows],
    }


@router.get("/analytics/events")
def analytics_events(days: int = 7, admin_id: str = Depends(require_admin)):
    cut = _cutoff(days)
    rows = query(
        "SELECT DATE(created_at) AS date, event_name, COUNT(*) AS count "
        "FROM user_events WHERE created_at >= %s "
        "GROUP BY DATE(created_at), event_name ORDER BY date DESC",
        (cut,),
    )
    return [{"date": str(r["date"]), "event_name": r["event_name"], "count": r["count"]} for r in rows]


@router.get("/analytics/users")
def analytics_users(admin_id: str = Depends(require_admin)):
    rows = query(
        "SELECT e.user_id, u.email, COUNT(*) AS total_events, MAX(e.created_at) AS last_active "
        "FROM user_events e JOIN users u ON u.id = e.user_id "
        "GROUP BY e.user_id, u.email ORDER BY total_events DESC"
    )
    return [
        {
            "user_id":      str(r["user_id"]),
            "email":        r["email"],
            "total_events": r["total_events"],
            "last_active":  r["last_active"].isoformat() if r["last_active"] else None,
        }
        for r in rows
    ]


class AnalystTargetBody(BaseModel):
    enabled: bool


@router.get("/analyst-targets")
def list_analyst_targets(admin_id: str = Depends(require_admin)):
    """전역 지정 종목 목록 (task#224). analyst_target은 tickers 공유 마스터 플래그라
    GET /api/stocks(세션=본인 보유·관심)로는 타 사용자 종목의 지정이 안 보여 해제도 못 한다."""
    rows = query("SELECT ticker, name, market FROM tickers WHERE analyst_target = true ORDER BY ticker")
    return [
        {"ticker": r["ticker"], "name": r.get("name") or r["ticker"], "market": r.get("market") or "US"}
        for r in rows
    ]


@router.put("/analyst-targets/{ticker}")
def set_analyst_target(ticker: str, body: AnalystTargetBody, admin_id: str = Depends(require_admin_or_api_key)):
    """애널리스트 리포트 자동 발행 대상 지정/해제 (전역 opt-in, task#214). Cowork-facing 쓰기 게이트 컨벤션."""
    upper = ticker.upper()
    n = execute("UPDATE tickers SET analyst_target = %s WHERE ticker = %s", (body.enabled, upper))
    if n == 0:
        raise HTTPException(status_code=404, detail=f"{upper} 종목 마스터에 없음")
    return {"ok": True, "ticker": upper, "analyst_target": body.enabled}


class CoworkFireBody(BaseModel):
    text: str = ""


@router.post("/cowork/fire")
def cowork_fire(body: CoworkFireBody = None, admin_id: str = Depends(require_admin_or_api_key)):
    """루틴 수동 fire (ADR-0028) — text 생략 시 기본 정책 지시문. 미설정 시 503."""
    from services import cowork_trigger
    if not cowork_trigger.configured():
        raise HTTPException(status_code=503, detail="루틴 fire 미설정 (COWORK_ROUTINE_FIRE_URL/TOKEN)")
    text = (body.text if body else "") or cowork_trigger.manual_text()
    ok = cowork_trigger.fire(text)
    if not ok:
        raise HTTPException(status_code=502, detail="루틴 fire 실패 (서버 로그 확인)")
    return {"ok": True, "text": text}


@router.get("/analytics/users/{user_id}")
def analytics_user_history(user_id: str, limit: int = 200, admin_id: str = Depends(require_admin)):
    rows = query(
        "SELECT event_name, properties, created_at FROM user_events "
        "WHERE user_id = %s ORDER BY created_at DESC LIMIT %s",
        (user_id, limit),
    )
    return [
        {
            "event_name": r["event_name"],
            "properties": r["properties"],
            "created_at": r["created_at"].isoformat() if r["created_at"] else None,
        }
        for r in rows
    ]

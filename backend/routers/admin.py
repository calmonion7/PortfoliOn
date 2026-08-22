# backend/routers/admin.py
import logging

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from typing import Dict, List

from auth import require_admin, require_admin_or_api_key
from services.db import query, execute, get_connection
from services import cache as cache_svc

logger = logging.getLogger(__name__)

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


# 사용자 삭제 대상·순서. users를 마지막에 두는 것은 자식 테이블이 users(id)를 FK로
# 참조하기 때문이다. 테이블·컬럼명은 이 코드 내 리터럴이라 f-string 조립이 주입 불가다 —
# 외부 입력을 여기 넣지 말 것(값은 항상 %s 바인딩으로).
_USER_DELETE_TARGETS = [
    ("user_stocks", "user_id"),
    ("user_menu_permissions", "user_id"),
    ("refresh_tokens", "user_id"),
    ("digests", "user_id"),
    ("calendar_cache", "user_id"),
    ("users", "id"),
]


@router.delete("/users/{user_id}")
def delete_user(user_id: str, admin_id: str = Depends(require_admin)):
    """사용자와 그 소유 행을 **단일 트랜잭션**으로 삭제한다 (B5).

    `db.execute`는 호출마다 커넥션을 새로 얻어 커밋하므로 예전 구현(확인 query 1 + 삭제
    execute 6)은 7개 독립 트랜잭션이었다 — 중간 실패가 「로그인은 되는데 종목·권한이 전부
    사라진 계정」이나 고아 행을 영구히 남겼다. 한 커넥션에서 순차 실행하면 어느 단계가
    실패해도 `get_connection`이 전체를 롤백한다(부분 삭제 0).
    """
    stage = "select"
    try:
        with get_connection() as conn:
            with conn.cursor() as cur:
                # 가드 read를 삭제와 같은 트랜잭션에 두고 FOR UPDATE로 행을 잠근다 —
                # 확인과 삭제가 다른 트랜잭션이면 그 틈의 admin 승격이 아래 403을 우회한다.
                cur.execute(
                    "SELECT role, oauth_provider FROM users WHERE id = %s FOR UPDATE",
                    (user_id,),
                )
                row = cur.fetchone()
                if not row:
                    raise HTTPException(status_code=404, detail="사용자를 찾을 수 없습니다")
                role, oauth_provider = row
                if role == "admin":
                    raise HTTPException(status_code=403, detail="어드민 계정은 삭제할 수 없습니다")
                if oauth_provider:
                    raise HTTPException(status_code=403, detail="소셜 로그인 계정은 삭제할 수 없습니다")
                for table, col in _USER_DELETE_TARGETS:
                    stage = table
                    cur.execute(f"DELETE FROM {table} WHERE {col} = %s", (user_id,))
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"[Admin] 사용자 삭제 롤백 ({user_id}, 단계={stage}): {e}")
        raise HTTPException(
            status_code=500,
            detail=f"사용자 삭제 실패 — {stage} 단계에서 롤백됨(변경된 행 없음)",
        )
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

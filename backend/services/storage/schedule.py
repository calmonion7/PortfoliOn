# backend/services/storage/schedule.py
import json
from typing import Optional
from services.db import query, execute


# ── 전역 함수 ─────────────────────────────────────────────────────────────────

def get_schedule() -> dict:
    rows = query("SELECT data FROM schedules WHERE id = 1")
    if rows:
        return rows[0]["data"]
    return {"enabled": False, "time": "08:00", "days": ["mon", "tue", "wed", "thu", "fri"]}


def get_guru_managers() -> dict:
    rows = query("SELECT data FROM guru_managers WHERE id = 1")
    if rows:
        return rows[0]["data"]
    return {"last_updated": None, "managers": []}


def save_guru_managers(data: dict) -> dict:
    """부분 크롤을 직전값으로 백필해 저장. 반환 {"saved", "fresh", "stale", "dropped"}.

    CLAUDE.md "빈/all-None 결과 캐시 박제 금지". 판정을 writer가 소유해 호출부
    가드 중복을 만들지 않는다.

    처방이 커버리지 임계가 아니라 **개별 백필**인 이유(BH7-H1): 구루 매니저는 서로 합산되지
    않고 각자 카드로 표시되는 **독립 항목**이라, CLAUDE.md ⭐가드 ③ⓒ가 지정하는 처방이
    "실패분만 개별 백필"이다. 임계를 걸면 83명 중 40명이 성공했을 때 그 40명까지 버린다.
    이전에는 게이트가 `if not data["managers"]` all-or-nothing이라 40명짜리 목록도
    "비어있지 않음"으로 통과해 단일 행을 통째 치환하고 43명을 소멸시켰다.

    `roster`(명부)는 "실패해서 빠짐"과 "상류에서 은퇴함"을 가르는 유일한 단서다 —
    전자는 직전값으로 백필하고 후자는 드롭한다. 명부가 없으면 드롭 판단을 하지 않는다.
    """
    fresh = data.get("managers") or []
    # ⚠️ 전량실패 판정은 반드시 백필 **앞**이다. 뒤로 가면 백필이 목록을 채워 이 분기가
    #    영영 발동하지 않는다 — get_treasury()가 정확히 그 순서로 죽어 있다(BH7-L1).
    if not fresh:
        return {"saved": False, "fresh": 0, "stale": 0, "dropped": 0}

    fresh_by_id = {m["id"]: m for m in fresh if m.get("id")}
    stored_by_id = {m["id"]: m for m in (get_guru_managers().get("managers") or []) if m.get("id")}
    roster_ids = [r["id"] for r in (data.get("roster") or []) if r.get("id")]
    if not roster_ids:
        # 명부 미제공 — 신선분을 앞에 두고 저장분을 보존하되, 은퇴 판단은 하지 않는다.
        roster_ids = list(fresh_by_id) + [i for i in stored_by_id if i not in fresh_by_id]

    merged, stale = [], 0
    for mid in roster_ids:
        if mid in fresh_by_id:
            merged.append(fresh_by_id[mid])
        elif mid in stored_by_id:
            merged.append(stored_by_id[mid])
            stale += 1

    payload = {k: v for k, v in data.items() if k != "roster"}
    payload["managers"] = merged
    execute(
        "INSERT INTO guru_managers (id, data) VALUES (1, %s) ON CONFLICT (id) DO UPDATE SET data=EXCLUDED.data",
        (json.dumps(payload),),
    )
    return {
        "saved": True,
        "fresh": len(fresh_by_id),
        "stale": stale,
        "dropped": sum(1 for i in stored_by_id if i not in set(roster_ids)),
    }


def get_guru_schedule() -> dict:
    rows = query("SELECT data FROM guru_schedules WHERE id = 1")
    if rows:
        return rows[0]["data"]
    return {"enabled": False, "day": "sun", "time": "03:00"}


def save_guru_schedule(schedule: dict) -> None:
    execute(
        "INSERT INTO guru_schedules (id, data) VALUES (1, %s) ON CONFLICT (id) DO UPDATE SET data=EXCLUDED.data",
        (json.dumps(schedule),),
    )


def get_batch_schedule(job_id: str) -> Optional[dict]:
    rows = query("SELECT data FROM batch_schedules WHERE job_id = %s", (job_id,))
    if rows:
        return rows[0]["data"]
    return None


def save_batch_schedule(job_id: str, spec: dict) -> None:
    execute(
        "INSERT INTO batch_schedules (job_id, data) VALUES (%s, %s) ON CONFLICT (job_id) DO UPDATE SET data=EXCLUDED.data",
        (job_id, json.dumps(spec)),
    )


def get_all_batch_schedules() -> dict:
    rows = query("SELECT job_id, data FROM batch_schedules")
    return {r["job_id"]: r["data"] for r in rows}

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


# 명부가 직전 저장분 대비 이 비율 미만이면 그 회차의 드롭을 보류한다(B28).
# 0.8인 이유: 정상 은퇴는 회차당 한 자릿수이고(83명 중 17명 동시 은퇴는 비현실적),
# 마크업 변경으로 인한 열화는 대개 그보다 훨씬 크게 깎인다(관측된 사례는 83→40).
_ROSTER_MIN_COVERAGE = 0.8


def save_guru_managers(data: dict) -> dict:
    """부분 크롤을 직전값으로 백필해 저장. 반환 {"saved", "fresh", "stale", "dropped", "held"}.

    CLAUDE.md "빈/all-None 결과 캐시 박제 금지". 판정을 writer가 소유해 호출부
    가드 중복을 만들지 않는다.

    처방이 커버리지 임계가 아니라 **개별 백필**인 이유(BH7-H1): 구루 매니저는 서로 합산되지
    않고 각자 카드로 표시되는 **독립 항목**이라, CLAUDE.md ⭐가드 ③ⓒ가 지정하는 처방이
    "실패분만 개별 백필"이다. 임계를 걸면 83명 중 40명이 성공했을 때 그 40명까지 버린다.
    이전에는 게이트가 `if not data["managers"]` all-or-nothing이라 40명짜리 목록도
    "비어있지 않음"으로 통과해 단일 행을 통째 치환하고 43명을 소멸시켰다.

    `roster`(명부)는 "실패해서 빠짐"과 "상류에서 은퇴함"을 가르는 유일한 단서다 —
    전자는 직전값으로 백필하고 후자는 드롭한다. 명부가 없으면 드롭 판단을 하지 않는다.

    그래서 **명부 자체의 신뢰성이 load-bearing**이다(B28). `scrape_manager_ids`는 HTTP 200 +
    마크업 변경이면 예외 없이 *짧은* 명부를 반환하고, 짧은 명부는 생존 매니저를 '은퇴'로
    오분류해 드롭시킨다. 그래서 명부가 직전 저장분의 `_ROSTER_MIN_COVERAGE` 미만이면 그
    회차의 드롭을 **보류**한다(`held`). 여기서는 커버리지 임계가 맞다 — 판정 대상이 개별
    매니저가 아니라 **명부라는 단일 판단 축의 신뢰도**이기 때문이다(개별 매니저 fetch 실패는
    위의 백필이 이미 처리한다).

    보류에 탈출구(강제 플래그·연속 관측 카운터)를 두지 않는 이유: 백필이 `stored`를 유지하니
    보류 중에도 데이터는 온전하고, 보류는 매 회차 경고로 **눈에 보인다**. 명부가 진짜로 임계
    밑까지 줄면 사람이 보고 판단한다. 그리고 **드롭은 영구 삭제가 아니다** — 다음 정상 크롤이
    같은 계산을 다시 해서 복원하므로, 한 회차 보류의 비용은 '은퇴 반영이 1회 늦어짐'뿐이다.
    """
    fresh = data.get("managers") or []
    # ⚠️ 전량실패 판정은 반드시 백필 **앞**이다. 뒤로 가면 백필이 목록을 채워 이 분기가
    #    영영 발동하지 않는다 — get_treasury()가 정확히 그 순서로 죽어 있다(BH7-L1).
    if not fresh:
        return {"saved": False, "fresh": 0, "stale": 0, "dropped": 0, "held": 0}

    fresh_by_id = {m["id"]: m for m in fresh if m.get("id")}
    stored_by_id = {m["id"]: m for m in (get_guru_managers().get("managers") or []) if m.get("id")}
    roster_ids = [r["id"] for r in (data.get("roster") or []) if r.get("id")]
    held = 0
    if not roster_ids:
        # 명부 미제공 — 신선분을 앞에 두고 저장분을 보존하되, 은퇴 판단은 하지 않는다.
        roster_ids = list(fresh_by_id) + [i for i in stored_by_id if i not in fresh_by_id]
    elif stored_by_id and len(roster_ids) < _ROSTER_MIN_COVERAGE * len(stored_by_id):
        # ⚠️ 판정은 merged 구성 **앞**이다 — 뒤로 가면 백필이 목록을 채워 영영 발동하지 않는다
        #    (BH7-L1의 get_treasury()가 정확히 그 순서로 죽어 있다).
        # 명부가 짧다 = 명부를 못 믿는다 → 이 회차의 드롭을 보류한다. 명부 미제공 폴백과
        # 같은 shape(명부 순서 앞, 보존분 뒤)을 재사용하므로 결과적으로 dropped == 0이 된다.
        missing = [i for i in stored_by_id if i not in roster_ids]
        held = len(missing)
        roster_ids = roster_ids + missing

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
        "held": held,
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

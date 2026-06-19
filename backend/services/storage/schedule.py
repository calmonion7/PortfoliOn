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


def save_guru_managers(data: dict) -> None:
    execute(
        "INSERT INTO guru_managers (id, data) VALUES (1, %s) ON CONFLICT (id) DO UPDATE SET data=EXCLUDED.data",
        (json.dumps(data),),
    )


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

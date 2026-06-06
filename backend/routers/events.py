# backend/routers/events.py
import json
from fastapi import APIRouter, BackgroundTasks, Depends
from pydantic import BaseModel
from auth import get_current_user
from services.db import execute

VALID_EVENTS = {
    "nav_portfolio", "nav_research", "nav_market", "nav_guru", "nav_settings",
    "tab_holdings", "tab_watch", "tab_analysis", "tab_dash",
    "tab_reports", "tab_digest", "tab_calendar", "tab_ranking",
    "report_view_open", "report_tab_switch",
    "ranking_row_click",
    "stock_search",
}

router = APIRouter(prefix="/api/events", tags=["events"])


class EventBody(BaseModel):
    event_name: str
    properties: dict = {}


def _persist(user_id: str, event_name: str, properties: dict):
    try:
        execute(
            "INSERT INTO user_events (user_id, event_name, properties) VALUES (%s, %s, %s)",
            (user_id, event_name, json.dumps(properties)),
        )
    except Exception:
        pass


@router.post("")
def track_event(
    body: EventBody,
    background_tasks: BackgroundTasks,
    user_id: str = Depends(get_current_user),
):
    if body.event_name not in VALID_EVENTS:
        return {"ok": True}
    background_tasks.add_task(_persist, user_id, body.event_name, body.properties)
    return {"ok": True}

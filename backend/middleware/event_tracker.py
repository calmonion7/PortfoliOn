# backend/middleware/event_tracker.py
import asyncio
import json
import os
import re

from jose import JWTError, jwt
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request

_TRACKED = [
    ("POST",   re.compile(r"^/api/portfolio$"),                 "stock_add",       "body"),
    ("DELETE", re.compile(r"^/api/portfolio/([^/]+)$"),         "stock_delete",    "path:1"),
    ("POST",   re.compile(r"^/api/watchlist$"),                 "stock_add",       "body"),
    ("DELETE", re.compile(r"^/api/watchlist/([^/]+)$"),         "stock_delete",    "path:1"),
    ("POST",   re.compile(r"^/api/watchlist/([^/]+)/promote$"), "stock_promote",   "path:1"),
    ("POST",   re.compile(r"^/api/report/generate/([^/]+)$"),   "report_generate", "path:1"),
    ("POST",   re.compile(r"^/api/guru/crawl$"),                "guru_crawl",      None),
]


def _match_route(method: str, path: str):
    for req_method, pattern, event_name, ticker_source in _TRACKED:
        if method == req_method:
            m = pattern.match(path)
            if m:
                return event_name, ticker_source, m
    return None


def _extract_user_id_from_header(auth_header: str):
    if not auth_header.startswith("Bearer "):
        return None
    try:
        payload = jwt.decode(auth_header[7:], os.environ["JWT_SECRET"], algorithms=["HS256"])
        return payload.get("sub")
    except (JWTError, KeyError):
        return None


async def _save_event(user_id: str, event_name: str, properties: dict):
    from services.db import execute
    try:
        execute(
            "INSERT INTO user_events (user_id, event_name, properties) VALUES (%s, %s, %s)",
            (user_id, event_name, json.dumps(properties)),
        )
    except Exception:
        pass


class EventTrackerMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        matched = _match_route(request.method, request.url.path)

        cached_body = None
        if matched and matched[1] == "body":
            cached_body = await request.body()

        response = await call_next(request)

        if matched and 200 <= response.status_code < 300:
            event_name, ticker_source, m = matched
            user_id = _extract_user_id_from_header(request.headers.get("Authorization", ""))
            if user_id:
                props = {}
                if ticker_source == "body" and cached_body:
                    try:
                        props["ticker"] = json.loads(cached_body).get("ticker", "").upper()
                    except Exception:
                        pass
                elif ticker_source and ticker_source.startswith("path:"):
                    props["ticker"] = m.group(int(ticker_source[5:])).upper()
                props = {k: v for k, v in props.items() if v}
                asyncio.create_task(_save_event(user_id, event_name, props))

        return response

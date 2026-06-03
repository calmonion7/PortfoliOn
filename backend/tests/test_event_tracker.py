# backend/tests/test_event_tracker.py
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent.parent))

import os
import pytest
from middleware.event_tracker import _match_route, _extract_user_id_from_header


def test_match_portfolio_post():
    result = _match_route("POST", "/api/portfolio")
    assert result is not None
    event_name, ticker_source, _ = result
    assert event_name == "stock_add"
    assert ticker_source == "body"


def test_match_portfolio_delete():
    result = _match_route("DELETE", "/api/portfolio/AAPL")
    assert result is not None
    event_name, ticker_source, m = result
    assert event_name == "stock_delete"
    assert m.group(1) == "AAPL"


def test_match_watchlist_promote():
    result = _match_route("POST", "/api/watchlist/TSLA/promote")
    assert result is not None
    event_name, ticker_source, m = result
    assert event_name == "stock_promote"
    assert m.group(1) == "TSLA"


def test_match_report_generate():
    result = _match_route("POST", "/api/report/generate/MSFT")
    assert result is not None
    event_name, ticker_source, m = result
    assert event_name == "report_generate"
    assert m.group(1) == "MSFT"


def test_match_guru_crawl():
    result = _match_route("POST", "/api/guru/crawl")
    assert result is not None
    event_name, _, _ = result
    assert event_name == "guru_crawl"


def test_no_match_for_get():
    assert _match_route("GET", "/api/portfolio") is None


def test_no_match_for_unknown_path():
    assert _match_route("POST", "/api/unknown/path") is None


def test_extract_user_id_valid(monkeypatch):
    from jose import jwt
    monkeypatch.setenv("JWT_SECRET", "test-secret")
    token = jwt.encode({"sub": "user-1"}, "test-secret", algorithm="HS256")
    result = _extract_user_id_from_header(f"Bearer {token}")
    assert result == "user-1"


def test_extract_user_id_invalid(monkeypatch):
    monkeypatch.setenv("JWT_SECRET", "test-secret")
    result = _extract_user_id_from_header("Bearer invalid-token")
    assert result is None


def test_extract_user_id_no_header(monkeypatch):
    monkeypatch.setenv("JWT_SECRET", "test-secret")
    assert _extract_user_id_from_header("") is None

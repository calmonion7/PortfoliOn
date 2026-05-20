import pytest
from pathlib import Path
from unittest.mock import patch


def test_get_holdings_from_unified(tmp_path):
    import services.storage as s
    with patch("services.storage.DATA_DIR", tmp_path):
        s._save_unified([
            {"ticker": "LLY", "type": "holding", "quantity": 3.0, "avg_cost": 886.6,
             "name": "일라이 릴리", "market": "US", "exchange": "",
             "competitors": [], "moat": "", "growth_plan": "", "risks": "", "recent_disclosures": ""},
            {"ticker": "TSLA", "type": "watchlist", "quantity": None, "avg_cost": None,
             "name": "테슬라", "market": "US", "exchange": "",
             "competitors": [], "moat": "", "growth_plan": "", "risks": "", "recent_disclosures": ""},
        ])
        holdings = s.get_holdings()
    assert len(holdings) == 1
    assert holdings[0]["ticker"] == "LLY"
    assert holdings[0]["quantity"] == 3.0
    assert "moat" not in holdings[0]


def test_get_watchlist_tickers_from_unified(tmp_path):
    import services.storage as s
    with patch("services.storage.DATA_DIR", tmp_path):
        s._save_unified([
            {"ticker": "LLY", "type": "holding", "quantity": 3.0, "avg_cost": 886.6,
             "name": "LLY", "market": "US", "exchange": "",
             "competitors": [], "moat": "", "growth_plan": "", "risks": "", "recent_disclosures": ""},
            {"ticker": "TSLA", "type": "watchlist", "quantity": None, "avg_cost": None,
             "name": "TSLA", "market": "US", "exchange": "",
             "competitors": [], "moat": "", "growth_plan": "", "risks": "", "recent_disclosures": ""},
        ])
        tickers = s.get_watchlist_tickers()
    assert tickers == ["TSLA"]


def test_save_holdings_updates_unified(tmp_path):
    import services.storage as s
    with patch("services.storage.DATA_DIR", tmp_path):
        s._save_unified([
            {"ticker": "LLY", "type": "holding", "quantity": 3.0, "avg_cost": 886.6,
             "name": "LLY", "market": "US", "exchange": "",
             "competitors": [], "moat": "Strong", "growth_plan": "", "risks": "", "recent_disclosures": ""},
        ])
        s.save_holdings([{"ticker": "LLY", "quantity": 5.0, "avg_cost": 900.0, "market": "US", "exchange": ""}])
        unified = s._get_unified()
    lly = next(x for x in unified if x["ticker"] == "LLY")
    assert lly["quantity"] == 5.0
    assert lly["avg_cost"] == 900.0
    assert lly["moat"] == "Strong"  # analyst fields preserved


def test_save_holdings_demotes_removed_to_watchlist(tmp_path):
    import services.storage as s
    with patch("services.storage.DATA_DIR", tmp_path):
        s._save_unified([
            {"ticker": "LLY", "type": "holding", "quantity": 3.0, "avg_cost": 886.6,
             "name": "LLY", "market": "US", "exchange": "",
             "competitors": [], "moat": "", "growth_plan": "", "risks": "", "recent_disclosures": ""},
            {"ticker": "PLTR", "type": "holding", "quantity": 10.0, "avg_cost": 50.0,
             "name": "PLTR", "market": "US", "exchange": "",
             "competitors": [], "moat": "", "growth_plan": "", "risks": "", "recent_disclosures": ""},
        ])
        s.save_holdings([{"ticker": "PLTR", "quantity": 10.0, "avg_cost": 50.0, "market": "US", "exchange": ""}])
        unified = s._get_unified()
    lly = next((x for x in unified if x["ticker"] == "LLY"), None)
    assert lly is not None
    assert lly["type"] == "watchlist"
    assert lly["quantity"] is None


def test_save_watchlist_tickers_adds_to_unified(tmp_path):
    import services.storage as s
    with patch("services.storage.DATA_DIR", tmp_path):
        s._save_unified([])
        s.save_watchlist_tickers(["AAPL", "GOOG"])
        unified = s._get_unified()
    tickers = {x["ticker"] for x in unified}
    assert "AAPL" in tickers
    assert "GOOG" in tickers
    assert all(x["type"] == "watchlist" for x in unified)


def test_save_watchlist_does_not_demote_holdings(tmp_path):
    import services.storage as s
    with patch("services.storage.DATA_DIR", tmp_path):
        s._save_unified([
            {"ticker": "LLY", "type": "holding", "quantity": 3.0, "avg_cost": 886.6,
             "name": "LLY", "market": "US", "exchange": "",
             "competitors": [], "moat": "", "growth_plan": "", "risks": "", "recent_disclosures": ""},
        ])
        s.save_watchlist_tickers(["TSLA"])
        unified = s._get_unified()
    lly = next(x for x in unified if x["ticker"] == "LLY")
    assert lly["type"] == "holding"  # not demoted


def test_save_stocks_updates_analyst_fields(tmp_path):
    import services.storage as s
    with patch("services.storage.DATA_DIR", tmp_path):
        s._save_unified([
            {"ticker": "LLY", "type": "holding", "quantity": 3.0, "avg_cost": 886.6,
             "name": "Old Name", "market": "US", "exchange": "",
             "competitors": [], "moat": "", "growth_plan": "", "risks": "", "recent_disclosures": ""},
        ])
        s.save_stocks([{"ticker": "LLY", "name": "New Name", "competitors": ["NVO"],
                        "moat": "Strong", "growth_plan": "GLP1", "market": "US", "exchange": ""}])
        unified = s._get_unified()
    lly = next(x for x in unified if x["ticker"] == "LLY")
    assert lly["name"] == "New Name"
    assert lly["moat"] == "Strong"
    assert lly["type"] == "holding"  # type preserved
    assert lly["quantity"] == 3.0   # position preserved


def test_save_stocks_removes_non_holdings_not_in_list(tmp_path):
    import services.storage as s
    with patch("services.storage.DATA_DIR", tmp_path):
        s._save_unified([
            {"ticker": "LLY", "type": "holding", "quantity": 3.0, "avg_cost": 886.6,
             "name": "LLY", "market": "US", "exchange": "",
             "competitors": [], "moat": "", "growth_plan": "", "risks": "", "recent_disclosures": ""},
            {"ticker": "TSLA", "type": "watchlist", "quantity": None, "avg_cost": None,
             "name": "TSLA", "market": "US", "exchange": "",
             "competitors": [], "moat": "", "growth_plan": "", "risks": "", "recent_disclosures": ""},
        ])
        s.save_stocks([{"ticker": "LLY", "name": "LLY", "competitors": [],
                        "moat": "", "growth_plan": "", "market": "US", "exchange": ""}])
        unified = s._get_unified()
    tickers = {x["ticker"] for x in unified}
    assert "LLY" in tickers   # holding stays
    assert "TSLA" not in tickers  # watchlist removed


def test_get_full_portfolio_splits_by_type(tmp_path):
    import services.storage as s
    with patch("services.storage.DATA_DIR", tmp_path):
        s._save_unified([
            {"ticker": "LLY", "type": "holding", "quantity": 3.0, "avg_cost": 886.6,
             "name": "일라이 릴리", "market": "US", "exchange": "",
             "competitors": ["NVO"], "moat": "Brand", "growth_plan": "GLP1",
             "risks": "", "recent_disclosures": ""},
            {"ticker": "TSLA", "type": "watchlist", "quantity": None, "avg_cost": None,
             "name": "테슬라", "market": "US", "exchange": "",
             "competitors": [], "moat": "", "growth_plan": "", "risks": "", "recent_disclosures": ""},
        ])
        result = s.get_full_portfolio()
    assert len(result["stocks"]) == 1
    assert result["stocks"][0]["ticker"] == "LLY"
    assert len(result["watchlist"]) == 1
    assert result["watchlist"][0]["ticker"] == "TSLA"


def test_get_holdings_returns_empty_when_file_missing():
    import services.storage as s
    original = s.DATA_DIR
    s.DATA_DIR = Path("/nonexistent_dir_xyz")
    try:
        result = s.get_holdings()
    finally:
        s.DATA_DIR = original
    assert result == []


def test_enrich_stock_updates_in_unified(tmp_path):
    import services.storage as s
    with patch("services.storage.DATA_DIR", tmp_path):
        s._save_unified([
            {"ticker": "LLY", "type": "holding", "quantity": 3.0, "avg_cost": 886.6,
             "name": "LLY", "market": "US", "exchange": "",
             "competitors": [], "moat": "", "growth_plan": "", "risks": "", "recent_disclosures": ""},
        ])
        result = s.enrich_stock("LLY", {"moat": "Strong brand"})
        assert result is True
        unified = s._get_unified()
    lly = next(x for x in unified if x["ticker"] == "LLY")
    assert lly["moat"] == "Strong brand"
    assert lly["type"] == "holding"  # preserved


def test_enrich_stock_returns_false_for_unknown_ticker(tmp_path):
    import services.storage as s
    with patch("services.storage.DATA_DIR", tmp_path):
        s._save_unified([])
        result = s.enrich_stock("UNKNOWN", {"moat": "test"})
    assert result is False

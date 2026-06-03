import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent.parent))

import pytest
from unittest.mock import patch, MagicMock


def _kofia_response(items: list) -> dict:
    return {
        "response": {
            "body": {
                "items": {"item": items},
                "totalCount": len(items),
                "numOfRows": 1000,
                "pageNo": 1,
            }
        }
    }


def test_fetch_credit_balance_returns_list():
    from services.leverage_service import _fetch_credit_balance
    fake_items = [
        {
            "basDt": "20260602",
            "crdTrFingScrs": "152000000",
            "crdTrFingKosdaq": "91000000",
        }
    ]
    mock_resp = MagicMock()
    mock_resp.json.return_value = _kofia_response(fake_items)
    mock_resp.raise_for_status = lambda: None
    with patch("services.leverage_service.requests.get", return_value=mock_resp):
        result = _fetch_credit_balance("20260601", "20260602")
    assert len(result) == 1
    assert result[0]["date"] == "2026-06-02"
    assert result[0]["kospi_credit_balance"] == pytest.approx(152000000.0)
    assert result[0]["kosdaq_credit_balance"] == pytest.approx(91000000.0)


def test_fetch_market_fund_returns_list():
    from services.leverage_service import _fetch_market_fund
    fake_items = [
        {
            "basDt": "20260602",
            "invrDpsgAmt": "580000000",
            "brkTrdUcolMny": "8200000",
            "brkTrdUcolMnyVsOppsTrdAmt": "52000000",
            "ucolMnyVsOppsTrdRlImpt": "6.34",
        }
    ]
    mock_resp = MagicMock()
    mock_resp.json.return_value = _kofia_response(fake_items)
    mock_resp.raise_for_status = lambda: None
    with patch("services.leverage_service.requests.get", return_value=mock_resp):
        result = _fetch_market_fund("20260601", "20260602")
    assert len(result) == 1
    row = result[0]
    assert row["date"] == "2026-06-02"
    assert row["customer_deposit"] == pytest.approx(580000000.0)
    assert row["total_misu_amt"] == pytest.approx(8200000.0)
    assert row["liquidated_amt"] == pytest.approx(52000000.0)
    assert row["liquidation_ratio"] == pytest.approx(6.34)


def test_fetch_market_cap_returns_kospi_and_kosdaq():
    from services.leverage_service import _fetch_market_cap
    fake_items = [
        {"basDt": "20260602", "idxNm": "코스피", "lstgMrktTotAmt": "2100000000"},
        {"basDt": "20260602", "idxNm": "코스닥", "lstgMrktTotAmt": "420000000"},
    ]
    mock_resp = MagicMock()
    mock_resp.json.return_value = _kofia_response(fake_items)
    mock_resp.raise_for_status = lambda: None
    with patch("services.leverage_service.requests.get", return_value=mock_resp):
        result = _fetch_market_cap("20260601", "20260602")
    assert len(result) == 1
    assert result[0]["date"] == "2026-06-02"
    assert result[0]["kospi_market_cap"] == pytest.approx(2100000000.0)
    assert result[0]["kosdaq_market_cap"] == pytest.approx(420000000.0)


def test_upsert_and_query_rows(monkeypatch):
    import services.leverage_service as svc
    store: dict[str, dict] = {}

    def fake_execute(sql, params=None):
        if params and len(params) >= 9:
            store[str(params[0])] = {
                "base_date": params[0],
                "kospi_credit_balance": params[1],
                "kosdaq_credit_balance": params[2],
                "kospi_market_cap": params[3],
                "kosdaq_market_cap": params[4],
                "total_misu_amt": params[5],
                "liquidated_amt": params[6],
                "liquidation_ratio": params[7],
                "customer_deposit": params[8],
            }
        return 1

    def fake_query(sql, params=None):
        return list(store.values())

    monkeypatch.setattr(svc, "execute", fake_execute)
    monkeypatch.setattr(svc, "query", fake_query)

    svc._upsert_rows([{
        "date": "2026-06-02",
        "kospi_credit_balance": 152000000.0,
        "kosdaq_credit_balance": 91000000.0,
        "kospi_market_cap": 2100000000.0,
        "kosdaq_market_cap": 420000000.0,
        "total_misu_amt": 8200000.0,
        "liquidated_amt": 52000000.0,
        "liquidation_ratio": 6.34,
        "customer_deposit": 580000000.0,
    }])
    rows = svc._query_rows()
    assert len(rows) == 1
    assert rows[0]["kospi_credit_balance"] == pytest.approx(152000000.0)


def test_fetch_and_store_merges_three_apis(monkeypatch):
    import services.leverage_service as svc

    credit_data = [{"date": "2026-06-02", "kospi_credit_balance": 1.0, "kosdaq_credit_balance": 2.0}]
    fund_data = [{"date": "2026-06-02", "customer_deposit": 3.0, "total_misu_amt": 4.0,
                  "liquidated_amt": 5.0, "liquidation_ratio": 6.0}]
    cap_data  = [{"date": "2026-06-02", "kospi_market_cap": 7.0, "kosdaq_market_cap": 8.0}]

    monkeypatch.setattr(svc, "_fetch_credit_balance", lambda s, e: credit_data)
    monkeypatch.setattr(svc, "_fetch_market_fund", lambda s, e: fund_data)
    monkeypatch.setattr(svc, "_fetch_market_cap", lambda s, e: cap_data)

    upserted = []
    monkeypatch.setattr(svc, "_upsert_rows", lambda rows: upserted.extend(rows))

    svc.fetch_and_store("2026-06-02")

    assert len(upserted) == 1
    row = upserted[0]
    assert row["kospi_credit_balance"] == 1.0
    assert row["kospi_market_cap"] == 7.0
    assert row["liquidation_ratio"] == 6.0


def _make_df_rows(n: int, lqdt_ratio_override=None):
    rows = []
    for i in range(n):
        rows.append({
            "base_date": f"2026-{(i // 28 + 1):02d}-{(i % 28 + 1):02d}",
            "kospi_credit_balance": float(100_000 + i * 100),
            "kosdaq_credit_balance": float(60_000 + i * 60),
            "kospi_market_cap": float(2_100_000_000),
            "kosdaq_market_cap": float(420_000_000),
            "total_misu_amt": float(8_000_000),
            "liquidated_amt": float(500_000),
            "liquidation_ratio": lqdt_ratio_override if lqdt_ratio_override is not None else 6.5,
            "customer_deposit": float(580_000_000),
        })
    return rows


def test_get_leverage_data_structure(monkeypatch):
    import services.leverage_service as svc
    monkeypatch.setattr(svc, "_query_rows", lambda days=None: _make_df_rows(60))
    result = svc.get_leverage_data(days=30)
    assert "history" in result
    assert "signals" in result
    assert "latest" in result
    assert len(result["history"]) <= 30
    assert "credit_ratio_alert" in result["signals"]
    assert "margin_call_signal" in result["signals"]
    assert "credit_momentum" in result["signals"]


def test_margin_call_signal_triggers_on_spike(monkeypatch):
    import services.leverage_service as svc
    rows = _make_df_rows(25)
    rows[-1]["liquidation_ratio"] = 50.0  # 극단적 스파이크
    monkeypatch.setattr(svc, "_query_rows", lambda days=None: rows)
    result = svc.get_leverage_data()
    assert result["signals"]["margin_call_signal"] == "ALERT"


def test_margin_call_signal_null_when_normal(monkeypatch):
    import services.leverage_service as svc
    monkeypatch.setattr(svc, "_query_rows", lambda days=None: _make_df_rows(60))
    result = svc.get_leverage_data()
    assert result["signals"]["margin_call_signal"] is None


def test_credit_momentum_accelerating(monkeypatch):
    import services.leverage_service as svc
    rows = _make_df_rows(30)
    for i in range(20, 30):
        rows[i]["kospi_credit_balance"] = float(200_000 + (i - 20) * 5_000)
        rows[i]["kosdaq_credit_balance"] = float(120_000 + (i - 20) * 3_000)
    monkeypatch.setattr(svc, "_query_rows", lambda days=None: rows)
    result = svc.get_leverage_data()
    assert result["signals"]["credit_momentum"] == "ACCELERATING"


def test_credit_ratio_history_field(monkeypatch):
    import services.leverage_service as svc
    monkeypatch.setattr(svc, "_query_rows", lambda days=None: _make_df_rows(30))
    result = svc.get_leverage_data(days=30)
    assert all("credit_ratio" in h for h in result["history"])
    assert all(h["credit_ratio"] is not None for h in result["history"])

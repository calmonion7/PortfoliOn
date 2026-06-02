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

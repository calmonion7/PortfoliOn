"""investor_service.fetch_trend 키움 우선 + Naver 폴백 (Phase 2 part 3, S2)."""
from datetime import date
from unittest.mock import patch
from services import investor_service


def test_fetch_trend_uses_kiwoom_when_configured():
    krows = [{"base_date": date(2026, 6, 12), "foreign_net": 2906596, "organ_net": 0,
              "individual_net": 0, "foreign_hold_ratio": 47.63, "close_price": 322500}]
    with patch("services.kiwoom.client.configured", return_value=True), \
         patch("services.kiwoom.investor.fetch_trend_rows", return_value=krows):
        out = investor_service.fetch_trend("005930")
    assert out == krows


def test_fetch_trend_falls_back_to_naver_when_unconfigured():
    nrows = [{"base_date": date(2026, 6, 11), "foreign_net": 1, "organ_net": 2,
              "individual_net": 3, "foreign_hold_ratio": 10.0, "close_price": 100}]
    with patch("services.kiwoom.client.configured", return_value=False), \
         patch("services.investor_service._fetch_trend_naver", return_value=nrows) as m:
        out = investor_service.fetch_trend("005930", bizdate="20260611")
    assert m.called and out == nrows


def test_fetch_trend_falls_back_when_kiwoom_raises():
    nrows = [{"base_date": date(2026, 6, 10)}]
    with patch("services.kiwoom.client.configured", return_value=True), \
         patch("services.kiwoom.investor.fetch_trend_rows", side_effect=RuntimeError("키움 장애")), \
         patch("services.investor_service._fetch_trend_naver", return_value=nrows):
        out = investor_service.fetch_trend("005930")
    assert out == nrows

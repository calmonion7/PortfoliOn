"""upsert_trend 배치화 — execute_many 1콜 단언 (S2)."""
from datetime import date
from unittest.mock import patch, call


def _inv_row(d, fnet=0):
    return {"base_date": d, "foreign_net": fnet, "organ_net": 1,
            "individual_net": 2, "foreign_hold_ratio": 50.0, "close_price": 100}


def _ss_row(d, vol=10):
    return {"base_date": d, "short_volume": vol, "short_value": 100,
            "short_ratio": 1.0, "short_balance": 500, "close_price": 200}


def test_investor_upsert_trend_calls_execute_many_once():
    from services import investor_service as svc
    rows = [_inv_row(date(2026, 6, 5), fnet=111), _inv_row(date(2026, 6, 4), fnet=222)]
    with patch("services.investor_service.execute_many") as m:
        svc.upsert_trend("005930", rows)
    m.assert_called_once()
    _, params_list = m.call_args[0]
    assert len(params_list) == 2
    assert params_list[0] == ("005930", date(2026, 6, 5), 111, 1, 2, 50.0, 100)
    assert params_list[1] == ("005930", date(2026, 6, 4), 222, 1, 2, 50.0, 100)


def test_short_sell_upsert_trend_calls_execute_many_once():
    from services import short_sell_service as svc
    rows = [_ss_row(date(2026, 6, 5), vol=10), _ss_row(date(2026, 6, 4), vol=20)]
    with patch("services.short_sell_service.execute_many") as m:
        svc.upsert_trend("005930", rows)
    m.assert_called_once()
    _, params_list = m.call_args[0]
    assert len(params_list) == 2
    assert params_list[0] == ("005930", date(2026, 6, 5), 10, 100, 1.0, 500, 200)
    assert params_list[1] == ("005930", date(2026, 6, 4), 20, 100, 1.0, 500, 200)

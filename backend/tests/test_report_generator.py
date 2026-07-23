import json
import pytest
from pathlib import Path
from unittest.mock import patch, MagicMock
import contextlib
import pandas as pd

SAMPLE_STOCK = {
    "ticker": "TEST",
    "name": "Test Corp",
    "quantity": 10,
    "avg_cost": 100.0,
    "competitors": ["COMP1"],
    "moat": "Strong brand",
    "growth_plan": "Expand to Asia",
    "recent_disclosures": "Q1 실적 호조",
    "risks": "Competition risk",
    "key_resource": {"resource": "인력", "one_liner": "1인당 생산성 상승세"},
    "competitor_edge": {"axis": "점유율", "one_liner": "1위 유지", "entries": [{"ticker": "AAPL", "edge": "브랜드"}]},
    "market_outlook": {"market_name": "AI 반도체", "size_current": {"value": 100, "unit": "억달러", "year": 2026},
                        "cagr_pct": 20.0, "sources": [], "one_liner": "성장 지속"},
}

SAMPLE_NEWS = [
    {"title": "Test news", "link": "https://example.com",
     "publisher": "Reuters", "published_at": "2026-05-04 09:00"}
]

def _mock_all():
    df = pd.DataFrame({
        "Close": [100.0 + i for i in range(50)],
        "High":  [101.0 + i for i in range(50)],
        "Low":   [99.0  + i for i in range(50)],
        "Volume": [1_000_000] * 50,
    })
    return {
        "services.report_generator.mkt.get_quote": MagicMock(return_value={
            "ticker": "TEST", "name": "Test Corp", "price": 120.0,
            "prev_close": 118.0, "daily_change": "+1.69%",
            "market_cap": 500_000_000_000, "ytd_return": 15.0,
        }),
        "services.report_generator.mkt.get_financials": MagicMock(return_value=[
            {"period": "2025-Q4", "revenue": 10_000_000_000, "operating_income": 2_000_000_000},
        ]),
        "services.report_generator.mkt.get_annual_financials": MagicMock(return_value=[]),
        "services.report_generator.mkt.get_analyst_data": MagicMock(return_value={
            "target_mean": 150.0, "target_high": 200.0, "target_low": 120.0,
            "buy": 15, "hold": 5, "sell": 2,
        }),
        "services.report_generator.indicators.get_timeframe_rsi": MagicMock(return_value={
            "daily": {"rsi": 55.0, "target_20": 80.0, "target_25": 85.0, "target_30": 90.0,
                      "target_70": 130.0, "target_75": 135.0, "target_80": 140.0},
            "weekly": {"rsi": 60.0, "target_20": 75.0, "target_25": 80.0, "target_30": 85.0,
                       "target_70": 140.0, "target_75": 145.0, "target_80": 150.0},
            "monthly": {"rsi": 50.0, "target_20": 70.0, "target_25": 75.0, "target_30": 80.0,
                        "target_70": 145.0, "target_75": 150.0, "target_80": 155.0},
        }),
        "services.report_generator.indicators.get_volume_profile": MagicMock(return_value={
            "poc": 115.0, "hvn": [95.0, 115.0, 135.0], "lvn": [105.0, 125.0],
        }),
        "services.report_generator.scraper.scrape_finviz_consensus": MagicMock(return_value={
            "finviz_recom": 1.8,
        }),
        "services.report_generator.scraper.get_news": MagicMock(return_value=SAMPLE_NEWS),
        "services.report_generator.yf.Ticker": MagicMock(
            return_value=MagicMock(
                history=MagicMock(return_value=df),
                info={"sector": "Technology", "industry": "Software"},
            )
        ),
    }


def test_generate_report_creates_json_not_markdown(tmp_path):
    with contextlib.ExitStack() as stack:
        for target, mock in _mock_all().items():
            stack.enter_context(patch(target, mock))
        from services import report_generator
        import importlib; importlib.reload(report_generator)
        json_path = report_generator.generate_report(SAMPLE_STOCK, tmp_path)
    assert json_path.endswith(".json")
    assert not Path(json_path).with_suffix(".md").exists()


def test_generate_report_json_has_core_fields(tmp_path):
    with contextlib.ExitStack() as stack:
        for target, mock in _mock_all().items():
            stack.enter_context(patch(target, mock))
        from services import report_generator
        import importlib; importlib.reload(report_generator)
        json_path = report_generator.generate_report(SAMPLE_STOCK, tmp_path)
    summary = json.loads(Path(json_path).read_text(encoding="utf-8"))
    assert summary["ticker"] == "TEST"
    assert summary["target_mean"] == 150.0
    assert summary["buy"] == 15
    assert summary["daily_rsi"]["rsi"] == 55.0
    assert summary["volume_profile"]["poc"] == 115.0
    assert summary["sector"] == "Technology"


def test_generate_report_json_has_analyst_text_fields(tmp_path):
    with contextlib.ExitStack() as stack:
        for target, mock in _mock_all().items():
            stack.enter_context(patch(target, mock))
        from services import report_generator
        import importlib; importlib.reload(report_generator)
        json_path = report_generator.generate_report(SAMPLE_STOCK, tmp_path)
    summary = json.loads(Path(json_path).read_text(encoding="utf-8"))
    assert summary["moat"] == "Strong brand"
    assert summary["growth_plan"] == "Expand to Asia"
    assert summary["recent_disclosures"] == "Q1 실적 호조"
    assert summary["risks"] == "Competition risk"
    assert summary["key_resource"] == {"resource": "인력", "one_liner": "1인당 생산성 상승세"}
    assert summary["competitor_edge"] == SAMPLE_STOCK["competitor_edge"]
    assert summary["market_outlook"] == SAMPLE_STOCK["market_outlook"]


def test_generate_report_json_has_competitors_data(tmp_path):
    with contextlib.ExitStack() as stack:
        for target, mock in _mock_all().items():
            stack.enter_context(patch(target, mock))
        from services import report_generator
        import importlib; importlib.reload(report_generator)
        json_path = report_generator.generate_report(SAMPLE_STOCK, tmp_path)
    summary = json.loads(Path(json_path).read_text(encoding="utf-8"))
    assert "competitors_data" in summary
    assert isinstance(summary["competitors_data"], list)
    assert len(summary["competitors_data"]) >= 1


def test_generate_report_json_has_news(tmp_path):
    with contextlib.ExitStack() as stack:
        for target, mock in _mock_all().items():
            stack.enter_context(patch(target, mock))
        from services import report_generator
        import importlib; importlib.reload(report_generator)
        json_path = report_generator.generate_report(SAMPLE_STOCK, tmp_path)
    summary = json.loads(Path(json_path).read_text(encoding="utf-8"))
    assert "news" in summary
    assert summary["news"][0]["title"] == "Test news"
    assert summary["news"][0]["publisher"] == "Reuters"


def test_generate_report_calls_all_io_functions(tmp_path):
    mocks = _mock_all()
    with contextlib.ExitStack() as stack:
        patched = {target: stack.enter_context(patch(target, mock)) for target, mock in mocks.items()}
        from services import report_generator
        import importlib; importlib.reload(report_generator)
        report_generator.generate_report(SAMPLE_STOCK, tmp_path)

    patched["services.report_generator.mkt.get_quote"].assert_called()
    patched["services.report_generator.mkt.get_financials"].assert_called_once()
    patched["services.report_generator.mkt.get_annual_financials"].assert_called_once()
    patched["services.report_generator.mkt.get_analyst_data"].assert_called_once()
    patched["services.report_generator.indicators.get_timeframe_rsi"].assert_called_once()
    patched["services.report_generator.scraper.get_news"].assert_called_once()


# ── 종목명 ticker 박제 방어 (stock-name-ticker-revert-fix) ─────────────────────

def _mock_kr(quote_name: str):
    df = pd.DataFrame({
        "Close": [70000.0 + i for i in range(50)],
        "High":  [70100.0 + i for i in range(50)],
        "Low":   [69900.0 + i for i in range(50)],
        "Volume": [1_000_000] * 50,
    })
    return {
        "services.report_generator.mkt.get_quote": MagicMock(return_value={
            "ticker": "005930", "name": quote_name, "price": 70000.0,
            "market_cap": 400_000_000_000_000, "sector": "", "industry": "",
        }),
        "services.report_generator.mkt.get_history_df": MagicMock(return_value=df),
        "services.report_generator.mkt.get_financials": MagicMock(return_value=[]),
        "services.report_generator.mkt.get_annual_financials": MagicMock(return_value=[]),
        "services.report_generator.mkt.get_analyst_data": MagicMock(return_value={
            "target_mean": None, "target_high": None, "target_low": None,
            "buy": 0, "hold": 0, "sell": 0,
        }),
        "services.report_generator.indicators.get_timeframe_rsi": MagicMock(return_value={
            "daily": {}, "weekly": {}, "monthly": {},
        }),
        "services.report_generator.indicators.get_volume_profile": MagicMock(return_value={}),
        "services.report_generator.scraper.get_news": MagicMock(return_value=[]),
        # 박제-시 독립피드 게이트(task#101)가 KR에서 _kr_basic_naver를 호출하므로, quote(70k)와
        # 일관된 독립 참조를 mock해 게이트를 통과시킨다(이 테스트는 이름 해석 검증, 글리치 무관).
        "services.market.kr._kr_basic_naver": MagicMock(return_value=(70000.0, 0.0, 70000.0, 0, "삼성전자")),
        # KR 메인 EV/EBITDA(task#169/ADR-0024)가 yf.Ticker(yf_sym)를 신규 호출하므로 mock
        # 없으면 라이브 네트워크를 탄다 — info에 enterpriseToEbitda를 실어 값 확인도 겸함.
        "services.report_generator.yf.Ticker": MagicMock(return_value=MagicMock(
            info={"enterpriseToEbitda": 12.3})),
        # KR R&D집약도(task#204 S2)가 get_rd_intensity_kr(DART requests.get)를 신규 호출하므로
        # mock 없으면 라이브 네트워크를 탄다(DART_API_KEY 미설정 시에만 우연히 no-op이던 것).
        "services.market.kr.get_rd_intensity_kr": MagicMock(return_value=None),
    }


def test_generate_report_resolves_ticker_like_name_from_quote(tmp_path):
    """stock.name이 종목번호(ticker)면 quote의 실명으로 스냅샷 name을 채운다(배치 재박제 방어)."""
    stock = {"ticker": "005930", "name": "005930", "market": "KR", "exchange": "KS", "competitors": []}
    with contextlib.ExitStack() as stack:
        for target, mock in _mock_kr("삼성전자").items():
            stack.enter_context(patch(target, mock))
        from services import report_generator
        import importlib; importlib.reload(report_generator)
        json_path = report_generator.generate_report(stock, tmp_path)
    summary = json.loads(Path(json_path).read_text(encoding="utf-8"))
    assert summary["name"] == "삼성전자"


# ── S1/S2/S3 field presence in snapshot ──────────────────────────────────────

def test_generate_report_has_price_technical_fields(tmp_path):
    """Snapshot must contain S1/S2/S3 fields (may be None on short mock df, must be present)."""
    with contextlib.ExitStack() as stack:
        for target, mock in _mock_all().items():
            stack.enter_context(patch(target, mock))
        from services import report_generator
        import importlib; importlib.reload(report_generator)
        json_path = report_generator.generate_report(SAMPLE_STOCK, tmp_path)
    summary = json.loads(Path(json_path).read_text(encoding="utf-8"))
    # S1
    for key in ("week52_high", "week52_low", "ema20", "ema50", "ema200"):
        assert key in summary, f"Missing S1 field: {key}"
    # S2
    assert "trend" in summary
    assert isinstance(summary["trend"], dict)
    for key in ("above_ema20", "above_ema50", "above_ema200", "return_30d", "golden_cross", "dead_cross"):
        assert key in summary["trend"], f"Missing trend sub-key: {key}"
    # S3
    assert "beta" in summary
    assert "hv" in summary


# ── 적대적 감사 버그 수정 (task#161) ──────────────────────────────────────

def test_generate_report_us_rejects_nan_price(tmp_path):
    """[#1] US: quote price 없음 + 마지막 일봉 Close NaN → NaN이 `is None` 가드를 통과해
    price:null 스냅샷을 박제하던 것 방지(math.isfinite로 reject → ValueError)."""
    mocks = _mock_all()
    mocks["services.report_generator.mkt.get_quote"] = MagicMock(return_value={
        "ticker": "TEST", "name": "Test Corp", "price": None,
        "prev_close": None, "market_cap": 1, "ytd_return": None,
    })
    nan_df = pd.DataFrame({
        "Close": [100.0, float("nan")], "High": [101.0, 101.0],
        "Low": [99.0, 99.0], "Volume": [1_000_000, 1_000_000],
    })
    mocks["services.report_generator.yf.Ticker"] = MagicMock(return_value=MagicMock(
        history=MagicMock(return_value=nan_df), info={"sector": "Tech", "industry": "SW"}))
    with contextlib.ExitStack() as stack:
        for target, mock in mocks.items():
            stack.enter_context(patch(target, mock))
        from services import report_generator
        import importlib; importlib.reload(report_generator)
        with pytest.raises(ValueError):
            report_generator.generate_report(SAMPLE_STOCK, tmp_path)


def _kr_stock():
    return {"ticker": "005930", "name": "삼성전자", "market": "KR", "exchange": "KS", "competitors": []}


def test_generate_report_kr_per_psr_none_under_4_quarters(tmp_path):
    """[#3] 실적 <4분기 KR은 sub-TTM 합산으로 PER/PSR 부풀리지 말고 None(missing<wrong)."""
    mocks = _mock_kr("삼성전자")
    mocks["services.report_generator.mkt.get_financials"] = MagicMock(return_value=[
        {"period": "2025-Q3", "eps": 1000.0, "revenue": 1_000_000_000_000, "bps": 50000.0},
        {"period": "2025-Q4", "eps": 1100.0, "revenue": 1_100_000_000_000, "bps": 51000.0},
    ])
    with contextlib.ExitStack() as stack:
        for target, mock in mocks.items():
            stack.enter_context(patch(target, mock))
        from services import report_generator
        import importlib; importlib.reload(report_generator)
        json_path = report_generator.generate_report(_kr_stock(), tmp_path)
    summary = json.loads(Path(json_path).read_text(encoding="utf-8"))
    assert summary.get("per") is None, "2분기 EPS를 TTM으로 취급하면 안 됨"
    assert summary.get("psr") is None, "2분기 매출을 TTM으로 취급하면 안 됨"


def test_generate_report_kr_per_psr_computed_with_4_quarters(tmp_path):
    """[#3] 4분기 온전하면 PER/PSR 정상 계산."""
    mocks = _mock_kr("삼성전자")
    mocks["services.report_generator.mkt.get_financials"] = MagicMock(return_value=[
        {"period": f"2025-Q{q}", "eps": 1000.0, "revenue": 1_000_000_000_000, "bps": 50000.0}
        for q in range(1, 5)
    ])
    with contextlib.ExitStack() as stack:
        for target, mock in mocks.items():
            stack.enter_context(patch(target, mock))
        from services import report_generator
        import importlib; importlib.reload(report_generator)
        json_path = report_generator.generate_report(_kr_stock(), tmp_path)
    summary = json.loads(Path(json_path).read_text(encoding="utf-8"))
    assert summary.get("per") is not None
    assert summary.get("psr") is not None


def test_backfill_ticker_excludes_today(tmp_path):
    """[#4] backfill은 과거만 박제 — 오늘자는 독립피드 게이트 있는 daily 배치가 처리(force 덮어쓰기 방지)."""
    from datetime import datetime, timedelta as _td
    from services import report_generator
    import importlib; importlib.reload(report_generator)
    today = datetime.now(report_generator._KST).date()
    idx = pd.to_datetime([str(today - _td(days=d)) for d in (6, 5, 4, 1, 0)])  # 오늘(0) 포함
    df = pd.DataFrame({"Close": [100.0]*5, "High": [101.0]*5, "Low": [99.0]*5, "Volume": [1]*5}, index=idx)
    stock = {"ticker": "TEST", "name": "Test", "market": "US", "exchange": "", "competitors": []}
    with contextlib.ExitStack() as stack:
        stack.enter_context(patch("services.report_generator.query", side_effect=Exception("no db")))
        stack.enter_context(patch("services.report_generator.execute", MagicMock()))
        stack.enter_context(patch("services.report_generator.yf.Ticker", MagicMock(return_value=MagicMock(
            history=MagicMock(return_value=df), info={"sector": "T", "industry": "S"}))))
        stack.enter_context(patch("services.report_generator.mkt.get_analyst_data", MagicMock(return_value={})))
        stack.enter_context(patch("services.report_generator.mkt.get_financials", MagicMock(return_value=[])))
        stack.enter_context(patch("services.report_generator.mkt.get_annual_financials", MagicMock(return_value=[])))
        stack.enter_context(patch("services.report_generator.scraper.scrape_finviz_consensus", MagicMock(return_value={})))
        stack.enter_context(patch("services.report_generator.indicators.get_timeframe_rsi", MagicMock(return_value={"daily": {}, "weekly": {}, "monthly": {}})))
        stack.enter_context(patch("services.report_generator.indicators.get_volume_profile", MagicMock(return_value={})))
        report_generator.backfill_ticker(stock, days=60, output_base_dir=tmp_path, force=True)
    written = {p.stem for p in tmp_path.glob("**/*.json")}
    assert str(today) not in written, f"backfill이 오늘자를 생성하면 안 됨: {written}"
    assert str(today - _td(days=1)) in written, f"과거(어제)는 생성돼야 함: {written}"


# ── report_generator 2건 (S2) ────────────────────────────────────────────────

def test_backfill_ticker_kr_weekly_monthly_use_regular_true(tmp_path):
    """[2a] KR backfill의 weekly/monthly fetch도 daily(KRX)와 스케일 일치하도록 regular=True로
    호출해야 함 — generate_report의 get_timeframe_rsi(regular=True)와 동일 패턴(task#161 #2 backfill 누락분)."""
    from datetime import datetime, timedelta as _td
    from services import report_generator
    import importlib; importlib.reload(report_generator)
    today = datetime.now(report_generator._KST).date()
    idx = pd.to_datetime([str(today - _td(days=d)) for d in (6, 5, 4, 1)])
    df = pd.DataFrame({"Close": [70000.0] * 4, "High": [70100.0] * 4,
                        "Low": [69900.0] * 4, "Volume": [1] * 4}, index=idx)
    hist_mock = MagicMock(return_value=df)
    stock = {"ticker": "005930", "name": "삼성전자", "market": "KR", "exchange": "KS", "competitors": []}
    with contextlib.ExitStack() as stack:
        stack.enter_context(patch("services.report_generator.query", side_effect=Exception("no db")))
        stack.enter_context(patch("services.report_generator.execute", MagicMock()))
        stack.enter_context(patch("services.report_generator.yf.Ticker", MagicMock()))
        stack.enter_context(patch("services.report_generator.mkt.get_history_df", hist_mock))
        stack.enter_context(patch("services.report_generator.mkt.get_quote", MagicMock(return_value={
            "ticker": "005930", "name": "삼성전자", "price": 70000.0, "sector": "", "industry": "",
        })))
        stack.enter_context(patch("services.report_generator.mkt.get_analyst_data", MagicMock(return_value={})))
        stack.enter_context(patch("services.report_generator.mkt.get_financials", MagicMock(return_value=[])))
        stack.enter_context(patch("services.report_generator.mkt.get_annual_financials", MagicMock(return_value=[])))
        stack.enter_context(patch("services.report_generator.indicators.get_volume_profile", MagicMock(return_value={})))
        report_generator.backfill_ticker(stock, days=60, output_base_dir=tmp_path, force=True)

    calls_by_tf = {c.args[3]: c.kwargs for c in hist_mock.call_args_list}
    assert calls_by_tf["weekly"].get("regular") is True, "weekly fetch가 regular=True로 호출되지 않음"
    assert calls_by_tf["monthly"].get("regular") is True, "monthly fetch가 regular=True로 호출되지 않음"


def test_generate_report_us_dedupes_yfinance_history_call(tmp_path):
    """[2b] US: daily_df 확보용 history()와 get_quote 내부 history()가 중복 호출되지 않음 —
    get_quote에 hist=daily_df를 넘겨 재사용, 동일 yfinance Ticker의 history() call_count == 1."""
    mocks = _mock_all()
    del mocks["services.report_generator.mkt.get_quote"]  # 실제 get_quote/_get_quote_uncached 실행
    stock = {**SAMPLE_STOCK, "competitors": []}  # 경쟁사 quote fetch가 섞여 call_count를 오염시키지 않도록
    with contextlib.ExitStack() as stack:
        for target, mock in mocks.items():
            stack.enter_context(patch(target, mock))
        # TTL 캐시가 다른 테스트의 값을 재사용하지 않도록 loader를 즉시 실행하게 우회.
        stack.enter_context(patch("services.cache.get_quote_cached", side_effect=lambda key, loader: loader()))
        from services import report_generator
        import importlib; importlib.reload(report_generator)
        report_generator.generate_report(stock, tmp_path)

    ticker_mock = mocks["services.report_generator.yf.Ticker"].return_value
    assert ticker_mock.history.call_count == 1, "get_quote가 daily_df를 재사용하지 않고 history()를 재fetch함"


# ── task#169 상대 밸류에이션(PSR/EV-EBITDA) 조립부 (ADR-0024) ─────────────────

def test_generate_report_us_psr_ev_ebitda_propagate_to_self_and_competitor(tmp_path):
    """US: yfinance info의 psr/ev_ebitda가 summary(self)·경쟁사 행 모두에 실림."""
    mocks = _mock_all()
    mocks["services.report_generator.yf.Ticker"] = MagicMock(return_value=MagicMock(
        history=MagicMock(return_value=pd.DataFrame({
            "Close": [100.0 + i for i in range(50)],
            "High":  [101.0 + i for i in range(50)],
            "Low":   [99.0 + i for i in range(50)],
            "Volume": [1_000_000] * 50,
        })),
        info={
            "sector": "Technology", "industry": "Software",
            "priceToSalesTrailing12Months": 8.5, "enterpriseToEbitda": 22.1,
        },
    ))
    with contextlib.ExitStack() as stack:
        for target, mock in mocks.items():
            stack.enter_context(patch(target, mock))
        from services import report_generator
        import importlib; importlib.reload(report_generator)
        json_path = report_generator.generate_report(SAMPLE_STOCK, tmp_path)
    summary = json.loads(Path(json_path).read_text(encoding="utf-8"))
    assert summary["psr"] == 8.5
    assert summary["ev_ebitda"] == 22.1
    self_row = next(c for c in summary["competitors_data"] if c["is_self"])
    comp_row = next(c for c in summary["competitors_data"] if not c["is_self"])
    assert self_row["psr"] == 8.5
    assert self_row["ev_ebitda"] == 22.1
    assert comp_row["psr"] == 8.5
    assert comp_row["ev_ebitda"] == 22.1


def _naver_quarter_response_4q(revenue_each, per=8.0, pbr=1.1):
    """4개 non-consensus 분기(키 "4">"3">"2">"1")의 finance/quarter 응답 fixture."""
    keys = ["4", "3", "2", "1"]
    rows = [{"columns": {}} for _ in range(15)]
    rows[0]["columns"] = {k: {"value": str(revenue_each)} for k in keys}
    rows[12]["columns"] = {keys[0]: {"value": str(per)}}
    rows[14]["columns"] = {keys[0]: {"value": str(pbr)}}
    metas = [{"key": k, "isConsensus": "N"} for k in keys]
    return {"financeInfo": {"trTitleList": metas, "rowList": rows}}


def test_generate_report_kr_competitor_psr_via_kr_psr_fallback(tmp_path):
    """KR: 경쟁사 psr은 _comp_valuation이 psr을 직접 못 주므로(시총 미보유) 조립부가
    시총(경쟁사 quote)÷_ttm_revenue(_comp_valuation의 Naver TTM매출)로 _kr_psr 계산."""
    df = pd.DataFrame({
        "Close": [70000.0 + i for i in range(50)],
        "High":  [70100.0 + i for i in range(50)],
        "Low":   [69900.0 + i for i in range(50)],
        "Volume": [1_000_000] * 50,
    })

    def _quote_side_effect(ticker, *args, **kwargs):
        if ticker == "005930":
            return {"ticker": "005930", "name": "삼성전자", "price": 70000.0,
                     "market_cap": 400_000_000_000_000, "sector": "", "industry": ""}
        return {"ticker": "000660", "name": "SK하이닉스", "price": 150000.0,
                 "market_cap": 100_000_000_000_000}

    def _yf_ticker_side_effect(sym):
        if sym == "005930.KS":
            return MagicMock(info={"enterpriseToEbitda": 12.3})
        if sym == "000660.KS":
            return MagicMock(info={"enterpriseToEbitda": 5.5})
        return MagicMock(info={})

    # 4분기×50,000억원 = TTM 200,000억원 = 2e13원(20조원) → psr = 100조÷20조 = 5.0
    naver_resp = _naver_quarter_response_4q(50_000)

    mocks = {
        "services.report_generator.mkt.get_quote": MagicMock(side_effect=_quote_side_effect),
        "services.report_generator.mkt.get_history_df": MagicMock(return_value=df),
        "services.report_generator.mkt.get_financials": MagicMock(return_value=[]),
        "services.report_generator.mkt.get_annual_financials": MagicMock(return_value=[]),
        "services.report_generator.mkt.get_analyst_data": MagicMock(return_value={
            "target_mean": None, "target_high": None, "target_low": None,
            "buy": 0, "hold": 0, "sell": 0,
        }),
        "services.report_generator.indicators.get_timeframe_rsi": MagicMock(return_value={
            "daily": {}, "weekly": {}, "monthly": {},
        }),
        "services.report_generator.indicators.get_volume_profile": MagicMock(return_value={}),
        "services.report_generator.scraper.get_news": MagicMock(return_value=[]),
        "services.market.kr._naver_get": MagicMock(return_value=naver_resp),
        "services.market.kr._kr_basic_naver": MagicMock(return_value=(70000.0, 0.0, 70000.0, 0, "삼성전자")),
        "services.report_generator.yf.Ticker": MagicMock(side_effect=_yf_ticker_side_effect),
    }
    stock = {"ticker": "005930", "name": "삼성전자", "market": "KR", "exchange": "KS", "competitors": ["000660"]}
    with contextlib.ExitStack() as stack:
        for target, mock in mocks.items():
            stack.enter_context(patch(target, mock))
        from services import report_generator
        import importlib; importlib.reload(report_generator)
        json_path = report_generator.generate_report(stock, tmp_path)
    summary = json.loads(Path(json_path).read_text(encoding="utf-8"))
    comp_row = next(c for c in summary["competitors_data"] if not c["is_self"])
    assert comp_row["psr"] == round(100_000_000_000_000 / 20_000_000_000_000, 2)
    assert comp_row["ev_ebitda"] == 5.5
    self_row = next(c for c in summary["competitors_data"] if c["is_self"])
    assert self_row["ev_ebitda"] == 12.3

from pathlib import Path
from datetime import date, timedelta, datetime
from zoneinfo import ZoneInfo as _ZoneInfo

_KST = _ZoneInfo("Asia/Seoul")


def _today_kst():
    """KST 오늘 — 컨테이너가 UTC라 bare date.today()는 00~09시 KST에 하루 어긋남(task#161 #5)."""
    return datetime.now(tz=_KST).date()


from concurrent.futures import ThreadPoolExecutor
import json
import math
import pandas as pd
import yfinance as yf

from services import market as mkt, indicators, scraper
from services.utils import sanitize as _sanitize
from services.db import execute, query
import logging

logger = logging.getLogger(__name__)

SNAPSHOTS_DIR = Path(__file__).parent.parent / "snapshots"


def _fin_num(v):
    """yfinance info 값을 유한 float으로 변환. 'Infinity'/NaN/None → None."""
    import math
    try:
        f = float(v)
        return f if math.isfinite(f) else None
    except (TypeError, ValueError):
        return None


def _kr_psr(market_cap, ttm_revenue):
    """KR PSR = 시총(원)÷TTM매출(원). ttm_revenue는 4분기 온전할 때만 넘길 것
    (sub-TTM 부풀림 방지, task#161 #3). 가드 실패 시 None."""
    try:
        if market_cap and ttm_revenue and ttm_revenue > 0 and math.isfinite(market_cap / ttm_revenue):
            return round(market_cap / ttm_revenue, 2)
    except (TypeError, ZeroDivisionError):
        pass
    return None


def _comp_valuation(ticker: str, market: str) -> dict:
    """경쟁사 PER/PBR/PSR/EV_EBITDA(ADR-0024). US=yfinance info(추가콜 0). KR: PER/PBR=Naver
    finance/quarter 최신 실적행, PSR은 시총 미보유라 `_ttm_revenue`(원, 4분기 온전 시만)만 반환하고
    조립부가 _kr_psr로 계산, EV/EBITDA=yfinance `.KS`→`.KQ` 폴백(독립 실패, per/pbr를 물귀신 삼지 않음).
    결측/예외→None."""
    def _fin(v):
        try:
            f = float(v)
            return f if math.isfinite(f) else None
        except (TypeError, ValueError):
            return None

    def _kr_ev_ebitda():
        for suffix in (".KS", ".KQ"):
            try:
                v = _fin((yf.Ticker(f"{ticker}{suffix}").info or {}).get("enterpriseToEbitda"))
            except Exception as e:
                logger.warning(f"[Valuation] {ticker}{suffix} EV/EBITDA 조회 실패: {e}")
                v = None
            if v is not None:
                return v
        return None

    try:
        if market == "KR":
            from services.market.kr import _naver_get, _naver_row_val
            d = _naver_get(ticker, "finance/quarter")
            fi = d.get("financeInfo", {})
            metas = sorted(fi.get("trTitleList", []), key=lambda t: t["key"], reverse=True)
            rows = fi.get("rowList", [])
            non_consensus_keys = [m["key"] for m in metas if m.get("isConsensus") != "Y"]
            key = non_consensus_keys[0] if non_consensus_keys else None
            if not key:
                return {"per": None, "pbr": None, "_ttm_revenue": None, "ev_ebitda": _kr_ev_ebitda()}
            rev_q = [_fin(_naver_row_val(rows, 0, k)) for k in non_consensus_keys[:4]]
            ttm_revenue = (
                sum(rev_q) * 1e8
                if len(rev_q) >= 4 and all(v is not None for v in rev_q)
                else None
            )
            return {
                "per": _fin(_naver_row_val(rows, 12, key)),
                "pbr": _fin(_naver_row_val(rows, 14, key)),
                "_ttm_revenue": ttm_revenue,
                "ev_ebitda": _kr_ev_ebitda(),
            }
        else:
            info = yf.Ticker(ticker).info or {}
            return {
                "per": _fin(info.get("trailingPE")),
                "pbr": _fin(info.get("priceToBook")),
                "psr": _fin(info.get("priceToSalesTrailing12Months")),
                "ev_ebitda": _fin(info.get("enterpriseToEbitda")),
            }
    except Exception as e:
        logger.warning(f"[Valuation] {ticker} 경쟁사 밸류에이션 조회 실패: {e}")
        if market == "KR":
            return {"per": None, "pbr": None, "_ttm_revenue": None, "ev_ebitda": None}
        return {"per": None, "pbr": None, "psr": None, "ev_ebitda": None}


def _infer_comp_market(ticker: str, parent_market: str, parent_exchange: str):
    """티커 형식으로 마켓을 추론. 6자리 숫자 → KR, 그 외 → US."""
    clean = ticker.upper().split('.')[0]
    if clean.isdigit() and len(clean) == 6:
        exchange = parent_exchange if parent_market == "KR" else "KS"
        return "KR", exchange
    return "US", ""


def generate_report_with_retry(stock: dict, target_date: str = None, retries: int = 1) -> str:
    """generate_report를 1회(기본) 재시도. 외부 fetch 일시 실패(quote None 등)로
    종목이 그날 배치에서 통째 누락되는 것을 줄인다. 마지막 시도도 실패하면 예외 전파."""
    last_exc = None
    for _ in range(retries + 1):
        try:
            return generate_report(stock, target_date=target_date)
        except Exception as e:
            last_exc = e
    raise last_exc


def generate_report(stock: dict, output_base_dir: Path = SNAPSHOTS_DIR, target_date: str = None) -> str:
    ticker = stock["ticker"]
    market = stock.get("market", "US")
    exchange = stock.get("exchange", "")
    yf_sym = mkt._yf_sym(ticker, market, exchange)
    today = target_date or datetime.now(tz=_KST).date().strftime("%Y-%m-%d")
    output_dir = output_base_dir / ticker
    output_dir.mkdir(parents=True, exist_ok=True)

    competitors = stock.get("competitors", [])

    # _t.history / _t.info는 thread-safe하지 않으므로 executor 외부에서 직렬 호출
    _t = yf.Ticker(yf_sym) if market != "KR" else None
    if _t is not None:
        try:
            _ = _t.info  # info 사전 캐싱
        except Exception as e:
            logger.warning(f"[Report] {ticker} yfinance info 사전 캐싱 실패: {e}")
            pass
    # KR 일봉은 키움 우선(실패 시 yfinance 폴백), 그 외는 yfinance.
    # 리포트 스냅샷은 KRX 정규장 종가 기준(regular=True) — 매물대/고점/현재가 정합(.forge/adr/0020).
    if market == "KR":
        daily_df = mkt.get_history_df(ticker, market, exchange, "daily", regular=True)
    else:
        daily_df = _t.history(period="1y")

    with ThreadPoolExecutor(max_workers=8) as ex:
        # hist=daily_df: US는 이미 확보한 1y history 재사용해 yfinance 중복 fetch 방지(task#161 B-2b).
        f_quote     = ex.submit(mkt.get_quote, ticker, market, exchange, _t, regular=True, hist=daily_df)
        f_fin       = ex.submit(mkt.get_financials, ticker, market, exchange)
        f_fin_ann   = ex.submit(mkt.get_annual_financials, ticker, market, exchange)
        f_analyst   = ex.submit(mkt.get_analyst_data, ticker, market, exchange, _t)
        # KR은 regular=True로 — RSI 타점(target_20~80)은 절대가라 차트(regular=True)와 스케일이 일치해야
        # 한다(NXT `_AL` 글리치 시 타점만 어긋나던 것 방지, task#161 #2). daily는 KRX daily_df 재사용.
        f_rsi       = ex.submit(indicators.get_timeframe_rsi, ticker, market, exchange,
                                daily_df, regular=(market == "KR"))
        f_finviz    = ex.submit(scraper.scrape_finviz_consensus, ticker) if market == "US" else None
        f_news      = ex.submit(scraper.get_news, ticker, market)
        f_comps     = [ex.submit(mkt.get_quote, c, *_infer_comp_market(c, market, exchange), regular=True) for c in competitors]
        f_comp_vals = [ex.submit(_comp_valuation, c, _infer_comp_market(c, market, exchange)[0]) for c in competitors]

    quote             = f_quote.result()
    financials        = f_fin.result()
    financials_annual = f_fin_ann.result()
    analyst           = f_analyst.result()
    timeframe_rsi     = f_rsi.result()
    finviz            = f_finviz.result() if f_finviz is not None else {}
    news              = f_news.result()
    competitor_quotes = [f.result() for f in f_comps]
    competitor_vals   = [f.result() for f in f_comp_vals]

    vp = indicators.get_volume_profile(daily_df)

    high_20d = round(float(daily_df["High"].tail(20).max()), 2) if not daily_df.empty else None
    _cur = quote.get("price")
    drop_from_high_20d = round((_cur - high_20d) / high_20d * 100, 2) if high_20d and _cur else None

    # S1: 52w high/low + EMA levels
    sr = indicators.get_support_resistance(daily_df)

    # S2: trend summary (price vs EMA, 30d return, golden/dead cross)
    trend = indicators.calc_trend_summary(daily_df)

    # S3: beta + HV
    import math
    _daily_returns = daily_df["Close"].pct_change().dropna() if not daily_df.empty else None
    hv = indicators.calc_hv(_daily_returns) if _daily_returns is not None and len(_daily_returns) >= 10 else None
    beta = None
    if market == "KR":
        try:
            ks11_df = mkt.get_history_df("^KS11", "US", "")
            if not ks11_df.empty:
                ks11_ret = ks11_df["Close"].pct_change().dropna()
                # Strip tz from ks11_ret: yfinance returns tz-aware (Asia/Seoul),
                # kiwoom daily_df is tz-naive — concat raises TypeError without this.
                if ks11_ret.index.tz is not None:
                    ks11_ret = ks11_ret.copy()
                    ks11_ret.index = ks11_ret.index.tz_localize(None)
                # daily_df도 벗김: 키움 실패→yfinance 폴백 시 _daily_returns가 tz-aware라
                # naive ks11_ret과 concat 시 TypeError→조용히 None (beta.py와 통일)
                _dr = _daily_returns
                if _dr is not None and _dr.index.tz is not None:
                    _dr = _dr.copy()
                    _dr.index = _dr.index.tz_localize(None)
                beta = indicators.calc_beta(_dr, ks11_ret)
        except Exception as e:
            logger.warning(f"[Report] {ticker} KR 베타 계산 실패: {e}")
            pass
    else:
        try:
            _b = _fin_num((_t.info if _t is not None else {}).get("beta"))
            beta = _b
        except Exception as e:
            logger.warning(f"[Report] {ticker} US 베타 조회 실패: {e}")
            pass

    if market == "KR":
        sector = quote.get("sector", "")
        industry = quote.get("industry", "")
        current_price = quote.get("price")
        actual_f = [f for f in financials if not f.get("is_consensus")]
        eps_list = [f["eps"] for f in actual_f if f.get("eps") is not None]
        trailing_eps = sum(eps_list[:4]) if len(eps_list) >= 4 else None  # TTM은 4분기 온전할 때만(sub-TTM PER 부풀림 방지, task#161 #3)
        trailing_per = round(current_price / trailing_eps, 1) if current_price and trailing_eps else None
        consensus_f = next((f for f in financials if f.get("is_consensus") and f.get("eps")), None)
        forward_per = round(current_price / (consensus_f["eps"] * 4), 1) if current_price and consensus_f else None
        actual_bps = next((f["bps"] for f in actual_f if f.get("bps") is not None), None)
        pbr = round(current_price / actual_bps, 2) if current_price and actual_bps else None
        # PSR: 시총÷TTM매출(Naver finance/quarter rv0 최근 4 non-consensus 분기 합×1e8)
        psr = ev_ebitda = None
        try:
            mc = quote.get("market_cap")  # 원 단위
            rev_q = [f["revenue"] for f in actual_f[:4] if f.get("revenue") is not None]
            # TTM PSR은 4분기 매출이 온전할 때만 — 1~2분기를 TTM 취급 시 PSR 2~4× 부풀림(task#161 #3)
            ttm_rev = sum(rev_q) if len(rev_q) >= 4 else None  # revenue는 이미 원 단위(×1e8 변환됨, get_financials_kr)
            psr = _kr_psr(mc, ttm_rev)
        except Exception as e:
            logger.warning(f"[Report] {ticker} KR PSR 계산 실패: {e}")
            pass
        # EV/EBITDA: yfinance info(ADR-0024, DART 파싱 회피). KR 메인은 _t가 None이라
        # 신규 Ticker 호출 1회(일배치 직렬이라 승인된 비용).
        try:
            ev_ebitda = _fin_num(yf.Ticker(yf_sym).info.get("enterpriseToEbitda"))
        except Exception as e:
            logger.warning(f"[Report] {ticker} KR EV/EBITDA 조회 실패: {e}")
            ev_ebitda = None
    else:
        try:
            _info = (_t.info if _t is not None else {}) or {}
            sector = _info.get("sector", "")
            industry = _info.get("industry", "")
            trailing_per = _fin_num(_info.get("trailingPE"))
            forward_per = _fin_num(_info.get("forwardPE"))
            pbr = _fin_num(_info.get("priceToBook"))
            # eco: priceToSalesTrailing12Months is the actual key (라이브 AAPL 확인 2026-06-28)
            psr = _fin_num(_info.get("priceToSalesTrailing12Months"))
            ev_ebitda = _fin_num(_info.get("enterpriseToEbitda"))
        except Exception as e:
            logger.warning(f"[Report] {ticker} US 섹터·밸류에이션 조회 실패: {e}")
            sector, industry = "", ""
            trailing_per = forward_per = pbr = psr = ev_ebitda = None

    # price = quote 우선, 없으면 일봉 마지막 종가 — 단 비유한(NaN/inf, 미완성 바 등)이면 None.
    # NaN을 그대로 두면 아래 `if summary["price"] is None` 가드를 통과(NaN≠None)해 US에서 price:null
    # 스냅샷이 박제된다(KR은 박제게이트가 잡지만 US는 이 가드가 유일, task#161 #1).
    _report_price = quote.get("price")
    if _report_price is None or not math.isfinite(_report_price):
        _report_price = round(float(daily_df["Close"].iloc[-1]), 2) if not daily_df.empty else None
        if _report_price is not None and not math.isfinite(_report_price):
            _report_price = None

    summary = {
        "ticker": ticker,
        "name": mkt.resolve_name(ticker, market, exchange, stock.get("name", ""), quote=quote),
        "date": today,
        "market": market,
        "price": _report_price,
        "target_mean": analyst.get("target_mean") or finviz.get("finviz_target"),
        "target_high": analyst.get("target_high"),
        "target_low": analyst.get("target_low"),
        "buy": analyst.get("buy", 0),
        "hold": analyst.get("hold", 0),
        "sell": analyst.get("sell", 0),
        "finviz_recom": finviz.get("finviz_recom"),
        "daily_rsi": timeframe_rsi.get("daily", {}),
        "weekly_rsi": timeframe_rsi.get("weekly", {}),
        "monthly_rsi": timeframe_rsi.get("monthly", {}),
        "volume_profile": vp,
        "financials": financials,
        "financials_annual": financials_annual,
        "sector": sector,
        "industry": industry,
        "per": round(trailing_per, 2) if trailing_per else None,
        "forward_per": round(forward_per, 2) if forward_per else None,
        "pbr": round(pbr, 2) if pbr else None,
        "psr": psr,
        "ev_ebitda": ev_ebitda,
        "high_20d": high_20d,
        "drop_from_high_20d": drop_from_high_20d,
        "week52_high": sr.get("week52_high"),
        "week52_low": sr.get("week52_low"),
        "ema20": sr.get("ema20"),
        "ema50": sr.get("ema50"),
        "ema200": sr.get("ema200"),
        "trend": trend,
        "beta": beta,
        "hv": hv,
        "moat": stock.get("moat", ""),
        "growth_plan": stock.get("growth_plan", ""),
        "recent_disclosures": stock.get("recent_disclosures", ""),
        "risks": stock.get("risks", ""),
        "insights": stock.get("insights", ""),
        "key_resource": stock.get("key_resource", ""),
        "competitors_data": sorted(
            [
                {
                    "ticker": q.get("ticker") or c,
                    "name": q.get("name", "") or (stock.get("name", ticker) if c == ticker else ""),
                    "price": (
                        q.get("price") or (round(float(daily_df["Close"].iloc[-1]), 2) if c == ticker and not daily_df.empty else None)
                    ),
                    "market_cap": q.get("market_cap"),
                    "ytd_return": q.get("ytd_return"),
                    "is_self": c == ticker,
                    "per": (round(trailing_per, 2) if trailing_per else None) if c == ticker else v.get("per"),
                    "pbr": (round(pbr, 2) if pbr else None) if c == ticker else v.get("pbr"),
                    "psr": psr if c == ticker else (
                        v.get("psr") if v.get("psr") is not None
                        else _kr_psr(q.get("market_cap"), v.get("_ttm_revenue"))
                    ),
                    "ev_ebitda": ev_ebitda if c == ticker else v.get("ev_ebitda"),
                }
                for c, q, v in zip(
                    [ticker] + list(competitors),
                    [quote] + competitor_quotes,
                    [{}] + competitor_vals,
                )
            ],
            key=lambda x: x["market_cap"] or 0,
            reverse=True,
        ),
        "news": news,
    }

    if summary["price"] is None:
        detail = quote.get("error", "")
        raise ValueError(f"주가 데이터 없음{': ' + detail if detail else ''}")

    # 박제-시 독립피드 게이트(KR, .forge/adr/0020 보완, task#118 강화):
    # 리포트는 regular=True(KRX)라 NXT `_AL` 글리치엔 안전하지만, KRX 두 TR(quote·일봉)이
    # 함께 일시 글리치하는 자기일관 오염엔 면역이 아니다(task#101).
    # 독립 ref: 네이버 retry-once → 실패·None 시 KIS 폴백. first-available ref 사용.
    # ref 없으면 박제 스킵(wrong<missing). ref 있으면 기존 2x 교차검증.
    if market == "KR":
        import time
        from services.market.kr import _kr_basic_naver, _kr_basic_kis
        ref_price = None
        ref_src = None
        # 네이버 retry-once (transient rate-limit 완화)
        for _attempt in range(2):
            try:
                _ref = _kr_basic_naver(ticker)
                _p = _ref[0] if _ref and _ref[0] else None
                if _p:
                    ref_price, ref_src = _p, "Naver"
                break
            except Exception as _e:
                if _attempt == 0:
                    time.sleep(0.5)
                else:
                    logger.warning(f"[Report] {ticker} 네이버 ref 실패(retry 소진): {_e}")
        # KIS 폴백 (네이버 실패·None 시)
        if ref_price is None:
            _kis = _kr_basic_kis(ticker)
            _p = _kis[0] if _kis and _kis[0] else None
            if _p:
                ref_price, ref_src = _p, "KIS"
        # ref 전무 → 박제 스킵 (wrong<missing)
        if ref_price is None:
            logger.warning(f"[Report] {ticker} 독립 ref(네이버·KIS) 전무 — 박제 스킵(직전 스냅샷 유지)")
            raise ValueError(
                f"독립 ref(네이버·KIS) 없음 — 박제 스킵(직전 스냅샷 유지, task#118): {ticker}")
        # ref 있음 → 2x 교차검증
        daily_last = round(float(daily_df["Close"].iloc[-1]), 2) if not daily_df.empty else None
        for _label, _val in (("price", summary["price"]), ("일봉종가", daily_last)):
            if _val and not (0.5 <= _val / ref_price <= 2.0):
                logger.error(f"[Report] {ticker} KRX 시세 글리치 감지: {_label}={_val} vs 독립({ref_src})={ref_price} 2x 밖")
                raise ValueError(
                    f"KRX 시세 글리치 의심: {_label} {_val} vs 독립({ref_src}) {ref_price} 2x 밖 — "
                    f"박제 스킵(직전 스냅샷 유지, .forge/adr/0020, task#101/118)")

    sanitized = _sanitize(summary)
    json_path = output_dir / f"{today}.json"
    json_path.write_text(json.dumps(sanitized, ensure_ascii=False, indent=2), encoding="utf-8")
    try:
        execute(
            "INSERT INTO snapshots (ticker, date, data) VALUES (%s, %s, %s)"
            " ON CONFLICT (ticker, date) DO UPDATE SET data = EXCLUDED.data",
            (ticker, today, json.dumps(sanitized)),
        )
    except Exception as e:
        logger.warning(f"[Report] Supabase save failed for {ticker}: {e}")
    return str(json_path)


def _rsi_block(df: pd.DataFrame) -> dict:
    empty = {"rsi": None, "target_20": None, "target_25": None, "target_30": None,
             "target_70": None, "target_75": None, "target_80": None}
    if df.empty or len(df) < 15:
        return empty
    rsi = indicators.calc_rsi(df["Close"])
    if rsi.isna().all():
        return empty
    cur = round(float(rsi.iloc[-1]), 2)
    return {
        "rsi": cur,
        "target_20": indicators.calc_rsi_target_price(df["Close"], rsi, 20.0),
        "target_25": indicators.calc_rsi_target_price(df["Close"], rsi, 25.0),
        "target_30": indicators.calc_rsi_target_price(df["Close"], rsi, 30.0),
        "target_70": indicators.calc_rsi_target_price(df["Close"], rsi, 70.0),
        "target_75": indicators.calc_rsi_target_price(df["Close"], rsi, 75.0),
        "target_80": indicators.calc_rsi_target_price(df["Close"], rsi, 80.0),
    }


def _normalize_index(df: pd.DataFrame) -> pd.DataFrame:
    if df.index.tz is not None:
        df = df.copy()
        df.index = df.index.tz_localize(None)
    df.index = df.index.normalize()
    return df


def backfill_ticker(stock: dict, days: int = 60, output_base_dir: Path = SNAPSHOTS_DIR, force: bool = False) -> int:
    ticker = stock["ticker"]
    market = stock.get("market", "US")
    exchange = stock.get("exchange", "")
    yf_sym = mkt._yf_sym(ticker, market, exchange)

    output_dir = output_base_dir / ticker
    output_dir.mkdir(parents=True, exist_ok=True)

    try:
        rows = query("SELECT date FROM snapshots WHERE ticker = %s", (ticker.upper(),))
        existing = {str(r["date"]) for r in rows}
    except Exception as e:
        logger.warning(f"[Backfill] {ticker} DB 날짜 조회 실패, 파일 폴백: {e}")
        existing = {f.stem for f in output_dir.glob("*.json")}

    try:
        t = yf.Ticker(yf_sym)  # US history + (US) info용. KR은 info 대신 quote 사용.
        if market == "KR":
            # daily/weekly/monthly 모두 KRX 정규장(regular=True, .forge/adr/0020) — RSI 타점
            # (calc_rsi_target_price)은 절대가라 daily(KRX)와 스케일이 일치해야 함(generate_report의
            # get_timeframe_rsi(regular=True)와 동일 패턴, task#161 #2 backfill 누락분).
            daily_df   = _normalize_index(mkt.get_history_df(ticker, market, exchange, "daily", yf_period="2y", max_items=520, regular=True))
            weekly_df  = _normalize_index(mkt.get_history_df(ticker, market, exchange, "weekly", regular=True))
            monthly_df = _normalize_index(mkt.get_history_df(ticker, market, exchange, "monthly", regular=True))
        else:
            daily_df   = _normalize_index(t.history(period="2y",  interval="1d"))
            weekly_df  = _normalize_index(t.history(period="5y",  interval="1wk"))
            monthly_df = _normalize_index(t.history(period="10y", interval="1mo"))
    except Exception as e:
        logger.warning(f"[Backfill] {ticker} 히스토리 fetch 실패: {e}")
        return 0

    if daily_df.empty:
        return 0

    analyst           = mkt.get_analyst_data(ticker, market, exchange)
    financials        = mkt.get_financials(ticker, market, exchange)
    financials_annual = mkt.get_annual_financials(ticker, market, exchange)
    finviz            = scraper.scrape_finviz_consensus(ticker) if market == "US" else {}

    if market == "KR":
        quote = mkt.get_quote(ticker, market, exchange, regular=True)  # sector/이름용(price는 daily_df), 정규장 일관(.forge/adr/0020)
        sector = quote.get("sector", "")
        industry = quote.get("industry", "")
        actual_f = [f for f in financials if not f.get("is_consensus")]
        eps_list = [f["eps"] for f in actual_f if f.get("eps") is not None]
        trailing_eps = sum(eps_list[:4]) if len(eps_list) >= 4 else None  # TTM은 4분기 온전할 때만(sub-TTM PER 부풀림 방지, task#161 #3)
        consensus_f = next((f for f in financials if f.get("is_consensus") and f.get("eps")), None)
        actual_bps = next((f["bps"] for f in actual_f if f.get("bps") is not None), None)
    else:
        try:
            info = t.info
            sector = info.get("sector", "")
            industry = info.get("industry", "")
            trailing_per = info.get("trailingPE")
            forward_per = info.get("forwardPE")
            pbr = info.get("priceToBook")
        except Exception as e:
            logger.warning(f"[Backfill] {ticker} US info 조회 실패: {e}")
            sector = industry = ""
            trailing_per = forward_per = pbr = None

    resolved_name = mkt.resolve_name(ticker, market, exchange, stock.get("name", ""), quote=quote if market == "KR" else None)

    _today = _today_kst()  # 컨테이너 UTC라 bare date.today() 금지 (task#161 #5)
    cutoff = pd.Timestamp(_today - timedelta(days=days)).normalize()
    # 오늘자는 제외 — backfill은 과거만 박제, 오늘은 독립피드 게이트 있는 daily 배치(generate_report)가 처리.
    # 오늘자 ungated 박제 + force 덮어쓰기가 KRX 자기일관 글리치일에 양호 스냅샷을 오염시키던 것 방지(task#161 #4).
    trade_dates = [ts for ts in daily_df[daily_df.index >= cutoff].index if ts.date() < _today]

    created = 0
    for ts in trade_dates:
        date_str = ts.strftime("%Y-%m-%d")
        if not force and date_str in existing:
            continue

        d_trim = daily_df[daily_df.index <= ts]
        w_trim = weekly_df[weekly_df.index <= ts]
        m_trim = monthly_df[monthly_df.index <= ts]

        price = round(float(d_trim["Close"].iloc[-1]), 2)

        daily_rsi   = _rsi_block(d_trim)
        weekly_rsi  = _rsi_block(w_trim)
        monthly_rsi = _rsi_block(m_trim)
        vp = indicators.get_volume_profile(d_trim)

        high_20d = round(float(d_trim["High"].tail(20).max()), 2) if not d_trim.empty else None
        drop_from_high_20d = round((price - high_20d) / high_20d * 100, 2) if high_20d and price else None

        if market == "KR":
            trailing_per = round(price / trailing_eps, 1) if price and trailing_eps else None
            forward_per = round(price / (consensus_f["eps"] * 4), 1) if price and consensus_f else None
            pbr = round(price / actual_bps, 2) if price and actual_bps else None

        summary = {
            "ticker": ticker,
            "name": resolved_name,
            "date": date_str,
            "market": market,
            "price": price,
            "target_mean": analyst.get("target_mean") or finviz.get("finviz_target"),
            "target_high": analyst.get("target_high"),
            "target_low": analyst.get("target_low"),
            "buy": analyst.get("buy", 0),
            "hold": analyst.get("hold", 0),
            "sell": analyst.get("sell", 0),
            "finviz_recom": finviz.get("finviz_recom"),
            "daily_rsi": daily_rsi,
            "weekly_rsi": weekly_rsi,
            "monthly_rsi": monthly_rsi,
            "volume_profile": vp,
            "financials": financials,
            "financials_annual": financials_annual,
            "sector": sector,
            "industry": industry,
            "per": round(trailing_per, 2) if trailing_per else None,
            "forward_per": round(forward_per, 2) if forward_per else None,
            "pbr": round(pbr, 2) if pbr else None,
            "high_20d": high_20d,
            "drop_from_high_20d": drop_from_high_20d,
            "moat": stock.get("moat", ""),
            "growth_plan": stock.get("growth_plan", ""),
            "recent_disclosures": stock.get("recent_disclosures", ""),
            "risks": stock.get("risks", ""),
            "insights": stock.get("insights", ""),
            "key_resource": stock.get("key_resource", ""),
            "competitors_data": [],
            "news": [],
        }

        sanitized = _sanitize(summary)
        out_path = output_dir / f"{date_str}.json"
        out_path.write_text(json.dumps(sanitized, ensure_ascii=False, indent=2), encoding="utf-8")
        try:
            execute(
                "INSERT INTO snapshots (ticker, date, data) VALUES (%s, %s, %s)"
                " ON CONFLICT (ticker, date) DO UPDATE SET data = EXCLUDED.data",
                (ticker, date_str, json.dumps(sanitized)),
            )
        except Exception as e:
            logger.warning(f"[Backfill] Supabase save failed for {ticker} {date_str}: {e}")
            out_path.unlink(missing_ok=True)
            continue
        created += 1

    return created

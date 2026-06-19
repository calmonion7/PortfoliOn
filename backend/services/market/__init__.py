from __future__ import annotations
import yfinance as yf
import pandas as pd

# ── 공개 표면 보존: 서브모듈의 공개+외부참조 private 심볼을 패키지 루트로 re-export ──
# (.forge/adr/0017 — from services.market import X / from services import market; market.X 둘 다 보존)
from services.market.format import (
    _norm_sector,
    _n,
    _to_won,
    _yf_val,
    _yf_sym,
    _fmt_price,
    _fmt_market_cap,
)
from services.market.kr import (
    _NAVER_HEADERS,
    _NAVER_BASE,
    _naver_get,
    _naver_row_val,
    _fnguide_market_cap,
    _kr_basic_naver,
    _kr_basic_kiwoom,
    _kr_basic_kis,
    _kr_closes_kiwoom,
    get_quote_kr,
    get_financials_kr,
    get_annual_financials_kr,
    get_analyst_data_kr,
)
from services.market.us import (
    get_annual_financials_us,
    _us_quote_kis,
    _us_none_quote,
)


def get_quote(ticker: str, market: str = "US", exchange: str = "", _t=None) -> dict:
    # 종목 단위 TTL 캐시 — yfinance/Naver 호출을 종목당 TTL당 1회로 상한(rate-limit 방어).
    from services import cache as cache_svc
    key = f"{ticker.upper()}/{market}/{exchange}"
    return cache_svc.get_quote_cached(key, lambda: _get_quote_uncached(ticker, market, exchange, _t))


def resolve_name(ticker: str, market: str = "US", exchange: str = "", user_name: str = "", quote: dict | None = None) -> str:
    """종목 표시명 확정 — 사용자 입력이 비었거나 티커와 같으면 quote의 실명(KR=키움 stk_nm/Naver,
    US=yfinance shortName)으로 대체. quote도 실명이 없으면(조회 실패 등) 입력/티커를 그대로 둔다.

    이름이 종목번호로 박히는 것을 방지(근거: stock-name-enrichment). quote를 넘기면 재조회 안 함."""
    t = ticker.upper()
    un = (user_name or "").strip()
    if un and un.upper() != t:
        return un  # 사용자가 제대로 입력 → 존중
    try:
        q = quote if quote is not None else get_quote(ticker, market, exchange)
        qn = (q.get("name") or "").strip()
        if qn and qn.upper() != t:
            return qn
    except Exception:
        pass
    return un or ticker


def _get_quote_uncached(ticker: str, market: str = "US", exchange: str = "", _t=None) -> dict:
    if market == "KR":
        return get_quote_kr(ticker, exchange)

    yf_sym = _yf_sym(ticker, market, exchange)
    try:
        t = _t if _t is not None else yf.Ticker(yf_sym)
        info = t.info
        hist = t.history(period="1y")
        current = info.get("currentPrice") or info.get("regularMarketPrice")
        # info 실패 시 history 마지막 종가로 폴백
        if not current and not hist.empty:
            current = float(hist["Close"].iloc[-1])
        current = current or None
        if current:
            current = float(current)
            prev_close = float(hist["Close"].iloc[-2]) if len(hist) >= 2 else None
            week_ago = float(hist["Close"].iloc[-6]) if len(hist) >= 6 else None
            month_ago = float(hist["Close"].iloc[-23]) if len(hist) >= 23 else None
            ytd_start = float(hist["Close"].iloc[0]) if not hist.empty else None
            daily_change_pct = round((current - prev_close) / prev_close * 100, 2) if prev_close else None
            weekly_change_pct = round((current - week_ago) / week_ago * 100, 2) if week_ago else None
            monthly_change_pct = round((current - month_ago) / month_ago * 100, 2) if month_ago else None
            ytd_return = ((current - ytd_start) / ytd_start * 100) if ytd_start else None
            return {
                "ticker": ticker,
                "name": info.get("shortName", ticker),
                "price": current,
                "prev_close": round(prev_close, 2) if prev_close else None,
                "daily_change": f"{daily_change_pct:+.2f}%" if daily_change_pct is not None else "N/A",
                "daily_change_pct": daily_change_pct,
                "weekly_change_pct": weekly_change_pct,
                "monthly_change_pct": monthly_change_pct,
                "market_cap": info.get("marketCap"),
                "ytd_return": round(ytd_return, 2) if ytd_return else None,
                "market": market,
                "sector": _norm_sector(info.get("sector", "") or ""),
                "industry": info.get("industry", "") or "",
            }
    except Exception as e:
        # yfinance 예외 → KIS 백업(US, .forge/adr/0011), 그래도 없으면 에러 dict
        return _us_quote_kis(ticker, exchange) or _us_none_quote(ticker, market, error=str(e))

    # yfinance는 성공했으나 시세 없음 → KIS 백업
    return _us_quote_kis(ticker, exchange) or _us_none_quote(ticker, market)


def _closes_from_download(df, yf_sym: str, n_syms: int) -> list:
    """yf.download 결과에서 한 심볼의 Close 시계열(과거→현재)을 리스트로 추출."""
    try:
        series = df["Close"] if n_syms == 1 else df[yf_sym]["Close"]
        return [float(x) for x in series.dropna().tolist()]
    except Exception:
        return []


def _changes_from_closes(closes: list) -> dict:
    """일봉 종가 리스트에서 price·daily/weekly/monthly 변동률 산출(get_quote와 동일 인덱스)."""
    price = closes[-1] if closes else None
    prev = closes[-2] if len(closes) >= 2 else None
    week = closes[-6] if len(closes) >= 6 else None
    month = closes[-23] if len(closes) >= 23 else None

    def _pct(c, b):
        return round((c - b) / b * 100, 2) if (c and b) else None

    return {
        "price": float(price) if price else None,
        "daily_change_pct": _pct(price, prev),
        "weekly_change_pct": _pct(price, week),
        "monthly_change_pct": _pct(price, month),
    }


def get_quotes_batch(stocks: list) -> dict:
    """dashboard/prices 전용 일괄 시세 조회.

    US는 yf.download 1콜(raw 일봉 종가)로 price/변동률, KR은 종목별 get_quote(part1 캐시).
    sector는 여기서 안 가져온다 — 호출측(_build_card)이 snapshot에서 취해 t.info 비용을 없앤다.
    get_quote(full, ytd/sector 포함)는 report_generator 등 다른 호출처용으로 그대로 보존.
    반환 {TICKER: {price, daily/weekly/monthly_change_pct}}.
    """
    result: dict = {}
    us = [s for s in stocks if (s.get("market") or "US") != "KR"]
    kr = [s for s in stocks if (s.get("market") or "US") == "KR"]

    if us:
        sym_map = {s["ticker"].upper(): _yf_sym(s["ticker"], "US", s.get("exchange", "")) for s in us}
        syms = sorted(set(sym_map.values()))
        try:
            # auto_adjust=False: raw 종가(브로커 표시가에 근접) — 수정종가는 배당/분할 종목서 어긋남.
            df = yf.download(syms, period="3mo", progress=False, group_by="ticker",
                             auto_adjust=False, threads=True)
        except Exception:
            df = None
        for s in us:
            tk = s["ticker"].upper()
            closes = _closes_from_download(df, sym_map[tk], len(syms)) if df is not None else []
            if closes:
                result[tk] = _changes_from_closes(closes)
            else:
                # 배치 추출 실패 → part1 캐시된 단일 get_quote로 폴백(정확성 보존)
                q = get_quote(s["ticker"], "US", s.get("exchange", ""))
                result[tk] = {"price": q.get("price"), "daily_change_pct": q.get("daily_change_pct"),
                              "weekly_change_pct": q.get("weekly_change_pct"),
                              "monthly_change_pct": q.get("monthly_change_pct")}

    for s in kr:
        tk = s["ticker"].upper()
        # 키움 우선: 일봉 종가 시리즈 1콜 → US 경로와 동형으로 daily/weekly/monthly 산출(yfinance 제거).
        closes = _kr_closes_kiwoom(s["ticker"])
        if closes:
            result[tk] = _changes_from_closes(closes)
        else:
            # 폴백: 기존 get_quote 루프(part1 캐시, get_quote_kr이 키움 우선+Naver 폴백)
            q = get_quote(s["ticker"], "KR", s.get("exchange", ""))
            result[tk] = {"price": q.get("price"), "daily_change_pct": q.get("daily_change_pct"),
                          "weekly_change_pct": q.get("weekly_change_pct"),
                          "monthly_change_pct": q.get("monthly_change_pct")}

    return result


_HISTORY_CFG = {
    "daily":   ({"period": "1y",  "interval": "1d"},  260),
    "weekly":  ({"period": "5y",  "interval": "1wk"}, 300),
    "monthly": ({"period": "10y", "interval": "1mo"}, 240),
}


def get_history_df(ticker: str, market: str = "US", exchange: str = "",
                   timeframe: str = "daily", yf_period: str | None = None,
                   max_items: int | None = None):
    """yfinance history()와 동형 OHLCV DataFrame. KR은 키움(ka10081/82/83) 우선, 실패 시
    yfinance 폴백. 그 외 마켓은 yfinance. (.forge/adr/0009 — 키움은 KR 전용)"""
    yf_params, default_max = _HISTORY_CFG.get(timeframe, _HISTORY_CFG["daily"])
    if yf_period:
        yf_params = {**yf_params, "period": yf_period}
    max_items = max_items or default_max
    if market == "KR":
        try:
            from services.kiwoom import chart as kchart, client as kclient
            if kclient.configured():
                df = kchart.history_df(ticker, timeframe, max_items=max_items)
                if not df.empty:
                    return df
        except Exception:
            pass
    yf_sym = _yf_sym(ticker, market, exchange)
    try:
        return yf.Ticker(yf_sym).history(**yf_params)
    except Exception:
        return pd.DataFrame(columns=["Open", "High", "Low", "Close", "Volume"])


def get_financials(ticker: str, market: str = "US", exchange: str = "") -> list[dict]:
    if market == "KR":
        return get_financials_kr(ticker)

    yf_sym = _yf_sym(ticker, market, exchange)
    try:
        t = yf.Ticker(yf_sym)
        stmt = t.quarterly_income_stmt
        if stmt is None or stmt.empty:
            return []

        balance = t.quarterly_balance_sheet
        hist = t.history(period="2y")
        info = t.info
        fallback_shares = info.get("sharesOutstanding") or info.get("impliedSharesOutstanding")

        def _price_at(col):
            if hist.empty or not hasattr(col, "date"):
                return None
            target = col.date()
            dates = [d.date() if hasattr(d, "date") else d for d in hist.index]
            closes = list(hist["Close"])
            valid = [(d, c) for d, c in zip(dates, closes) if d <= target]
            return float(valid[-1][1]) if valid else None

        results = []
        for col in stmt.columns[:4]:
            period_str = col.strftime("%Y-%m") if hasattr(col, "strftime") else str(col)[:7]

            revenue    = _yf_val(stmt, "Total Revenue", col)
            op_income  = _yf_val(stmt, "Operating Income", col)
            net_income = _yf_val(stmt, "Net Income", col)
            diluted_shares = _yf_val(stmt, "Diluted Average Shares", col) or fallback_shares

            price = _price_at(col)

            eps = None
            if net_income and diluted_shares and float(diluted_shares) != 0:
                eps = round(float(net_income) / float(diluted_shares), 4)

            per = None
            if price and eps is not None and eps * 4 > 0:
                per = round(price / (eps * 4), 1)

            bps = pbr = None
            if balance is not None and not balance.empty and col in balance.columns:
                equity = None
                for k in ("Common Stock Equity", "Stockholders Equity", "Total Equity Gross Minority Interest"):
                    v = _yf_val(balance, k, col)
                    if v is not None:
                        equity = float(v)
                        break
                shares = float(diluted_shares) if diluted_shares else None
                if equity and shares and shares != 0:
                    bps = round(equity / shares, 4)
                    if price and bps > 0:
                        pbr = round(price / bps, 2)

            results.append({
                "period": period_str,
                "revenue": int(revenue) if revenue is not None else None,
                "operating_income": int(op_income) if op_income is not None else None,
                "eps": eps,
                "bps": bps,
                "per": per,
                "pbr": pbr,
                "is_consensus": False,
            })
        return results
    except Exception:
        return []


def get_annual_financials(ticker: str, market: str = "US", exchange: str = "") -> list[dict]:
    if market == "KR":
        return get_annual_financials_kr(ticker)
    return get_annual_financials_us(ticker, exchange)


def get_analyst_data(ticker: str, market: str = "US", exchange: str = "", _t=None) -> dict:
    if market == "KR":
        return get_analyst_data_kr(ticker)

    yf_sym = _yf_sym(ticker, market, exchange)
    try:
        t = _t if _t is not None else yf.Ticker(yf_sym)
        targets = t.analyst_price_targets or {}
        recs = t.recommendations_summary
        buy = hold = sell = 0
        if recs is not None and not recs.empty:
            row = recs.iloc[0]
            buy  = int(row.get("strongBuy", 0)) + int(row.get("buy", 0))
            hold = int(row.get("hold", 0))
            sell = int(row.get("sell", 0)) + int(row.get("strongSell", 0))
        return {
            "target_mean": targets.get("mean"),
            "target_high": targets.get("high"),
            "target_low":  targets.get("low"),
            "buy": buy, "hold": hold, "sell": sell,
        }
    except Exception:
        return {"target_mean": None, "target_high": None, "target_low": None, "buy": 0, "hold": 0, "sell": 0}

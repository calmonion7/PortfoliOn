from __future__ import annotations
import logging
import yfinance as yf
import requests

from services.market.format import _norm_sector, _n, _safe_ratio

logger = logging.getLogger(__name__)

_NAVER_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Referer": "https://m.stock.naver.com/",
    "Accept": "application/json, text/plain, */*",
}
_NAVER_BASE = "https://m.stock.naver.com/api/stock"


def _naver_get(ticker: str, path: str) -> dict | list:
    r = requests.get(f"{_NAVER_BASE}/{ticker}/{path}", headers=_NAVER_HEADERS, timeout=8)
    r.raise_for_status()
    return r.json()


_FNGUIDE_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    "Referer": "https://comp.fnguide.com/",
}

def _fnguide_market_cap(ticker: str) -> float | None:
    import re
    try:
        url = f"https://comp.fnguide.com/SVO2/asp/SVD_main.asp?gicode=A{ticker}"
        r = requests.get(url, headers=_FNGUIDE_HEADERS, timeout=8)
        clean = re.sub(r"<[^>]+>", " ", r.text)
        m = re.search(r"시가총액\s*\(보통주,억원\)\s*([\d,]+)", clean)
        if m:
            return int(m.group(1).replace(",", "")) * 100_000_000
    except Exception as e:
        logger.warning(f"[FnguideMarketCap] 시가총액 크롤 실패 ({ticker}): {e}")
        pass
    return None


def _naver_row_val(rows: list, row_idx: int, key: str) -> float | None:
    if row_idx >= len(rows):
        return None
    val = rows[row_idx].get("columns", {}).get(key, {}).get("value", "-")
    if not val or val == "-":
        return None
    try:
        return float(str(val).replace(",", ""))
    except ValueError:
        return None


def _kr_basic_naver(ticker: str) -> tuple:
    """Naver basic → (price, ratio, prev_close, mc, name). HTTP 오류(상폐 409)는 전파."""
    d = _naver_get(ticker, "basic")
    price = _n(d.get("closePrice"))
    change = _n(d.get("compareToPreviousClosePrice"))
    ratio = _n(d.get("fluctuationsRatio"))
    mc = _n(d.get("marketValue")) or _fnguide_market_cap(ticker)
    name = d.get("stockName", ticker)
    if ratio is not None and change is not None and ratio > 0 and change < 0:
        ratio = -ratio
    prev_close = (price - change) if (price is not None and change is not None) else None
    return price, ratio, (round(prev_close, 0) if prev_close is not None else None), mc, name


def _kr_basic_kiwoom(ticker: str, regular: bool = False) -> tuple | None:
    """키움 ka10001 → (price, ratio, prev_close, mc, name). 미설정/실패/빈 price면 None.
    `regular=True`면 KRX 정규장 종가(.forge/adr/0020)."""
    from services.kiwoom import client, quote as kq
    if not client.configured():
        return None
    try:
        q = kq.get_quote(ticker, regular=regular)
    except Exception as e:
        logger.warning(f"[KiwoomQuote] 키움 현재가 조회 실패 ({ticker}): {e}")
        return None
    if q.get("price") is None:
        return None
    return q["price"], q.get("daily_change_pct"), q.get("prev_close"), q.get("market_cap"), (q.get("name") or ticker)


def _kr_basic_kis(ticker: str) -> tuple | None:
    """KIS 국내 현재가 → (price, ratio, prev_close, mc, name). 미설정/실패/빈 price면 None.
    백업 폴백(키움 다음, Naver 앞): .forge/adr/0011."""
    from services.kis import client, quote as kisq
    if not client.configured():
        return None
    try:
        q = kisq.get_quote_kr(ticker)
    except Exception as e:
        logger.warning(f"[KISQuote] KIS 현재가 조회 실패 ({ticker}): {e}")
        return None
    if q.get("price") is None:
        return None
    return q["price"], q.get("daily_change_pct"), q.get("prev_close"), q.get("market_cap"), (q.get("name") or ticker)


def _kr_closes_kiwoom(ticker: str, max_items: int = 30, regular: bool = False) -> list:
    """키움 일봉 종가 시리즈(과거→현재). 미설정/실패 시 [] (호출측 폴백). monthly(-23)용 30개.
    `regular=True`면 KRX 정규장 종가(.forge/adr/0020)."""
    from services.kiwoom import chart as kchart
    try:
        return kchart.daily_closes(ticker, max_items=max_items, regular=regular)
    except Exception as e:
        logger.warning(f"[KiwoomCloses] 키움 일봉 조회 실패 ({ticker}): {e}")
        return []


def _price_sane(price: float, prev_close: float | None, ref_close: float | None = None) -> bool:
    """현재가가 비정상이면 False. 가능한 검증을 모두 통과해야 정상:
    ① 전일종가(prev_close)의 ±30% 이내 — KR 일일 가격제한폭(전날 대비 최대 ±30%),
    ② 키움 일봉 최근 종가(ref_close)의 [0.5, 2.0] 이내 — 독립 TR 교차검증(소스 자체
       prev_close까지 함께 오염된 경우 대비). 각 참조가 무효(None/≤0)면 그 검증만 생략,
       둘 다 없으면 검증 불가 → True.
    regular=False(NXT 라이브)의 단일 참조 글리치 면역은 ref_close/krx 단일검증이 아니라
    독립 피드 다수결(`_corroborated_pick`)이 담당한다 — 이 함수는 regular=True(리포트) 경로와
    다수결 합의 불가 시 degenerate self-check(±30%, ref_close 미전달)에만 쓰인다(task#98).
    ponytail: ±30%는 일반 종목 기준 — 신규상장/정리매매(가격제한 없음)는 false-reject
    가능하나 ②(2배)가 완충하고 그런 종목은 드물다. 한도 바뀌면 0.7/1.3 상수만 조정."""
    if prev_close and prev_close > 0 and not (0.7 <= price / prev_close <= 1.3):
        return False
    if ref_close and ref_close > 0 and not (0.5 <= price / ref_close <= 2.0):
        return False
    return True


def _corroborated_pick(feeds: list) -> tuple | None:
    """독립 현재가 피드들의 2-of-N 다수결. feeds = [(priority_rank, src, basic_tuple)].
    어떤 피드 가격이 *다른* 피드 ≥1개와 2x([0.5,2.0]) 이내로 합의(corroborate)하면 trusted.
    trusted 중 우선순위 최상위(rank 최소)를 반환, 합의 쌍이 없으면 None. 순수(I/O 없음).
    rank 순서가 곧 반환 우선순위(키움 NXT 0 → KIS 1 → Naver 2 → 키움 KRX 3)."""
    valid = [f for f in feeds if f[2] and f[2][0] and f[2][0] > 0]
    trusted = [
        fi for i, fi in enumerate(valid)
        if any(j != i and 0.5 <= fi[2][0] / fj[2][0] <= 2.0 for j, fj in enumerate(valid))
    ]
    return min(trusted, key=lambda f: f[0]) if trusted else None


def _kr_pick_regular(ticker: str, ref_close: float | None) -> tuple | None:
    """regular=True(리포트 스냅샷, KRX 정규장, .forge/adr/0020): 키움(KRX)→KIS→Naver 첫 유효 +
    _price_sane(전일종가±30%·일봉2x). task#94/95 동작 보존 — 독립 KRX 교차검증·다수결은 NXT
    라이브(regular=False) 전용이라 여기선 미적용(이미 KRX 정규장가). 유효 소스가 없으면 첫
    non-null로 폴백."""
    fallback = last = None
    for src, getter in (("키움", lambda t: _kr_basic_kiwoom(t, regular=True)),
                        ("KIS", _kr_basic_kis), ("Naver", _kr_basic_naver)):
        basic = getter(ticker)
        if basic is None:
            continue
        last = basic
        if basic[0] is None:
            continue
        if fallback is None:
            fallback = basic
        if _price_sane(basic[0], basic[2], ref_close):
            return basic
        logger.warning(f"[Quote] {ticker}: {src} 현재가 {basic[0]}가 전일종가 {basic[2]}±30%/일봉 {ref_close} 범위 밖 — 폐기")
    return fallback or last


def _kr_pick_degenerate_lazy(ticker: str, nxt: tuple | None, krx: tuple | None,
                             kis: tuple | None = None, naver: tuple | None = None) -> tuple | None:
    """키움 outage(부재/단일 — 불일치 아님): 우선순위 NXT→KIS→Naver→KRX 첫 ±30%-sane 반환,
    lazy short-circuit(앞 소스가 sane이면 뒤 getter 미호출 — 기존 lazy 동작 보존). 다수결의
    degenerate floor(가용 독립 2피드 없음): 단일 피드는 자기 전일종가 ±30%만 자가검증
    (자기일관 단일 글리치는 못 잡지만 wrong<missing — task#94 floor). 전부 실패면 첫 non-null.
    kis/naver: escalation이 이미 받은 결과를 전달하면 재사용(중복 HTTP 제거, task#137) —
    None(미전달·예외로 못 받음)이면 기존 lazy 호출."""
    fallback = None
    for src, getter in (("키움NXT", lambda: nxt),
                        ("KIS", lambda: kis if kis is not None else _kr_basic_kis(ticker)),
                        ("Naver", lambda: naver if naver is not None else _kr_basic_naver(ticker)),
                        ("키움KRX", lambda: krx)):
        basic = getter()
        if basic is None or basic[0] is None:
            continue
        if fallback is None:
            fallback = basic
        if _price_sane(basic[0], basic[2]):
            return basic
        logger.warning(f"[Quote] {ticker}: {src} 현재가 {basic[0]}가 전일종가 {basic[2]}±30% 밖 — 폐기")
    return fallback


def _kr_pick_basic(ticker: str, ref_close: float | None, regular: bool = False) -> tuple | None:
    """현재가 소스 선택 (price, ratio, prev_close, mc, name).
    `regular=True`(리포트 스냅샷, .forge/adr/0020): KRX 정규장 우선순위 체인 — `_kr_pick_regular`.
    `regular=False`(NXT 라이브, task#98): **독립 피드 2-of-N 다수결**로 단일 참조 글리치에 면역.
      ① 키움 NXT + 키움 KRX 2콜 → `_corroborated_pick` 합의면 NXT 반환(평소, lazy — KIS/Naver
         미호출). ② 불일치(어느 한쪽 글리치)면 KIS(+설정 시)·Naver를 escalate해 최대 4피드
         다수결로 합의된 최상위 반환·outlier(글리치) 폐기 — KRX-poison(KRX 단일 글리치)과 NXT
         자기일관 전체오염(task#96)을 둘 다 잡는다(어떤 단일 피드 글리치도 다수를 못 이김).
      ③ 키움 부재/단일(글리치 아닌 outage)·전 피드 합의 불가면 degenerate(±30% self-check)."""
    if regular:
        return _kr_pick_regular(ticker, ref_close)

    # regular=False: 독립 피드 다수결. KRX 참조 먼저(기존 호출 순서 보존), 그 다음 NXT 라이브.
    krx = _kr_basic_kiwoom(ticker, regular=True)
    nxt = _kr_basic_kiwoom(ticker, regular=False)
    kfeeds = [f for f in ((0, "키움NXT", nxt), (3, "키움KRX", krx)) if f[2] and f[2][0]]

    if len(kfeeds) < 2:
        # 키움 부재/단일 = 불일치 아님(outage). 다수결 미적용, 기존 lazy 체인.
        return _kr_pick_degenerate_lazy(ticker, nxt, krx)

    pick = _corroborated_pick(kfeeds)
    if pick:
        return pick[2]  # NXT≈KRX 합의 → 최상위(NXT), 평소 경로(2콜, KIS/Naver 미호출)

    # NXT≠KRX 불일치(글리치): KIS+Naver escalate → 다수결로 outlier 폐기
    feeds = list(kfeeds)
    esc: dict = {}  # escalation이 받은 결과 — 합의 불가 시 degenerate에 전달해 재호출 방지(task#137)
    for rank, src, getter in ((1, "KIS", lambda: _kr_basic_kis(ticker)),
                              (2, "Naver", lambda: _kr_basic_naver(ticker))):
        try:
            basic = getter()
        except Exception as e:
            logger.warning(f"[Quote] {ticker}: escalation {src} 피드 실패 — {e}")
            continue
        esc[src] = basic
        if basic and basic[0]:
            feeds.append((rank, src, basic))
    pick = _corroborated_pick(feeds)
    if pick:
        outliers = [f[1] for f in feeds if not (0.5 <= f[2][0] / pick[2][0] <= 2.0)]
        logger.warning(f"[Quote] {ticker}: 피드 발산 — {pick[1]} {pick[2][0]} 채택(다수결), outlier {outliers} 폐기")
        return pick[2]

    # 4피드도 합의 불가: degenerate self-check (escalation 결과 재사용)
    return _kr_pick_degenerate_lazy(ticker, nxt, krx, kis=esc.get("KIS"), naver=esc.get("Naver"))


def get_quote_kr(ticker: str, exchange: str = "KS", regular: bool = False) -> dict:
    """`regular=True`(리포트 스냅샷, .forge/adr/0020)면 키움 시세·일봉을 KRX 정규장 종가로.
    기본(False)은 NXT `_AL`(라이브 대시보드)."""
    try:
        # 매물대/RSI가 쓰는 키움 일봉 종가를 시세 검증 참조로 먼저 확보(같은 호출, 추가 콜 없음).
        kcloses = _kr_closes_kiwoom(ticker, max_items=260, regular=regular)
        ref_close = kcloses[-1] if kcloses else None

        # 키움 우선 → KIS 백업 → Naver 폴백 (경계: .forge/adr/0009·0011). 상폐 종목은 Naver 409로 검출.
        # 현재가가 전일종가 ±30%(KR 일일 제한폭) 또는 일봉 2배 범위 밖인 소스는 _kr_pick_basic이 폐기·폴백.
        basic = _kr_pick_basic(ticker, ref_close, regular=regular)
        price, ratio, prev_close, mc, name = basic
        daily_change = f"{ratio:+.2f}%" if ratio is not None else "N/A"

        sector = ""
        industry = ""

        ytd_return = None
        weekly_change_pct = None
        monthly_change_pct = None

        # 가격 변동률(ytd/주/월): 위에서 받은 키움 일봉 재사용
        if kcloses and price:
            start = kcloses[0]
            if start:
                ytd_return = round((price - start) / start * 100, 2)
            if len(kcloses) >= 6 and kcloses[-6]:
                weekly_change_pct = round((price - kcloses[-6]) / kcloses[-6] * 100, 2)
            if len(kcloses) >= 23 and kcloses[-23]:
                monthly_change_pct = round((price - kcloses[-23]) / kcloses[-23] * 100, 2)

        # sector/industry는 키움에 TR이 없어 yfinance 유지(.forge/adr/0009). 키움 변동률 실패 시 여기서 폴백.
        try:
            yf_t = yf.Ticker(f"{ticker}.{exchange or 'KS'}")
            if not kcloses and price:
                hist = yf_t.history(period="1y")
                if not hist.empty:
                    start = float(hist["Close"].iloc[0])
                    ytd_return = round((price - start) / start * 100, 2)
                    if len(hist) >= 6:
                        week_ago = float(hist["Close"].iloc[-6])
                        weekly_change_pct = round((price - week_ago) / week_ago * 100, 2)
                    if len(hist) >= 23:
                        month_ago = float(hist["Close"].iloc[-23])
                        monthly_change_pct = round((price - month_ago) / month_ago * 100, 2)
            yf_info = yf_t.info
            sector = _norm_sector(yf_info.get("sector", "") or "")
            industry = yf_info.get("industry", "") or ""
            if not mc:
                mc = _n(yf_info.get("marketCap"))
        except Exception as e:
            logger.warning(f"[KRQuote] yfinance 섹터/변동률 보강 실패 ({ticker}): {e}")
            pass

        return {
            "ticker": ticker,
            "name": name,
            "price": price,
            "prev_close": round(prev_close, 0) if prev_close is not None else None,
            "daily_change": daily_change,
            "daily_change_pct": ratio,
            "weekly_change_pct": weekly_change_pct,
            "monthly_change_pct": monthly_change_pct,
            "market_cap": int(mc) if mc else None,
            "ytd_return": ytd_return,
            "market": "KR",
            "sector": sector,
            "industry": industry,
        }
    except Exception as e:
        import requests as _req
        delisted = isinstance(e, _req.exceptions.HTTPError) and getattr(e.response, "status_code", None) == 409
        return {
            "ticker": ticker, "name": ticker, "price": None, "prev_close": None,
            "daily_change": "N/A",
            "daily_change_pct": None, "weekly_change_pct": None, "monthly_change_pct": None,
            "market_cap": None, "ytd_return": None,
            "market": "KR", "sector": "", "industry": "",
            "delisted": delisted,
            "error": "상장폐지 종목입니다." if delisted else str(e),
        }


def get_financials_kr(ticker: str) -> list[dict]:
    try:
        d = _naver_get(ticker, "finance/quarter")
        fi = d.get("financeInfo", {})
        period_meta = fi.get("trTitleList", [])
        rows = fi.get("rowList", [])

        if not period_meta or not rows:
            return []

        sorted_meta = sorted(period_meta, key=lambda t: t["key"], reverse=True)
        rv = lambda idx, k: _naver_row_val(rows, idx, k)

        latest_actual_bps = None
        for meta in sorted_meta[:6]:
            if meta.get("isConsensus") != "Y":
                v = rv(13, meta["key"])
                if v is not None:
                    latest_actual_bps = v
                    break

        results = []
        for meta in sorted_meta[:6]:
            key = meta["key"]
            period_str = f"{key[:4]}-{key[4:]}"
            is_consensus = meta.get("isConsensus") == "Y"

            revenue   = rv(0,  key)
            op_income = rv(1,  key)
            eps       = rv(11, key)
            per       = rv(12, key)
            bps       = rv(13, key)
            pbr       = rv(14, key)

            if is_consensus and bps is None and latest_actual_bps is not None:
                bps = latest_actual_bps

            if pbr is None and per is not None and eps is not None and bps and bps > 0:
                pbr = round(per * eps / bps, 2)

            ni_raw = rv(2, key)
            results.append({
                "period": period_str,
                "revenue":          int(revenue   * 1e8) if revenue   is not None else None,
                "operating_income": int(op_income * 1e8) if op_income is not None else None,
                "eps": round(eps, 0) if eps is not None else None,
                "bps": round(bps, 0) if bps is not None else None,
                "per": round(per, 1) if per is not None else None,
                "pbr": round(pbr, 2) if pbr is not None else None,
                "is_consensus": is_consensus,
                "net_income":        int(ni_raw * 1e8) if ni_raw is not None else None,
                "operating_margin":  round(rv(5, key), 2) if rv(5, key) is not None else None,
                "net_margin":        round(rv(6, key), 2) if rv(6, key) is not None else None,
                "roe":               round(rv(7, key), 2) if rv(7, key) is not None else None,
                "debt_ratio":        round(rv(8, key), 2) if rv(8, key) is not None else None,
                "quick_ratio":       round(rv(9, key), 2) if rv(9, key) is not None else None,
            })
        return results
    except Exception as e:
        logger.warning(f"[Financials] 분기 재무 조회 실패 ({ticker}): {e}")
        return []


_DART_BASE = "https://opendart.fss.or.kr/api"

# DART account_id (라이브 확정)
_DART_OCF   = "ifrs-full_CashFlowsFromUsedInOperatingActivities"
_DART_CAPEX = "ifrs-full_PurchaseOfPropertyPlantAndEquipmentClassifiedAsInvestingActivities"
_DART_INT   = "ifrs-full_InterestPaidClassifiedAsOperatingActivities"
_DART_EBIT  = "dart_OperatingIncomeLoss"


def _dart_extract_3y(list_data: list) -> dict:
    """fnlttSinglAcntAll list → {account_id: {0: thstrm_val, -1: frmtrm_val, -2: bfefrmtrm_val}} (원, int).
    fs_div를 요청에 넣어 받은 응답이라 행에 fs_div 필드가 없다(단일 fs) — 별도 필터 불필요.
    쉼표 제거 후 int; 결측/빈값 → None."""
    target = {aid: {} for aid in (_DART_OCF, _DART_CAPEX, _DART_INT, _DART_EBIT)}
    for row in list_data:
        aid = row.get("account_id", "")
        if aid not in target:
            continue
        for slot, key in ((0, "thstrm_amount"), (-1, "frmtrm_amount"), (-2, "bfefrmtrm_amount")):
            raw = (row.get(key) or "").replace(",", "").strip()
            try:
                target[aid][slot] = int(raw) if raw and raw not in ("", "-") else None
            except (ValueError, TypeError):
                target[aid][slot] = None
    return target


def get_annual_financials_kr(ticker: str) -> list[dict]:
    try:
        d = _naver_get(ticker, "finance/annual")
        fi = d.get("financeInfo", {})
        period_meta = fi.get("trTitleList", [])
        rows = fi.get("rowList", [])
        if not period_meta or not rows:
            return []

        sorted_meta = sorted(period_meta, key=lambda t: t["key"], reverse=True)
        rv = lambda idx, k: _naver_row_val(rows, idx, k)

        results = []
        for meta in sorted_meta[:4]:
            key = meta["key"]
            is_consensus = meta.get("isConsensus") == "Y"

            revenue   = rv(0,  key)
            op_income = rv(1,  key)
            eps       = rv(11, key)
            bps       = rv(13, key)
            per       = rv(12, key)
            pbr       = rv(14, key)

            ni_raw = rv(2, key)
            results.append({
                "period": key[:4],
                "revenue":          int(revenue   * 1e8) if revenue   is not None else None,
                "operating_income": int(op_income * 1e8) if op_income is not None else None,
                "eps": round(eps, 0) if eps is not None else None,
                "bps": round(bps, 0) if bps is not None else None,
                "per": round(per, 1) if per is not None else None,
                "pbr": round(pbr, 2) if pbr is not None else None,
                "is_consensus": is_consensus,
                "net_income":        int(ni_raw * 1e8) if ni_raw is not None else None,
                "operating_margin":  round(rv(5, key), 2) if rv(5, key) is not None else None,
                "net_margin":        round(rv(6, key), 2) if rv(6, key) is not None else None,
                "roe":               round(rv(7, key), 2) if rv(7, key) is not None else None,
                "debt_ratio":        round(rv(8, key), 2) if rv(8, key) is not None else None,
                "quick_ratio":       round(rv(9, key), 2) if rv(9, key) is not None else None,
                "fcf": None,
                "interest_coverage": None,
            })

        # DART 증강: FCF + 이자보상 (연간 전용)
        try:
            import os
            dart_key = os.environ.get("DART_API_KEY", "")
            if not dart_key:
                return results  # early skip — 키 없음

            from services.backlog import _get_corp_code_map
            corp_code = _get_corp_code_map().get(ticker)
            if not corp_code:
                return results

            # 최신 non-consensus 연도를 bsns_year로 사용
            bsns_year = next(
                (item["period"] for item in results if not item["is_consensus"]),
                None
            )
            if not bsns_year:
                return results

            # fnlttSinglAcntAll은 fs_div를 요청 필수값으로 받는다(없으면 status 100).
            # 연결(CFS) 우선, 없으면(미상장연결 등) 별도(OFS) 폴백.
            data = None
            for cand in ("CFS", "OFS"):
                resp = requests.get(
                    f"{_DART_BASE}/fnlttSinglAcntAll.json",
                    params={"crtfc_key": dart_key, "corp_code": corp_code,
                            "bsns_year": bsns_year, "reprt_code": "11011",
                            "fs_div": cand},
                    timeout=15,
                )
                resp.raise_for_status()
                d = resp.json()
                if d.get("status") == "000":
                    data = d
                    break
            if not data:
                return results

            acc = _dart_extract_3y(data.get("list", []))

            # bsns_year/bsns_year-1/bsns_year-2 → slot 0/-1/-2 매핑
            year_to_slot = {
                bsns_year: 0,
                str(int(bsns_year) - 1): -1,
                str(int(bsns_year) - 2): -2,
            }

            for item in results:
                slot = year_to_slot.get(item["period"])
                if slot is None:
                    continue
                ocf   = acc[_DART_OCF].get(slot)
                capex = acc[_DART_CAPEX].get(slot)
                ebit  = acc[_DART_EBIT].get(slot)
                int_p = acc[_DART_INT].get(slot)

                item["fcf"] = (ocf - capex) if (ocf is not None and capex is not None) else None
                item["interest_coverage"] = _safe_ratio(ebit, int_p)

        except Exception as e:
            logger.warning(f"[Financials] DART 현금흐름 증강 실패 ({ticker}): {e}")
            # 실패해도 Naver 결과만 반환 (graceful)

        return results
    except Exception as e:
        logger.warning(f"[Financials] 연간 재무 조회 실패 ({ticker}): {e}")
        return []


def get_analyst_data_kr(ticker: str) -> dict:
    _empty = {"target_mean": None, "target_high": None, "target_low": None, "buy": 0, "hold": 0, "sell": 0}
    try:
        import json as _json
        gicode = f"A{ticker}"
        url = f"https://comp.fnguide.com/SVO2/json/data/01_06/03_{gicode}.json"
        _headers = {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
            "Referer": "https://comp.fnguide.com/",
        }
        r = requests.get(url, headers=_headers, timeout=8)
        r.raise_for_status()
        d = _json.loads(r.content.decode("utf-8-sig"))
        items = d.get("comp", [])
        if not items:
            return _empty

        prices, recom_codes = [], []
        for item in items:
            try:
                prices.append(float(item["TARGET_PRC"].replace(",", "")))
            except (ValueError, KeyError):
                pass
            try:
                recom_codes.append(float(item["RECOM_CD"]))
            except (ValueError, KeyError):
                pass

        avg_str = items[0].get("AVG_PRC", "")
        target_mean = float(avg_str.replace(",", "")) if avg_str else (sum(prices) / len(prices) if prices else None)

        buy  = sum(1 for c in recom_codes if c >= 3.5)
        hold = sum(1 for c in recom_codes if 2.5 <= c < 3.5)
        sell = sum(1 for c in recom_codes if c < 2.5)

        return {
            "target_mean": target_mean,
            "target_high": max(prices) if prices else None,
            "target_low":  min(prices) if prices else None,
            "buy": buy, "hold": hold, "sell": sell,
        }
    except Exception as e:
        logger.warning(f"[AnalystData] FnGuide 애널리스트 데이터 조회 실패 ({ticker}): {e}")
        return _empty

from fastapi import APIRouter, HTTPException, Query, Depends, BackgroundTasks
from pydantic import BaseModel, Field, model_validator
from typing import Optional, List, Any
from services import storage
from services.db import query
from services.utils import sanitize
import re
import math
import json
import requests as http_requests
import yfinance as yf
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor, as_completed
from services import market
from services import scraper
from services import cache as cache_svc
from services import consensus as consensus_svc
from services import job_runs
from services import dividends
from services import supply_score
from services import insider_trades
from services.market_indicators.cache import _mc_load
from auth import get_current_user, get_current_user_or_api_key, _API_KEY_USER_ID, require_admin, require_admin_or_api_key
import logging

logger = logging.getLogger(__name__)

SNAPSHOTS_DIR = Path(__file__).parent.parent / "snapshots"
REPORTS_DIR = Path(__file__).parent.parent / "reports"


def _latest_snapshot(ticker: str) -> tuple:
    """Find and load the latest snapshot for a ticker. Tries DB first, falls back to filesystem."""
    try:
        rows = query(
            "SELECT date, data FROM snapshots WHERE ticker = %s ORDER BY date DESC LIMIT 1",
            (ticker.upper(),),
        )
        if rows:
            return rows[0]["data"], rows[0]["date"]
    except Exception as e:
        logger.warning(f"[Snapshot] DB 조회 실패 ({ticker}): {e}")
        pass
    # Filesystem fallback (pre-migration)
    for base in (SNAPSHOTS_DIR, REPORTS_DIR):
        ticker_dir = base / ticker
        if ticker_dir.exists():
            dates = sorted([f.stem for f in ticker_dir.glob("*.json")], reverse=True)
            if dates:
                path = ticker_dir / f"{dates[0]}.json"
                try:
                    data = json.loads(path.read_text(encoding="utf-8"))
                    return data, dates[0]
                except Exception as e:
                    logger.warning(f"[Snapshot] 파일 읽기 실패 ({path}): {e}")
                    pass
    return None, None


def _latest_snapshots(tickers: list) -> dict:
    """Batch-load the latest snapshot for many tickers in one DB query.

    Returns {UPPER_ticker: (data, date)}. Tickers absent from the batch result
    (DB miss, or DB error → all of them) fall back to per-ticker _latest_snapshot,
    preserving the filesystem fallback path so the response is unchanged. Empty/None-safe.
    """
    clean = [t.upper() for t in (tickers or []) if t]
    if not clean:
        return {}
    result = {}
    try:
        rows = query(
            "SELECT DISTINCT ON (ticker) ticker, date, data FROM snapshots "
            "WHERE ticker = ANY(%s) ORDER BY ticker, date DESC",
            (clean,),
        )
        for row in rows:
            result[row["ticker"].upper()] = (row["data"], row["date"])
    except Exception as e:
        logger.warning(f"[Snapshot] 배치 DB 조회 실패: {e}")
        pass
    for t in clean:
        if t not in result:
            result[t] = _latest_snapshot(t)
    return result


router = APIRouter(prefix="/api/stocks", tags=["stocks"])

_KR_PATTERN = re.compile(r'[가-힣]')
# Matches exchange suffixes for non-US/KR markets (e.g. .T .L .HK .PA .DE .AX)
_INTL_SUFFIX = re.compile(r'\.[A-Z]{1,4}$')


def _search_naver(q: str, max_results: int = 12) -> list:
    """Search Korean stocks via Naver Finance autocomplete (supports Korean text)."""
    try:
        r = http_requests.get(
            "https://ac.stock.naver.com/ac",
            params={"q": q, "target": "stock"},
            headers={"User-Agent": "Mozilla/5.0"},
            timeout=5,
        )
        items = r.json().get("items", [])
        results = []
        for item in items[:max_results]:
            code = item.get("code", "")
            name = item.get("name", "")
            type_code = item.get("typeCode", "KOSPI")
            if type_code == "KOSDAQ":
                exchange, security_type = "KQ", "EQUITY"
            elif type_code in ("ETF", "KOSPI ETF", "KOSDAQ ETF"):
                exchange, security_type = "KS", "ETF"
            else:
                exchange, security_type = "KS", "EQUITY"
            results.append({
                "ticker": code,
                "name": name,
                "market": "KR",
                "exchange": exchange,
                "exchange_display": type_code,
                "security_type": security_type,
            })
        return results
    except Exception as e:
        logger.warning(f"[Search] Naver 자동완성 실패 ({q!r}): {e}")
        return []


# ── market_outlook 스키마 (B53) ──────────────────────────────────────────────
# 정본은 CLAUDE_COWORK_API.md의 `market_outlook` / `market_outlook.segments[]` 표다.
# 이 필드는 예전에 `Optional[Any]`였고 그래서 루틴이 **산문 문자열**을 보내도 그대로 저장됐다 —
# 프론트(MarketOutlookSection)는 문자열에서 아무 필드도 못 읽어 "시장 전망" 섹션을 통째로
# 조용히 생략한다(크래시도 422도 없어 루틴이 같은 실수를 반복했다). 구조 모델로 바꿔 422를 낸다.
#
# 설계 제약 — 이 엔드포인트는 Cowork enrich **쓰기 경로**이므로 좁은 검증은 기존에 성공하던
# 발행을 막는다. 그래서 라이브 저장값 124종(dict 119)을 전수 대입해 통과를 확인한 범위로만 좁혔다
# (예외는 아래 별칭 오타 6종 하나뿐이다 — 그건 라이브에 실재하지만 **통과시켜도 화면에 안 나오므로**
# 「기존에 성공하던 발행」이 아니다):
#   · extra="allow" — 라이브에 스키마 밖 키가 실재한다(`text` 11건·`share_basis` 1건,
#     segments의 `revenue_pct`·`change_pct` 등). 기본값 extra="ignore"면 model_dump가 그것들을
#     **조용히 버려** 데이터 손실이 된다. 미지 키는 보존하고 아는 키만 검증한다 — 단
#     **알려진 오타 별칭**(`_SEGMENT_KEY_ALIASES`)과 **화면이 읽는 필드가 0개인 판**은
#     원래 결함과 증상이 같으므로(조용한 미렌더) 거부한다.
#   · 필수는 segments[].name·period 둘뿐(라이브 102/102 존재, 정본도 필수 표기).
#     나머지 전 필드는 Optional — 라이브에 결측·명시적 null이 흔하다(size_current 자체 null 4건,
#     size_current.value null 12건, cagr_pct null 31건, company_share_pct null 88건).
#   · 선택 배열도 Optional[List[X]] = Field(None) — `Field(default_factory=list)`로 두면 루틴이
#     보낸 명시적 null 하나가 enrich 요청 전체를 422로 막는다(task#250).
#   · 모든 float에 allow_inf_nan=False — NaN/Infinity 토큰은 json.loads와 진리값 가드를 통과하고
#     응답 직렬화에서 500이 된다(task#211·#292).
class MarketSize(BaseModel):
    """market_outlook.size_current / size_forecast — {value, unit, year}.

    unit은 Literal로 못박지 않는다 — 라이브에 30종의 자유 문자열이 있고 주석까지 붙는다
    ("십억달러"·"GW (연간 신규 설치)"·"만CGT"·"톤(tU)/년")."""
    model_config = {"extra": "allow"}
    value: Optional[float] = Field(None, allow_inf_nan=False, ge=0)
    unit: Optional[str] = Field(None)
    year: Optional[int] = Field(None, ge=1900, le=2200)


class SegmentMarket(BaseModel):
    """market_outlook.segments[].market — 그 부문이 속한 시장."""
    model_config = {"extra": "allow"}
    size: Optional[float] = Field(None, allow_inf_nan=False, ge=0)
    unit: Optional[str] = Field(None)
    year: Optional[int] = Field(None, ge=1900, le=2200)
    size_forecast: Optional[float] = Field(None, allow_inf_nan=False, ge=0)
    forecast_year: Optional[int] = Field(None, ge=1900, le=2200)
    cagr_pct: Optional[float] = Field(None, allow_inf_nan=False, ge=-100, le=1000)


# 별칭 오타 → 정본 필드명. B53의 잔여분이고 **결함 클래스가 같다**(조용한 미렌더).
# `extra="allow"`가 미지 키를 통과시키는데 `segmentUtils.js`는 이 6종을 하나도 읽지 않으므로,
# 그 부문은 이름·기간만 뜨고 비중 막대가 그려지지 않는다 — 크래시도 422도 없어 루틴이 같은
# 실수를 반복한다(라이브 102부문 실측: revenue_pct 46 · change_pct 24 · revenue_pct_change 12 ·
# revenue_share_change_pp 2 · revenue_share_change_pct 2 · market_share_pct 1).
# `extra="allow"` 자체는 유지한다(`text`·`share_basis` 보존이 load-bearing) — **아는 오타만**
# 거부하고 메시지에 정본명을 실어 루틴이 스스로 고치게 한다.
# ⚠️ 증감 계열 4종은 정본 필드가 없다 — 화면이 `prev_revenue_share_pct`에서 직접 계산한다.
_SEGMENT_KEY_ALIASES = {
    "revenue_pct": "revenue_share_pct",
    "market_share_pct": "share_pct",
    "change_pct": "prev_period + prev_revenue_share_pct(증감은 화면이 계산한다)",
    "revenue_pct_change": "prev_period + prev_revenue_share_pct(증감은 화면이 계산한다)",
    "revenue_share_change_pp": "prev_period + prev_revenue_share_pct(증감은 화면이 계산한다)",
    "revenue_share_change_pct": "prev_period + prev_revenue_share_pct(증감은 화면이 계산한다)",
}


class MarketOutlookSegment(BaseModel):
    """market_outlook.segments[] — 사업부문별 매출 비중·시장 규모·자사 점유율.

    name·period만 필수다. period는 financials_annual의 period와 문자열이 일치해야 서버가
    부문 매출 금액을 환산하므로(정본 기입 지침) 결측이면 금액이 통째로 사라진다 —
    조용한 소실보다 422가 낫다."""
    # str_strip_whitespace — 이게 없으면 min_length=1이 "   "(공백만)을 통과시켜
    # 비중 막대에 빈 라벨을 그린다(라이브에 공백 padding 문자열은 0건이라 기존 값엔 무영향).
    model_config = {"extra": "allow", "str_strip_whitespace": True}
    name: str = Field(..., min_length=1)
    period: str = Field(..., min_length=1)
    revenue_share_pct: Optional[float] = Field(None, allow_inf_nan=False, ge=0, le=100)
    prev_period: Optional[str] = Field(None)
    prev_revenue_share_pct: Optional[float] = Field(None, allow_inf_nan=False, ge=0, le=100)
    market: Optional[SegmentMarket] = Field(None)
    share_pct: Optional[float] = Field(None, allow_inf_nan=False, ge=0, le=100)
    share_pct_forecast: Optional[float] = Field(None, allow_inf_nan=False, ge=0, le=100)
    note: Optional[str] = Field(None)
    sources: Optional[List[str]] = Field(None)

    @model_validator(mode="after")
    def _no_alias_typos(self):
        """정본 필드명의 별칭 오타를 거부한다 — 통과시키면 그 수치가 화면에 없는 것과 같다."""
        hits = sorted(k for k in (self.model_extra or {}) if k in _SEGMENT_KEY_ALIASES)
        if hits:
            fixes = ", ".join("%s → %s" % (k, _SEGMENT_KEY_ALIASES[k]) for k in hits)
            raise ValueError(
                "segments[].%s 는 화면이 읽지 않는 필드명입니다(값이 조용히 사라집니다). "
                "정본 필드명으로 바꿔 다시 보내세요: %s" % ("·".join(hits), fixes))
        return self


class MarketOutlook(BaseModel):
    """market_outlook — 회사가 속한 전방시장의 규모·성장 전망(Cowork 조사·기입)."""
    model_config = {"extra": "allow"}
    market_name: Optional[str] = Field(None)
    size_current: Optional[MarketSize] = Field(None)
    size_forecast: Optional[MarketSize] = Field(None)
    cagr_pct: Optional[float] = Field(None, allow_inf_nan=False, ge=-100, le=1000)
    company_share_pct: Optional[float] = Field(None, allow_inf_nan=False, ge=0, le=100)
    position: Optional[str] = Field(None)
    sources: Optional[List[str]] = Field(None)
    one_liner: Optional[str] = Field(None)
    segments: Optional[List[MarketOutlookSegment]] = Field(None)

    @model_validator(mode="after")
    def _forecast_year_not_before_current(self):
        """전망 연도가 현재 연도보다 앞서면 CAGR·"현재→예상" 대조가 무의미해진다.
        (형제 Market._estimates_consistency의 year 동일성 검증에 대응하는 축.)"""
        cur = self.size_current.year if self.size_current else None
        fc = self.size_forecast.year if self.size_forecast else None
        if cur is not None and fc is not None and fc < cur:
            raise ValueError("size_forecast.year는 size_current.year보다 앞설 수 없습니다")
        return self

    @model_validator(mode="after")
    def _segment_names_unique(self):
        """부문명 중복은 비중 막대와 표에 같은 이름의 행을 두 번 그려 독자가 서로 다른 둘로
        읽는다(task#297 options[].name 중복과 같은 결함)."""
        if not self.segments:
            return self
        names = [s.name for s in self.segments]
        if len(names) != len(set(names)):
            raise ValueError("segments의 name은 서로 달라야 합니다")
        return self

    @model_validator(mode="after")
    def _has_renderable_content(self):
        """화면이 읽는 필드가 하나도 없으면 거부한다 — B53의 증상이 미지 키로 되살아나는 것을 막는다.

        `extra="allow"`라 `{"text": "<산문>"}`은 타입 검증을 통과하는데, 그러면
        MarketOutlookSection의 early-return 조건이 그대로 성립해 "시장 전망" 섹션이 **통째로**
        렌더되지 않는다(산문 문자열을 보냈을 때와 증상이 같다). 그래서 이 축은 그 early-return
        조건의 **등가**로 쓴다 — 느슨하게(선언 필드 아무거나 있으면 통과) 쓰면 판별력이 없다:
        `position`·`sources`만 있는 판은 프론트가 아무것도 그리지 않으므로 여기서도 거부한다.
        (`size_*`는 value가 있어야 렌더된다 — fmtSize가 값 결측을 null로 만든다.)"""
        rendered = (
            bool((self.market_name or "").strip())
            or (self.size_current is not None and self.size_current.value is not None)
            or (self.size_forecast is not None and self.size_forecast.value is not None)
            or self.cagr_pct is not None
            or self.company_share_pct is not None
            or bool((self.one_liner or "").strip())
            or bool(self.segments)
        )
        if not rendered:
            raise ValueError(
                "market_outlook에 화면이 읽는 필드가 하나도 없습니다 — market_name · "
                "size_current.value · size_forecast.value · cagr_pct · company_share_pct · "
                "one_liner · segments 중 최소 하나를 실으세요. 산문은 one_liner에 씁니다"
                "(정본에 없는 키에 넣으면 '시장 전망' 섹션이 통째로 표시되지 않습니다)")
        return self


class EnrichBody(BaseModel):
    moat: Optional[Any] = None
    growth_plan: Optional[Any] = None
    risks: Optional[Any] = None
    recent_disclosures: Optional[Any] = None
    insights: Optional[Any] = None
    key_resource: Optional[Any] = None
    competitor_edge: Optional[Any] = None
    market_outlook: Optional[MarketOutlook] = Field(None)
    competitors: Optional[List[str]] = None


class BatchEnrichItem(BaseModel):
    ticker: str
    moat: Optional[Any] = None
    growth_plan: Optional[Any] = None
    risks: Optional[Any] = None
    recent_disclosures: Optional[Any] = None
    insights: Optional[Any] = None
    key_resource: Optional[Any] = None
    competitor_edge: Optional[Any] = None
    market_outlook: Optional[MarketOutlook] = Field(None)
    competitors: Optional[List[str]] = None


@router.get("/search")
def search_stocks(q: str = Query(..., min_length=1), market: str = "ALL", _: str = Depends(get_current_user)):
    # Yahoo Finance doesn't support Korean text — use Naver autocomplete instead
    if _KR_PATTERN.search(q):
        results = _search_naver(q)
        if market != "ALL":
            results = [r for r in results if r["market"] == market]
        return results

    try:
        results = yf.Search(q, max_results=12, enable_fuzzy_query=True)
        quotes = results.quotes or []
    except Exception as e:
        logger.warning(f"[Search] yfinance 검색 실패 ({q!r}): {e}")
        return []

    filtered = []
    for item in quotes:
        symbol = item.get("symbol", "")
        if item.get("quoteType") not in ("EQUITY", "ETF"):
            continue
        if symbol.endswith(".KS"):
            item_market, item_exchange, item_ticker = "KR", "KS", symbol[:-3]
        elif symbol.endswith(".KQ"):
            item_market, item_exchange, item_ticker = "KR", "KQ", symbol[:-3]
        elif _INTL_SUFFIX.search(symbol):
            continue  # unsupported international market (e.g. .T .L .HK)
        else:
            item_market, item_exchange = "US", ""
            item_ticker = symbol.replace("-", ".")
        if market != "ALL" and item_market != market:
            continue
        name = item.get("shortname") or item.get("longname") or item_ticker
        security_type = "ETF" if item.get("quoteType") == "ETF" else "EQUITY"
        filtered.append({
            "ticker": item_ticker,
            "name": name,
            "market": item_market,
            "exchange": item_exchange,
            "exchange_display": item.get("exchDisp", item.get("exchange", "")),
            "security_type": security_type,
        })
    return filtered


# 종목 비교 — 방향 자명 지표만 그룹별 정의(direction: higher/lower/None=애매→하이라이트 제외)
_COMPARE_METRICS = [
    ("per", "valuation", "lower"),
    ("pbr", "valuation", "lower"),
    ("psr", "valuation", "lower"),
    ("ev_ebitda", "valuation", "lower"),
    ("target_mean", "valuation", None),
    ("upside", "valuation", "higher"),
    ("roe", "financial", "higher"),
    ("operating_margin", "financial", "higher"),
    ("debt_ratio", "financial", "lower"),
    ("fcf", "financial", "higher"),
    ("rsi", "technical", None),
    ("week52_position", "technical", None),
    ("hv", "technical", None),
    ("beta", "technical", None),
]


def _compare_best(values: dict, direction: str) -> list:
    """방향 자명 지표의 per-지표 best ticker 목록(순수함수).

    결측/비유한은 비교 대상서 제외, 전부 결측이면 []. 동률은 공동 best. direction이
    'higher'/'lower'가 아니면(애매 지표) 하이라이트 자체를 안 함 → []."""
    if direction not in ("higher", "lower"):
        return []
    finite = {t: v for t, v in values.items() if isinstance(v, (int, float)) and math.isfinite(v)}
    if not finite:
        return []
    target = max(finite.values()) if direction == "higher" else min(finite.values())
    return [t for t, v in finite.items() if v == target]


def _f(v):
    """비교값을 float로 정규화(None/비유한/비수치→None). DB NUMERIC(Decimal)↔float 혼산·JSON 직렬화 안전."""
    try:
        x = float(v)
        return x if math.isfinite(x) else None
    except (TypeError, ValueError):
        return None


def _compare_extract(snapshot: "dict | None", target_mean, beta) -> dict:
    """스냅샷(+as-of 목표가 정본·stock_beta)에서 비교 지표값 추출. snapshot 없으면 전부 None.

    필드 경로는 report_generator.py 저장 스키마/routers/report.py 소비 경로와 동일(추정 아님):
    per/pbr/psr/ev_ebitda/price/week52_high/week52_low/hv는 스냅샷 top-level,
    ROE·영업이익률·부채비율·FCF는 financials_annual의 최신 non-consensus 항목,
    RSI는 daily_rsi.rsi. 목표가는 daily_consensus_mart as-of(호출자가 조회해 넘김, ADR-0008)."""
    if not snapshot:
        return {k: None for k, _, _ in _COMPARE_METRICS}
    # DB NUMERIC(Decimal)과 스냅샷 float 혼재 → 전부 float로 정규화:
    # ① Decimal-float 산술 TypeError 방지 ② _compare_best의 isinstance(int,float)가 Decimal을 놓치지 않게 ③ JSON 직렬화(Decimal 불가) 안전
    price = _f(snapshot.get("price"))
    target_mean = _f(target_mean)
    upside = None
    if price and target_mean and price != 0:
        upside = round((target_mean - price) / price * 100, 2)
    fin = next((f for f in (snapshot.get("financials_annual") or []) if not f.get("is_consensus")), None) or {}
    w_hi, w_lo = _f(snapshot.get("week52_high")), _f(snapshot.get("week52_low"))
    week52_position = None
    if price is not None and w_hi and w_lo and w_hi != w_lo:
        week52_position = round((price - w_lo) / (w_hi - w_lo) * 100, 1)
    return {
        "per": _f(snapshot.get("per")),
        "pbr": _f(snapshot.get("pbr")),
        "psr": _f(snapshot.get("psr")),
        "ev_ebitda": _f(snapshot.get("ev_ebitda")),
        "target_mean": target_mean,
        "upside": upside,
        "roe": _f(fin.get("roe")),
        "operating_margin": _f(fin.get("operating_margin")),
        "debt_ratio": _f(fin.get("debt_ratio")),
        "fcf": _f(fin.get("fcf")),
        "rsi": _f((snapshot.get("daily_rsi") or {}).get("rsi")),
        "week52_position": week52_position,
        "hv": _f(snapshot.get("hv")),
        "beta": _f(beta),
    }


@router.get("/compare")
def compare_stocks(tickers: str = Query(..., min_length=1), user_id: str = Depends(get_current_user)):
    """보유+관심 종목 2~4개의 밸류에이션·재무·기술 지표를 최신 스냅샷에서 비교(신규 수집 없음)."""
    ticker_list = [t.strip().upper() for t in tickers.split(",") if t.strip()]
    if not ticker_list:
        raise HTTPException(status_code=400, detail="tickers required")
    if len(ticker_list) > 4:
        raise HTTPException(status_code=400, detail="최대 4개까지 비교 가능합니다")

    snapshots = _latest_snapshots(ticker_list)
    beta_rows = query(
        "SELECT ticker, beta FROM stock_beta WHERE ticker = ANY(%s) AND beta IS NOT NULL",
        (ticker_list,),
    )
    beta_map = {r["ticker"].upper(): float(r["beta"]) for r in beta_rows}
    # 목표가 정본 = daily_consensus_mart as-of(종목별 최신 스냅샷 날짜). ADR-0008.
    asof_pairs = [(t, snapshots[t][1]) for t in ticker_list if snapshots.get(t) and snapshots[t][0] and snapshots[t][1]]
    asof_rows = consensus_svc.get_asof_batch(asof_pairs) if asof_pairs else {}

    tickers_info = []
    per_ticker_values = {}
    for t in ticker_list:
        data, _date = snapshots.get(t, (None, None))
        tickers_info.append({"ticker": t, "name": (data or {}).get("name") or t, "available": bool(data)})
        row = asof_rows.get(t)
        target_mean = row["target_mean"] if row and row.get("target_mean") is not None else (data or {}).get("target_mean")
        per_ticker_values[t] = _compare_extract(data, target_mean, beta_map.get(t))

    metrics = []
    for key, group, direction in _COMPARE_METRICS:
        values = {t: per_ticker_values[t].get(key) for t in ticker_list}
        metrics.append({
            "key": key, "group": group, "direction": direction,
            "values": values, "best": _compare_best(values, direction),
        })

    return sanitize({"tickers": tickers_info, "metrics": metrics})


@router.get("/{ticker}/news")
def get_stock_news(ticker: str, market: str = "US", _: str = Depends(get_current_user)):
    """종목 최근 뉴스 (랭킹 등 리포트 없는 종목용 on-demand 조회). scraper.get_news 재사용, 인증 필요(ADR-0029)."""
    if market not in ("KR", "US"):
        raise HTTPException(status_code=400, detail="market must be KR or US")
    try:
        news = scraper.get_news(ticker, market)
    except Exception as e:
        logger.warning(f"[News] 뉴스 조회 실패 ({ticker}): {e}")
        news = []
    return {"news": news}


@router.get("/{ticker}/supply-score")
def get_supply_score(ticker: str, user_id: str = Depends(get_current_user)):
    """종목 수급 종합 스코어(ADR-0014) 저장값 조회 — 라이브 호출 0.

    저장된 {band,flags,as_of}만 투영해 반환. 미산출(US·결측 포함)이면 None."""
    score = supply_score.read_score(ticker)
    if not score:
        return None
    return {"band": score.get("band"), "flags": score.get("flags"), "as_of": score.get("as_of")}


def _enriched_at_map(tickers: list) -> dict:
    """ticker(대문자)→{enriched_at, analyst_target} — tickers 배치 1콜(task#213·214, 루틴 선별 재료)."""
    clean = [t.upper() for t in tickers if t]
    if not clean:
        return {}
    try:
        rows = query("SELECT ticker, enriched_at, analyst_target FROM tickers WHERE ticker = ANY(%s)", (clean,))
        return {
            r["ticker"].upper(): {
                "enriched_at": r["enriched_at"].isoformat() if r.get("enriched_at") else None,
                "analyst_target": bool(r.get("analyst_target")),
            }
            for r in rows
        }
    except Exception as e:
        logger.warning(f"[Stocks] enriched_at 조회 실패: {e}")
        return {}


@router.get("")
def get_stocks(user_id: str = Depends(get_current_user_or_api_key)):
    portfolio = storage.get_global_portfolio() if user_id == _API_KEY_USER_ID else storage.get_full_portfolio(user_id)
    result = []
    for s in portfolio["stocks"]:
        result.append({"ticker": s["ticker"], "name": s.get("name", s["ticker"]), "type": "holding", "market": s.get("market", "US")})
    for s in portfolio["watchlist"]:
        result.append({"ticker": s["ticker"], "name": s.get("name", s["ticker"]), "type": "watchlist", "market": s.get("market", "US")})
    ea = _enriched_at_map([r["ticker"] for r in result])
    for r in result:
        meta = ea.get(r["ticker"].upper()) or {}
        r["enriched_at"] = meta.get("enriched_at")
        r["analyst_target"] = bool(meta.get("analyst_target"))
    return result


@router.put("/enrich/batch")
def enrich_batch(items: List[BatchEnrichItem], user_id: str = Depends(require_admin_or_api_key)):
    if not items:
        raise HTTPException(status_code=400, detail="No items provided")
    updated, not_found = [], []
    for item in items:
        fields = {k: v for k, v in item.model_dump(exclude_none=True).items() if k != "ticker" and v is not None}
        if not fields:
            not_found.append(item.ticker.upper())
            continue
        ok = storage.enrich_stock(item.ticker, fields)
        (updated if ok else not_found).append(item.ticker.upper())
    return {"updated": updated, "not_found": not_found}


@router.put("/{ticker}/enrich")
def enrich_single(ticker: str, body: EnrichBody, user_id: str = Depends(require_admin_or_api_key)):
    fields = {k: v for k, v in body.model_dump(exclude_none=True).items() if v is not None}
    if not fields:
        raise HTTPException(status_code=400, detail="No fields provided")
    ok = storage.enrich_stock(ticker, fields)
    if not ok:
        raise HTTPException(status_code=404, detail="Ticker not found")
    return {"ticker": ticker.upper(), "updated": list(fields.keys())}


@router.delete("/dashboard/cache")
def clear_dashboard_cache(user_id: str = Depends(get_current_user)):
    cache_svc.invalidate_dashboard(user_id)
    return {"cleared": True}


@router.post("/names/backfill", status_code=202)
def backfill_names(_: str = Depends(require_admin)):
    """name이 비었거나 티커와 같은(=종목번호로 박힌) 종목을 quote 실명으로 일괄 교정.
    tickers.name + 기존 스냅샷 name 동기 갱신(KR=키움/Naver, US=yfinance). admin 전용."""
    candidates = storage.tickers_missing_name()

    def _one(row):
        ticker = row["ticker"]
        name = market.resolve_name(ticker, row.get("market") or "US", row.get("exchange") or "", "")
        if name and name.upper() != ticker.upper():
            storage.set_ticker_name(ticker, name)
            return ticker, True
        return ticker, False  # resolve_name이 실명 못 찾음(빈값/티커형 반환) — skip

    updated, skipped = [], []
    if candidates:
        # max_workers ≤ 8: 워커가 DB 풀(maxconn=10)을 점유(set_ticker_name 2 writes) → 풀 초과 방지
        with ThreadPoolExecutor(max_workers=max(1, min(len(candidates), 8))) as executor:
            for future in as_completed([executor.submit(_one, c) for c in candidates]):
                ticker, ok = future.result()
                if ok:
                    updated.append(ticker)
                else:
                    # silent skip 금지(CLAUDE.md): resolve_name이 티커형/빈값을 반환해 건너뜀.
                    # 시세 일시실패와 '실명 없음'을 구분 못 하므로 재시도 대신 진단 로그+표면화.
                    skipped.append(ticker)
                    logger.warning(f"[Backfill] skip {ticker}: resolve_name이 실명을 못 찾음(시세 일시실패 가능, 결과가 예상보다 작으면 재실행 권장)")

    # tickers.name을 이미 고쳤지만 스냅샷이 옛 이름인 종목(예: 수동교정)까지 동기화
    reconciled = storage.reconcile_snapshot_names()
    for t in set(updated) | set(reconciled):
        cache_svc.invalidate(t)
    cache_svc.invalidate_portfolio_caches()
    return {"ok": True, "candidates": len(candidates), "updated": len(updated), "skipped": skipped, "reconciled": len(reconciled)}


@router.post("/dividends/refresh", status_code=202)
def refresh_all_dividends(background_tasks: BackgroundTasks, user_id: str = Depends(require_admin)):
    background_tasks.add_task(_run_dividends_all)
    return {"message": "배당 전 종목 수집 시작"}


def _run_dividends_all():
    from services.dividends import fetch_all_dividends
    with job_runs.record("dividend_fetch", "manual"):
        fetch_all_dividends()


@router.post("/beta/refresh", status_code=202)
def refresh_all_betas(background_tasks: BackgroundTasks, user_id: str = Depends(require_admin)):
    background_tasks.add_task(_run_betas_all)
    return {"message": "베타 전 종목 수집 시작"}


def _run_betas_all():
    from services.beta import fetch_all_betas
    with job_runs.record("beta_fetch", "manual"):
        fetch_all_betas()


@router.post("/supply-score/refresh", status_code=202)
def refresh_supply_score(background_tasks: BackgroundTasks, user_id: str = Depends(require_admin)):
    background_tasks.add_task(_run_supply_score_all)
    return {"message": "수급 종합 스코어 전 종목 산출 시작"}


def _run_supply_score_all():
    from scheduler import _supply_score_work
    with job_runs.record("supply_score_fetch", "manual"):
        _supply_score_work()


def _usdkrw_rate() -> "float | None":
    """저장된 USD/KRW 환율(market_cache 'fx')만 읽는다 — 요청 경로 라이브 FX 호출 0.

    작성자는 FX 배치 `fx_fetch`(매일 06:40 KST, `scheduler/jobs._refresh_fx` →
    `market_indicators/fx._fetch_and_save_fx`)와 요청경로 `fx.get_fx`(시장지표 탭) 둘이다 —
    `get_fx`는 배치가 아니므로 `_JOB_FUNCS`에서 그 이름을 찾지 말 것.
    없으면 None(US 배당은 KRW 환산서 제외)."""
    stored = _mc_load("fx")
    if not stored:
        return None
    rate = ((stored.get("data") or {}).get("rates") or {}).get("usdkrw") or {}
    cur = rate.get("current")
    try:
        v = float(cur) if cur else None
    except (TypeError, ValueError):
        return None
    # 비유한(nan/inf)은 None — 안 그러면 _portfolio_totals의 `if fx is None` 가드를 통과해(NaN≠None)
    # totals가 NaN→응답 직렬화 500(CONCERNS §3, task#104). None이면 US 카드가 totals서 graceful 제외.
    return v if (v is not None and math.isfinite(v)) else None


@router.get("/dashboard")
def get_dashboard(user_id: str = Depends(get_current_user)):
    portfolio = storage.get_full_portfolio(user_id)
    holdings = portfolio.get("stocks", [])
    if not holdings:
        return {"holdings": [], "totals": None}

    def _build_card(stock: dict, quote: dict) -> dict:
        ticker = stock["ticker"].upper()
        snapshot, snapshot_date = _latest_snapshot(ticker)

        rsi = None
        target_mean = buy = hold = sell = None
        poc = vah = val = None
        hvn = []
        sector = ""
        if snapshot:
            rsi = (snapshot.get("daily_rsi") or {}).get("rsi")
            target_mean = snapshot.get("target_mean")
            buy = snapshot.get("buy")
            hold = snapshot.get("hold")
            sell = snapshot.get("sell")
            vp = snapshot.get("volume_profile") or {}
            poc = vp.get("poc")
            vah = vp.get("vah")
            val = vp.get("val")
            hvn = vp.get("hvn") or []
            # sector는 snapshot에서(part2 — t.info 제거). 기존 동치 위해 _norm_sector 적용.
            sector = market._norm_sector(snapshot.get("sector") or "")
            # 목표가·의견수 정본 = daily_consensus_mart as-of(최신 snapshot 날짜). 상세·목록과 동일 헬퍼로 정합. ADR-0008.
            _c = consensus_svc.apply_asof(
                {"target_mean": target_mean, "buy": buy, "hold": hold, "sell": sell},
                ticker, snapshot_date,
            )
            target_mean, buy, hold, sell = _c["target_mean"], _c["buy"], _c["hold"], _c["sell"]

        # 배당(income 뷰): 저장값만 읽음(라이브 yfinance/DART 호출 0). 무배당은 None graceful.
        div = dividends.get_dividend(ticker)
        annual_div = div.get("annual_dividend_per_share") if div else None
        div_yield = div.get("dividend_yield") if div else None
        avg_cost = stock.get("avg_cost")
        qty = stock.get("quantity")
        # 사용자 목표가/손절가(선택, 저장값만). 거리%는 프론트에서 current_price와 계산(task#142).
        target_price = stock.get("target_price")
        stop_price = stock.get("stop_price")
        # avg_cost/qty는 DB NUMERIC→Decimal, annual_div는 float이라 그대로 나누면
        # float/Decimal TypeError로 카드 빌드가 throw→minimal 폴백된다(대시보드 enrichment 전멸,
        # task#102 증상의 실제 트리거). 양쪽을 float로 정규화.
        yield_on_cost = (round(float(annual_div) / float(avg_cost) * 100, 2)
                         if (annual_div is not None and avg_cost) else None)
        expected_income = (round(float(annual_div) * float(qty), 2)
                           if (annual_div is not None and qty) else None)

        # 수급 종합 스코어(ADR-0014): KR 종목만 저장값(stock_supply_score) 조회 — 라이브 호출 0.
        # US/결측은 None. read_score 행에서 {band,flags,as_of}만 투영.
        supply = None
        if (stock.get("market") or "US") == "KR":
            score = supply_score.read_score(ticker)
            if score:
                supply = {"band": score.get("band"), "flags": score.get("flags"), "as_of": score.get("as_of")}

        # 내부자·5%지분 순매수 신호(S6): KR 종목만 저장값(stock_insider_trades) 집계 — 라이브 DART 0.
        # US/무데이터는 None. compute_net_signal에서 {direction,net_shares,count,window_days} 투영.
        insider = None
        if (stock.get("market") or "US") == "KR":
            insider = insider_trades.compute_net_signal(ticker)

        return {
            "ticker": ticker,
            "name": stock.get("name", ticker),
            "market": stock.get("market", "US"),
            "exchange": stock.get("exchange", ""),
            "avg_cost": avg_cost,
            "quantity": qty,
            "target_price": target_price,
            "stop_price": stop_price,
            "current_price": quote.get("price"),
            "daily_change_pct": quote.get("daily_change_pct"),
            "weekly_change_pct": quote.get("weekly_change_pct"),
            "monthly_change_pct": quote.get("monthly_change_pct"),
            "rsi": rsi,
            "poc": poc,
            "vah": vah,
            "val": val,
            "hvn": hvn,
            "target_mean": target_mean,
            "buy": buy,
            "hold": hold,
            "sell": sell,
            "snapshot_date": snapshot_date,
            "sector": sector or "기타",
            "annual_dividend_per_share": annual_div,
            "dividend_yield": div_yield,
            "yield_on_cost": yield_on_cost,
            "expected_annual_income": expected_income,
            "supply": supply,
            "insider": insider,
        }

    def _portfolio_totals(cards: list) -> "dict | None":
        """통화 혼재 합산은 KRW로 환산(US$×usdkrw, KR원×1). 평균 수익률=총배당/총평가.

        usdkrw는 저장 FX(_usdkrw_rate)만 사용. US 카드에 환율이 없으면 그 종목은
        총계에서 제외해 단위 혼동(달러를 원으로 오합산)을 막는다."""
        usdkrw = _usdkrw_rate()

        def _fx(card) -> "float | None":
            if (card.get("market") or "US") == "KR":
                return 1.0
            return usdkrw

        total_income = 0.0
        total_value = 0.0
        for c in cards:
            fx = _fx(c)
            if fx is None:
                continue
            inc = c.get("expected_annual_income")
            if inc is not None:
                total_income += inc * fx
            price, qty = c.get("current_price"), c.get("quantity")
            if price is not None and qty:
                total_value += float(price) * float(qty) * fx
        avg_yield = round(total_income / total_value * 100, 2) if total_value > 0 else None
        return {
            "total_expected_annual_income_krw": round(total_income, 2),
            "total_market_value_krw": round(total_value, 2),
            "avg_dividend_yield": avg_yield,
        }

    def _minimal_card(stock: dict, quote: dict) -> dict:
        """enrichment 실패 시 폴백 카드 — 기본 식별/보유 정보 + quote 시세만, 나머지 None.
        holdings=N이면 그리드도 N을 보장(빈 그리드 금지, task#102). 지표/배당은 폴링·재fetch가 채운다."""
        return {
            "ticker": stock["ticker"].upper(), "name": stock.get("name", stock["ticker"]),
            "market": stock.get("market", "US"), "exchange": stock.get("exchange", ""),
            "avg_cost": stock.get("avg_cost"), "quantity": stock.get("quantity"),
            "target_price": stock.get("target_price"), "stop_price": stock.get("stop_price"),
            "current_price": quote.get("price"),
            "daily_change_pct": quote.get("daily_change_pct"),
            "weekly_change_pct": quote.get("weekly_change_pct"),
            "monthly_change_pct": quote.get("monthly_change_pct"),
            "rsi": None, "poc": None, "vah": None, "val": None, "hvn": [],
            "target_mean": None, "buy": None, "hold": None, "sell": None,
            "snapshot_date": None, "sector": "기타",
            "annual_dividend_per_share": None, "dividend_yield": None,
            "yield_on_cost": None, "expected_annual_income": None,
            "supply": None, "insider": None,
        }

    def _build_all():
        # 일괄시세 실패도 카드 빌드를 막지 않는다 — 시세 없이 빌드(price None, 폴링이 채움).
        try:
            quotes = market.get_quotes_batch(holdings)
        except Exception as e:
            logger.warning(f"[Dashboard] 일괄시세 실패 — 시세 없이 카드 빌드: {e}")
            quotes = {}

        # 카드당 graceful — 한 종목 enrichment(snapshot/consensus/배당/수급/내부자 등)가 throw해도
        # 그 카드만 최소카드로 폴백하고 전체 500-to-empty를 막는다. holdings=N → 항상 N카드(task#102).
        def _safe(stock: dict) -> dict:
            q = quotes.get(stock["ticker"].upper(), {})
            try:
                return _build_card(stock, q)
            except Exception as e:
                logger.warning(f"[Dashboard] {stock.get('ticker')} 카드 빌드 실패 — 최소카드 폴백: {e}")
                return _minimal_card(stock, q)

        with ThreadPoolExecutor(max_workers=min(len(holdings), 10)) as executor:
            cards = list(executor.map(_safe, holdings))
        # NaN/inf는 None으로 — starlette JSONResponse(allow_nan=False)가 응답에 NaN/inf 있으면
        # 직렬화 500을 내므로(CONCERNS §3, task#104) 외부시세서 흘러든 비유한값을 안전망으로 제거.
        return sanitize({"holdings": cards, "totals": _portfolio_totals(cards)})

    return cache_svc.get_dashboard(user_id, _build_all)

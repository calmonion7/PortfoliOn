"""종목 추천 API (.forge/adr/0015 §6 per-user partition).

GET /api/recommendations — 발굴 섹션(글로벌 점수 − 호출자 추적종목, 점수 내림차순).
  저장값만 읽음(요청경로 외부 호출 0). 응답은 섹션 키 객체(additive) — part3/4가
  "watchlist"/"holdings" 키를 추가만으로 붙인다.
POST /api/recommendations/refresh — admin, market 쿼리(KR|US) 수동 트리거.
"""
import math

from fastapi import APIRouter, Query, Depends, BackgroundTasks, HTTPException
from auth import get_current_user, require_admin
from services import recommendation, storage, job_runs
from services.utils import sanitize
from routers.stocks import _latest_snapshots, _usdkrw_rate  # 저장값 read 헬퍼 재사용(라이브 호출 0)
import scheduler

router = APIRouter(prefix="/api/recommendations", tags=["recommendations"])


@router.get("")
def get_recommendations(
    limit: int = Query(50, ge=1, le=200),
    user_id: str = Depends(get_current_user),
):
    """발굴·관심 섹션 반환(저장값 read-only, 점수 내림차순).

    응답 shape(섹션 키 객체; exchange=거래소 코드 KR=KS|KQ, US=''):
        {"as_of": <date|null>,
         "discovery": [{ticker,name,market,score,flags,rank,exchange}, ...],  # 호출자 추적종목 제외
         "watchlist": [{ticker,name,market,score,flags,rank,exchange}, ...],  # 호출자 관심종목, 점수 없으면 score=None 말미
         "holdings": [{ticker,name,market,score,flags,rank,exchange,action,reasons,pnl_pct,weight_pct}, ...]}  # 보유종목 액션
    """
    portfolio = storage.get_full_portfolio(user_id)
    wl_stocks = portfolio["watchlist"]
    all_stocks = portfolio["stocks"] + wl_stocks
    tracked = [s["ticker"] for s in all_stocks if s.get("ticker")]
    # 저유동성은 점수·저장 유지하되 discovery에서만 제외 — ADR-0015 §2(추적종목 점수 보존)·멀티유저 누수 회피
    rows = recommendation.read_recommendations(exclude_tickers=tracked, limit=limit, exclude_low_liquidity=True)

    def _item(r):
        return {
            "ticker": r["ticker"],
            "name": r.get("name"),
            "market": r.get("market"),
            "score": float(r["score"]) if r.get("score") is not None else None,
            "flags": r.get("flags") or [],
            "rank": r.get("rank"),
            "exchange": r.get("exchange") or "",
        }

    def _as_of(rows_, current):
        for r in rows_:
            bd = r.get("base_date")
            bd_str = bd.isoformat() if hasattr(bd, "isoformat") else (str(bd) if bd else None)
            if bd_str and (current is None or bd_str > current):
                current = bd_str
        return current

    as_of = _as_of(rows, None)
    discovery = [_item(r) for r in rows]

    # 관심 섹션: 호출자 watchlist를 저장 점수로 score DESC 정렬(저장값 read만).
    wl_tickers = [s["ticker"] for s in wl_stocks if s.get("ticker")]
    watchlist = []
    if wl_tickers:
        scored = recommendation.read_recommendations(only_tickers=wl_tickers)
        as_of = _as_of(scored, as_of)
        scored_by_ticker = {r["ticker"].upper(): r for r in scored}
        watchlist = [_item(r) for r in scored]  # score DESC 보존
        for s in wl_stocks:
            t = s.get("ticker")
            if not t or t.upper() in scored_by_ticker:
                continue
            watchlist.append({
                "ticker": t,
                "name": s.get("name"),
                "market": s.get("market"),
                "score": None,
                "flags": [],
                "rank": None,
                "exchange": s.get("exchange") or "",
            })

    # 보유 액션 섹션 (part 4/4): 저장 EOD 가격·저장 FX로 비중·손익 계산 후 action 도출.
    # 요청경로 외부호출 0 — _latest_snapshots(저장 스냅샷 배치)·_usdkrw_rate(저장 FX)만 읽는다.
    holdings = []
    holdings_stocks = portfolio["stocks"]
    holdings_tickers = [s["ticker"] for s in holdings_stocks if s.get("ticker")]
    if holdings_tickers:
        scored_h = recommendation.read_recommendations(only_tickers=holdings_tickers)  # 세 번째 read
        as_of = _as_of(scored_h, as_of)
        score_by_ticker = {r["ticker"].upper(): r for r in scored_h}
        usdkrw = _usdkrw_rate()
        snaps = _latest_snapshots(holdings_tickers)  # 보유 전체 스냅샷 배치 1회 read(요청당 N→1)

        # 1) 종목별 KRW 환산 가치·손익 선계산(분모 합 산정 위해).
        ctx = {}  # ticker → {price, qty, krw_value(None=환산불가), pnl_pct}
        for s in holdings_stocks:
            t = s.get("ticker")
            if not t:
                continue
            snapshot, _ = snaps.get(t.upper(), (None, None))
            price = (snapshot or {}).get("price")
            qty = s.get("quantity")
            avg_cost = s.get("avg_cost")
            market_ = s.get("market") or "US"

            try:
                price_f = float(price) if price is not None else None
                if price_f is not None and not math.isfinite(price_f):
                    price_f = None
            except (TypeError, ValueError):
                price_f = None
            try:
                qty_f = float(qty) if qty is not None else None
            except (TypeError, ValueError):
                qty_f = None
            try:
                avg_f = float(avg_cost) if avg_cost is not None else None
            except (TypeError, ValueError):
                avg_f = None

            # 손익률(FX-무관): price 또는 avg_cost 결측이면 None
            pnl_pct = None
            if price_f is not None and avg_f not in (None, 0):
                pnl_pct = (price_f - avg_f) / avg_f * 100

            # KRW 환산 가치: KR→fx=1.0, US→usdkrw(None이면 환산 불가)
            fx = 1.0 if market_ == "KR" else usdkrw
            krw_value = None
            if price_f is not None and qty_f is not None and fx is not None:
                krw_value = price_f * qty_f * fx

            ctx[t] = {"krw_value": krw_value, "pnl_pct": pnl_pct}

        total_krw = sum(c["krw_value"] for c in ctx.values() if c["krw_value"] is not None)

        # 2) 종목별 base item + action.
        for s in holdings_stocks:
            t = s.get("ticker")
            if not t:
                continue
            r = score_by_ticker.get(t.upper())
            if r is not None:
                item = _item(r)
            else:
                item = {
                    "ticker": t,
                    "name": s.get("name"),
                    "market": s.get("market"),
                    "score": None,
                    "flags": [],
                    "rank": None,
                    "exchange": s.get("exchange") or "",
                }
            c = ctx[t]
            weight_pct = (c["krw_value"] / total_krw * 100) if (c["krw_value"] is not None and total_krw) else None
            pnl_pct = c["pnl_pct"]
            action = recommendation.derive_holding_action(item["score"], weight_pct, pnl_pct)
            item.update({
                "action": action["action"],
                "reasons": action["reasons"],
                "pnl_pct": pnl_pct,
                "weight_pct": weight_pct,
            })
            holdings.append(item)

    # NaN/inf 네트(다중 float) — starlette allow_nan=False 직렬화 500 방지 (task#109, CONCERNS §1)
    return sanitize({"as_of": as_of, "discovery": discovery, "watchlist": watchlist, "holdings": holdings})


@router.post("/refresh", status_code=202)
def refresh_recommendations(
    background_tasks: BackgroundTasks,
    market: str = Query(..., pattern="^(KR|US)$"),
    _: str = Depends(require_admin),
):
    """추천 점수 갱신(scheduler._recommendation_work, admin 전용). market=KR|US."""
    job_id = "recommendation_kr" if market == "KR" else "recommendation_us"

    def _run():
        with job_runs.record(job_id, "manual"):
            scheduler._recommendation_work(market)

    background_tasks.add_task(_run)
    return {"ok": True}

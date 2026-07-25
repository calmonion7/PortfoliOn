"""애널리스트 리포트 발행·조회 API (ADR-0027, task#211).

신규 prefix /api/analyst-reports — 기존 /api/report의 catch-all GET /{ticker}/{date_str}
오인 라우팅 회피(ADR-0027 근거). 발행은 Cowork(admin/API key), 열람은 로그인 사용자 전체.
"""
import logging
from datetime import date, datetime
from typing import List, Literal
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field, field_validator

from auth import get_current_user_or_api_key, require_admin_or_api_key
from services import analyst_reports as svc
from services.utils import sanitize

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/analyst-reports", tags=["analyst-reports"])

_KST = ZoneInfo("Asia/Seoul")


class PointMetric(BaseModel):
    """포인트 핵심 지표 칩(한눈 구조화, task#218) — value는 표시용 문자열("383.2조원"·"8.8배")."""
    label: str = Field(..., min_length=1, max_length=40)
    value: str = Field(..., min_length=1, max_length=40)
    change_pct: float = Field(None, allow_inf_nan=False)  # 증감%(선택) — 프론트가 up/down 색

class ReportPoint(BaseModel):
    title: str = Field(..., min_length=1)
    body: str = Field(..., min_length=1)
    metrics: List[PointMetric] = Field(default_factory=list, max_length=4)  # additive — 구 판 호환


class PublishBody(BaseModel):
    rating: Literal["buy", "neutral", "sell"]
    title: str = Field(..., min_length=1)
    # allow_inf_nan=False: raw JSON body의 NaN/Infinity 토큰이 json.loads·NaN 비교(항상 False)를
    # 모두 통과해 불변 문서에 오염 저장되는 것을 422로 차단(적대 리뷰 #1, wrong<missing)
    fair_value_low: float = Field(..., allow_inf_nan=False)
    fair_value_high: float = Field(..., allow_inf_nan=False)
    valuation_method: str = Field(..., min_length=1)
    points: List[ReportPoint] = Field(..., min_length=2, max_length=3)
    risks: str = Field(..., min_length=1)

    @field_validator("fair_value_high")
    @classmethod
    def _band_order(cls, v, info):
        low = info.data.get("fair_value_low")
        if low is not None and v < low:
            raise ValueError("fair_value_high must be >= fair_value_low")
        return v


@router.post("/{ticker}", status_code=201)
def publish_report(ticker: str, body: PublishBody, _: str = Depends(require_admin_or_api_key)):
    """발행 — 판단 필드는 요청 본문, 데이터 블록은 서버가 최신 스냅샷에서 자동 첨부.

    스냅샷 부재 시 409(데이터 블록 불가 — ADR-0027 발행 전제조건)."""
    upper = ticker.upper()
    snap = svc.latest_snapshot(upper)
    if snap is None:
        raise HTTPException(status_code=409, detail=f"{upper} 스냅샷 없음 — 리포트 생성 후 발행 가능")
    snapshot_date, snapshot_data = snap
    data = sanitize(svc.build_data_block(snapshot_data or {}, snapshot_date))
    published_date = datetime.now(_KST).date().isoformat()
    svc.save_report(
        upper, published_date, body.rating, body.title,
        body.fair_value_low, body.fair_value_high, body.valuation_method,
        [p.model_dump() for p in body.points], body.risks, data,
    )
    logger.info(f"[AnalystReport] 발행 ({upper} {published_date}): rating={body.rating}")
    return {"ok": True, "ticker": upper, "published_date": published_date}


@router.get("")
def list_all(_: str = Depends(get_current_user_or_api_key)):
    """전체 발행물 목록(요약, 최신순). API key 허용 — 루틴의 발행 가드레일 판단 재료(task#213)."""
    return sanitize({"reports": svc.list_reports()})


@router.get("/{ticker}")
def list_by_ticker(ticker: str, _: str = Depends(get_current_user_or_api_key)):
    """종목별 판 목록(최신순)."""
    return sanitize({"ticker": ticker.upper(), "reports": svc.list_reports(ticker)})


@router.get("/{ticker}/{published_date}")
def get_detail(ticker: str, published_date: str, _: str = Depends(get_current_user_or_api_key)):
    """발행물 상세 — Cowork 텍스트 + 서버 첨부 데이터 블록."""
    try:
        date.fromisoformat(published_date)  # 비정상 date 문자열의 DB 캐스트 500 방지
    except ValueError:
        raise HTTPException(status_code=404, detail="발행물 없음")
    report = svc.get_report(ticker, published_date)
    if report is None:
        raise HTTPException(status_code=404, detail="발행물 없음")
    return sanitize(report)

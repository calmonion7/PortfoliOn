"""애널리스트 리포트 발행·조회 API (ADR-0027, task#211).

신규 prefix /api/analyst-reports — 기존 /api/report의 catch-all GET /{ticker}/{date_str}
오인 라우팅 회피(ADR-0027 근거). 발행은 Cowork(admin/API key), 열람은 로그인 사용자 전체.
"""
import logging
from datetime import date, datetime
from typing import List, Literal, Optional
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field, field_validator

from auth import get_current_user_or_api_key, require_admin, require_admin_or_api_key
from services import analyst_reports as svc
from services.utils import sanitize

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/analyst-reports", tags=["analyst-reports"])

_KST = ZoneInfo("Asia/Seoul")


class PointMetric(BaseModel):
    """포인트 핵심 지표 칩(한눈 구조화, task#218) — value는 표시용 문자열("383.2조원"·"8.8배")."""
    label: str = Field(..., min_length=1, max_length=40)
    value: str = Field(..., min_length=1, max_length=40)
    # 증감%(선택) — 프론트가 up/down 색. Optional 필수: pydantic v2는 validate_default=False라
    # 키 생략은 통과하지만 명시적 null은 타입 검증을 타서, float이면 발행 전체가 422로 죽는다(task#250).
    change_pct: Optional[float] = Field(None, allow_inf_nan=False)

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
    data = svc.build_data_block(snapshot_data or {}, snapshot_date)
    published_date = datetime.now(_KST).date().isoformat()
    # 컨센서스 근거 박제(task#260) — 집계는 data.consensus에 additive, 증권사 행은 consensus_detail로.
    snap_mean = data["consensus"].get("target_mean")
    snap_dist = {k: data["consensus"].get(k) for k in ("buy", "hold", "sell")}
    basis = svc.consensus_basis(upper)
    if basis:
        data["consensus"].update(basis["consensus"])
        if snap_mean is not None:
            data["consensus"]["target_mean"] = snap_mean   # 스냅샷 값 우선(mart 평균은 null 보충용)
        if any(snap_dist.values()):
            data["consensus"].update(snap_dist)   # 분포도 스냅샷 우선 — 전부 0/None일 때만 mart 보충
        data["consensus_detail"] = basis["consensus_detail"]
    else:
        # read 실패·미커버로 basis가 None이면, save_report의 `data = EXCLUDED.data` **전체 치환**이
        # 이미 박제돼 있던 근거를 지운다(발행은 201, 경고는 서버 로그에만 — BH7-M1). ADR-0027이
        # "잘못된 판은 새 판 발행으로 덮는다"로 같은 날 재발행을 정정 수단으로 규정하므로 우연이 아니다.
        # ⚠️ 보존은 **같은 (ticker, published_date) 행**에서만 한다 — 새 발행일에 read가 실패했다면
        #    근거는 없는 게 맞고(wrong < missing), 과거 판의 근거를 실으면 stale 날짜 귀속이 된다.
        # 이 read도 발행을 막아선 안 된다 — consensus_basis가 read 실패를 None으로 삼키는 것과
        # 같은 계약이다(보존은 최선노력이지 발행의 전제조건이 아니다).
        try:
            prior_data = (svc.get_report(upper, published_date) or {}).get("data") or {}
        except Exception as e:
            logger.warning(f"[AnalystReport] {upper} 직전 판 근거 보존 생략(read 실패): {e}")
            prior_data = {}
        if prior_data.get("consensus_detail"):
            data["consensus_detail"] = prior_data["consensus_detail"]
            for k, v in (prior_data.get("consensus") or {}).items():
                if data["consensus"].get(k) is None:
                    data["consensus"][k] = v
    # base_date의 역할은 "옆에 표시되는 target_mean의 기준일" **하나**다(BH7-L2). 스냅샷 값을
    # 채택했으면 캡션 날짜도 스냅샷 날짜여야 한다 — mart 날짜가 남으면 캡션이 그 숫자의 기준일이 아니다.
    if snap_mean is not None:
        data["consensus"]["base_date"] = snapshot_date
    data = sanitize(data)
    svc.save_report(
        upper, published_date, body.rating, body.title,
        body.fair_value_low, body.fair_value_high, body.valuation_method,
        [p.model_dump() for p in body.points], body.risks, data,
    )
    logger.info(f"[AnalystReport] 발행 ({upper} {published_date}): rating={body.rating}")
    return {"ok": True, "ticker": upper, "published_date": published_date}


@router.get("")
def list_all(_: str = Depends(get_current_user_or_api_key)):
    """발행물 목록 — **종목당 최신 1건**(요약, 최신순).

    목록의 정체성 = "그 종목에 대한 현재 판단"(ADR-0027 개정, task#222). 과거 판은
    GET /{ticker}(전 판)로 문서 상세에서 이동. API key 허용 — 루틴의 발행 가드레일
    판단 재료(task#213)이며, 최신 1건이 그 7일 판단에 정확한 형태다."""
    return sanitize({"reports": svc.list_reports()})


@router.delete("/{ticker}")
def delete_by_ticker(ticker: str, _: str = Depends(require_admin)):
    """그 종목의 발행물 전 판 삭제 (admin 세션 전용 — 루틴/API key 제외, ADR-0027 개정).

    발행물은 불변이지만 오발행·대상 해제 종목 정리 수단이 필요하다. 판 단위 삭제는
    만들지 않는다(잘못된 판 하나는 새 판 발행으로 덮는다)."""
    upper = ticker.upper()
    deleted = svc.delete_reports(upper)
    if deleted == 0:
        raise HTTPException(status_code=404, detail=f"{upper} 발행물 없음")
    logger.info(f"[AnalystReport] 삭제 ({upper}): {deleted}판")
    return {"ok": True, "ticker": upper, "deleted": deleted}


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

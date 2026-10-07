"""애널리스트 리포트 발행·조회 API (ADR-0027, task#211).

신규 prefix /api/analyst-reports — 기존 /api/report의 catch-all GET /{ticker}/{date_str}
오인 라우팅 회피(ADR-0027 근거). 발행은 Cowork(admin/API key), 열람은 로그인 사용자 전체.
"""
import logging
from datetime import date, datetime
from typing import Annotated, Dict, List, Literal, Optional, Union
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, ConfigDict, Discriminator, Field, Tag, field_validator, model_validator

from auth import get_current_user_or_api_key, require_admin, require_admin_or_api_key
from services import analyst_lenses as lens_calc
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
    # v1 형식 — format 키는 없거나 1. `"2"`(문자열)·3 같은 값이 v1 오류 목록에 묻히지 않고 format 오류로 드러나게.
    format: Optional[Literal[1]] = None
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


# ── v2: 구조 축·9렌즈 틀 (ADR 261006-232406, task#368) ─────────────────────
# v1(위 PublishBody)은 루틴 프롬프트가 v2로 바뀌는 task#369 전까지 그대로 받는다 — `format: 2`가 가른다.
# 선택 필드는 전부 Optional[...] = Field(None) — 명시적 null이 발행 전체를 422로 막지 않게(task#250·ADR-0034 보정 ③).

class RawInput(BaseModel):
    """공시에서 옮겨 적은 원자료 하나 — 계산은 서버가 한다(ADR 261006-232406 결정 3)."""
    value: float = Field(..., allow_inf_nan=False)
    unit: str = Field(..., min_length=1, max_length=20)
    source: Literal["disclosure", "estimate"]
    ref: str = Field(..., min_length=1, max_length=200)      # 출처·기준일
    rationale: Optional[str] = Field(None, max_length=300)   # estimate면 필수

    @model_validator(mode="after")
    def _estimate_needs_rationale(self):
        if self.source == "estimate" and not (self.rationale or "").strip():
            raise ValueError("source=estimate면 rationale(추정 근거)가 필수")
        return self


class SensitivityAxis(BaseModel):
    # 모델 단위 가드 — values 배열 원소까지 NaN/Infinity 422(test_nan_input_guards가 이 형태를 감지한다)
    model_config = ConfigDict(allow_inf_nan=False)

    label: str = Field(..., min_length=1, max_length=40)
    values: List[float] = Field(..., min_length=3, max_length=3)
    unit: str = Field(..., min_length=1, max_length=20)
    source: Literal["disclosure", "estimate"]
    ref: str = Field(..., min_length=1, max_length=200)
    rationale: Optional[str] = Field(None, max_length=300)

    @model_validator(mode="after")
    def _estimate_needs_rationale(self):
        if self.source == "estimate" and not (self.rationale or "").strip():
            raise ValueError("source=estimate면 rationale(추정 근거)가 필수")
        return self


class Sensitivity(BaseModel):
    exogenous: SensitivityAxis    # 외생 변수(금리·원자재 가격) 3단계 — 표의 행
    endogenous: SensitivityAxis   # 내생 변수(잔고·판매량) 3단계 — 표의 열


class JudgmentGauge(BaseModel):
    """판단 렌즈의 수치형 바뀜 조건(사람 UAT 피드백 2) — 루틴이 정한 경계. 서버는 계산하지 않고 검증만 한다.

    zones[i]는 boundaries[i-1]~boundaries[i] 구간의 신호(낮은 값 → 높은 값). 계산 렌즈의 서버 게이지와 같은 모양."""
    model_config = ConfigDict(allow_inf_nan=False)

    variable: str = Field(..., min_length=1, max_length=40)
    unit: str = Field(..., min_length=1, max_length=20)
    current: float
    current_ref: str = Field(..., min_length=1, max_length=200)   # 현재값의 출처·기준일
    # 세 색 모두(사람 UAT 피드백 3) — 경계 2개·구간 3개, 색은 단조(낮은 값이 나쁘거나 좋거나)
    boundaries: List[float] = Field(..., min_length=2, max_length=2)
    zones: List[Literal["go", "wait", "stop"]] = Field(..., min_length=3, max_length=3)

    @model_validator(mode="after")
    def _shape(self):
        if self.boundaries != sorted(self.boundaries) or len(set(self.boundaries)) != len(self.boundaries):
            raise ValueError("gauge.boundaries는 서로 다른 값의 오름차순")
        if self.zones not in (["stop", "wait", "go"], ["go", "wait", "stop"]):
            raise ValueError("gauge.zones는 [stop, wait, go] 또는 [go, wait, stop] — 세 색이 단조로 한 번씩")
        return self

    def zone_of_current(self) -> str:
        return self.zones[sum(1 for b in self.boundaries if self.current >= b)]


class FlipCondition(BaseModel):
    """판단 렌즈의 비수치형 바뀜 조건 — 「이 조건(들)이면 이 색」. 렌즈마다 세 색 정확히 하나씩
    (게이지의 세 구간과 같은 레벨 — 사람 UAT 피드백 3). 지금 색의 항목은 현재 상태를 말한다."""
    model_config = ConfigDict(extra="forbid")   # 옛 키 `to`를 조용히 무시하지 않는다

    color: Literal["go", "wait", "stop"]
    when: List[Annotated[str, Field(min_length=1, max_length=80)]] = Field(..., min_length=1, max_length=4)
    match: Literal["all", "any"] = "all"


class AxisChoice(BaseModel):
    rationale: str = Field(..., min_length=1, max_length=300)


class RevenueEngine(AxisChoice):
    value: Literal["usage", "volume", "price_exogenous", "balance_rate", "transaction"]


class CostNature(AxisChoice):
    value: Literal["fixed", "revenue_linked"]


class FundingSource(AxisChoice):
    value: Literal["equity", "deposit", "debt"]


class Structure(BaseModel):
    revenue_engine: RevenueEngine
    cost_nature: CostNature
    funding_source: FundingSource


class LensIn(BaseModel):
    id: int = Field(..., ge=1, le=9)
    summary: str = Field(..., min_length=1, max_length=200)
    body: str = Field(..., min_length=1)
    metrics: Optional[List[PointMetric]] = Field(None, max_length=4)
    signal: Optional[Literal["go", "wait", "stop", "na"]] = None   # 판단 렌즈만 — 계산 렌즈는 서버가 켠다
    flip: Optional[str] = Field(None, max_length=200)              # 판단 렌즈만
    na_reason: Optional[str] = Field(None, max_length=200)
    inputs: Optional[Dict[str, RawInput]] = None                   # 계산 렌즈만
    gauge: Optional[JudgmentGauge] = None                          # 판단 렌즈 — 바뀜 조건이 수치로 나오면
    conditions: Optional[List[FlipCondition]] = Field(None, min_length=3, max_length=3)  # 판단 렌즈 — 수치가 아니면(세 색 하나씩)
    sensitivity: Optional[Sensitivity] = None                      # 렌즈 8 · 외생 가격형 수익 엔진만

    @model_validator(mode="after")
    def _lens_kind_rules(self):
        if self.id in lens_calc.COMPUTED_LENSES:
            # 두 출처를 만들지 않는다 — 무시가 아니라 거부(계산 렌즈의 신호·바뀜 조건은 서버 정본)
            if self.signal is not None or self.flip is not None:
                raise ValueError(f"렌즈 {self.id}는 계산 렌즈 — signal·flip은 서버가 채운다(보내지 말 것)")
            if self.na_reason and (self.inputs or self.sensitivity):
                raise ValueError(f"렌즈 {self.id}: na_reason과 inputs를 함께 보낼 수 없다")
            if not self.na_reason and not self.inputs:
                raise ValueError(f"렌즈 {self.id}: inputs(원자료) 또는 na_reason이 필요")
            if self.sensitivity is not None and self.id != 8:
                raise ValueError("sensitivity는 렌즈 8에만")
            if self.gauge is not None or self.conditions is not None:
                raise ValueError(f"렌즈 {self.id}는 계산 렌즈 — 바뀜 조건 게이지는 서버가 그린다(gauge·conditions 보내지 말 것)")
        else:
            if self.inputs is not None or self.sensitivity is not None:
                raise ValueError(f"렌즈 {self.id}는 판단 렌즈 — inputs·sensitivity 없음")
            if self.signal is None:
                raise ValueError(f"렌즈 {self.id}: signal 필수")
            if self.signal == "na" and not (self.na_reason or "").strip():
                raise ValueError(f"렌즈 {self.id}: signal=na면 na_reason 필수")
            if self.signal != "na" and not (self.flip or "").strip():
                raise ValueError(f"렌즈 {self.id}: 바뀜 조건(flip) 필수")
            # 바뀜 조건 구조화(사람 UAT 피드백 2): 수치로 나오면 gauge, 아니면 conditions — 정확히 하나
            if self.signal == "na":
                if self.gauge is not None or self.conditions is not None:
                    raise ValueError(f"렌즈 {self.id}: signal=na면 gauge·conditions 없음")
            else:
                if (self.gauge is None) == (self.conditions is None):
                    raise ValueError(f"렌즈 {self.id}: 바뀜 조건은 gauge(수치형) 또는 conditions(비수치형) 중 정확히 하나")
                if self.gauge is not None and self.gauge.zone_of_current() != self.signal:
                    raise ValueError(f"렌즈 {self.id}: gauge 현재값 {self.gauge.current}의 구간 "
                                     f"'{self.gauge.zone_of_current()}'이 signal '{self.signal}'과 다르다")
                if self.conditions is not None and sorted(c.color for c in self.conditions) != ["go", "stop", "wait"]:
                    raise ValueError(f"렌즈 {self.id}: conditions는 초록·노랑·빨강 각 정확히 하나")
        return self


class LensPublishBody(BaseModel):
    format: Literal[2]
    title: str = Field(..., min_length=1, max_length=120)   # 한줄 논지
    structure: Structure
    lenses: List[LensIn] = Field(..., min_length=9, max_length=9)

    @model_validator(mode="after")
    def _lens_set_and_inputs(self):
        ids = sorted(l.id for l in self.lenses)
        if ids != list(range(1, 10)):
            raise ValueError(f"lenses는 id 1~9가 정확히 한 번씩이어야 한다(받은 id: {ids})")
        axes = {"revenue_engine": self.structure.revenue_engine.value,
                "cost_nature": self.structure.cost_nature.value,
                "funding_source": self.structure.funding_source.value}
        for l in self.lenses:
            if l.id not in lens_calc.COMPUTED_LENSES or l.na_reason:
                continue
            variant = lens_calc.variant_for(l.id, axes)
            required = lens_calc.required_inputs(l.id, variant)
            optional = lens_calc.OPTIONAL_SPEC.get(l.id, {})
            given = set(l.inputs)
            missing = set(required) - given
            unknown = given - set(required) - set(optional)
            if missing:
                raise ValueError(f"렌즈 {l.id}({variant}): 원자료 누락 {sorted(missing)} — 없으면 na_reason")
            if unknown:
                raise ValueError(f"렌즈 {l.id}({variant}): 알 수 없는 원자료 {sorted(unknown)}")
            kinds = {**required, **optional}
            money_units = {l.inputs[k].unit for k in given if kinds[k] == "money"}
            if len(money_units) > 1:
                raise ValueError(f"렌즈 {l.id}: 금액 원자료의 단위가 섞임 {sorted(money_units)}")
            bad_pct = [k for k in given if kinds[k] == "pct" and l.inputs[k].unit != "%"]
            if bad_pct:
                raise ValueError(f"렌즈 {l.id}: 비율 원자료는 단위 '%' {sorted(bad_pct)}")
            if l.id == 8:
                if l.inputs["forward_earnings"].unit not in lens_calc.UNIT_SCALE:
                    raise ValueError(f"렌즈 8: forward_earnings 단위는 {sorted(lens_calc.UNIT_SCALE)} 중 하나")
                if variant == "balance_rate" and l.sensitivity is not None:
                    if l.sensitivity.exogenous.unit != "%":
                        raise ValueError("렌즈 8 balance_rate: 외생 축(금리) 단위는 '%'")
                    if l.sensitivity.endogenous.unit not in money_units:
                        raise ValueError("렌즈 8 balance_rate: 내생 축(잔고) 단위는 금액 원자료 단위와 같아야 한다")
                if (variant in lens_calc.TABLE_ENGINES) != (l.sensitivity is not None):
                    raise ValueError("렌즈 8: 민감도 표(sensitivity)는 수익 엔진이 "
                                     f"{lens_calc.TABLE_ENGINES}일 때만, 그리고 그때는 필수")
        return self


def _publish_kind(v) -> str:
    fmt = v.get("format") if isinstance(v, dict) else getattr(v, "format", None)
    return "v2" if fmt == 2 else "v1"


AnyPublishBody = Annotated[
    Union[Annotated[PublishBody, Tag("v1")], Annotated[LensPublishBody, Tag("v2")]],
    Discriminator(_publish_kind),
]


@router.post("/{ticker}", status_code=201)
def publish_report(ticker: str, body: AnyPublishBody, _: str = Depends(require_admin_or_api_key)):
    """발행 — 판단 필드는 요청 본문, 데이터 블록은 서버가 최신 스냅샷에서 자동 첨부.

    `format: 2`(구조 축·9렌즈)면 렌즈 3·4·5·8의 계산·신호·바뀜 조건도 서버가 박제한다.
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
    if isinstance(body, LensPublishBody):
        b = body.model_dump()
        l8 = next(l for l in b["lenses"] if l["id"] == 8)
        if l8.get("inputs"):
            unit = l8["inputs"]["forward_earnings"]["unit"]
            expect = "KRW" if (snapshot_data or {}).get("market") == "KR" else "USD"
            if lens_calc.UNIT_SCALE[unit][0] != expect:
                raise HTTPException(status_code=422, detail=(
                    f"렌즈 8 forward_earnings 통화({unit})가 종목 시장 통화({expect})와 다름"))
            if expect == "KRW" and "risk_free_pct" not in l8["inputs"]:
                # 서버 캐시의 무위험 금리는 미 10년물 — KR 종목에 쓰면 틀린 비교가 된다
                raise HTTPException(status_code=422, detail="KR 종목의 렌즈 8은 risk_free_pct(국고채) 원자료 필수")
        lens_report = sanitize(lens_calc.build_lens_report(b["structure"], b["lenses"], snapshot_data or {}))
        svc.save_lens_report(ticker=upper, published_date=published_date, title=body.title,
                             data=data, lens_report=lens_report)
        logger.info(f"[AnalystReport] v2 발행 ({upper} {published_date}): tally={lens_report['tally']}")
        return {"ok": True, "ticker": upper, "published_date": published_date, "format": 2}
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

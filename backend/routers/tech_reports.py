"""선도기술 리포트 발행·조회 API (ADR-0033, task#276 S2).

기술 단위 발행물 — analyst_reports.py(ADR-0027)와 동형 인증 게이팅. 발행은
require_admin_or_api_key(루틴), 조회 3종은 get_current_user_or_api_key
(ADR-0029 — 무인증 read 없음).
"""
from datetime import date
from typing import List, Literal, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field, field_validator, model_validator

from auth import get_current_user_or_api_key, require_admin_or_api_key
from services import tech_reports as svc
from services.utils import sanitize

router = APIRouter(prefix="/api/tech-reports", tags=["tech-reports"])

# TECH_TOPICS가 slug의 정본(ADR-0033 결정 2) — Literal로 묶어 오타/미등록 slug를
# pydantic 검증 단계(핸들러 진입 전)에서 422로 막는다.
_SLUGS = tuple(t["slug"] for t in svc.TECH_TOPICS)
SlugPath = Literal[_SLUGS]


class MoneyValue(BaseModel):
    # allow_inf_nan=False: raw JSON body의 NaN/Infinity 토큰이 json.loads·NaN 비교(항상 False)를
    # 모두 통과해 불변 문서에 오염 저장되는 것을 422로 차단(task#211).
    value: float = Field(..., allow_inf_nan=False)
    currency: Literal["USD", "KRW"]
    unit: Literal["mn", "bn", "tn"]


class YearPoint(BaseModel):
    year: int
    size: MoneyValue


class MarketEstimate(BaseModel):
    """시장규모 추정치 발행 기관별 1건. 렌더러가 환산하지 않으므로(ADR-0033 결정 3) 배열 내
    currency/unit/year는 전부 동일해야 한다 — 단위 혼합은 막대 길이를 1000배 틀리게 하고,
    연도 혼합은 「최대·최소 N배」 비교를 무의미하게 만든다(Market._estimates_consistency)."""
    institution: str = Field(..., min_length=1, max_length=40)
    year: int
    size: MoneyValue
    scope: Optional[str] = Field(None, max_length=40)  # 집계 범위 차이 표시 문자열
    is_basis: Optional[bool] = Field(None)  # 성장 곡선이 채택한 기관(최대 1개)


class Source(BaseModel):
    title: str = Field(..., min_length=1)
    url: Optional[str] = Field(None)


class Related(BaseModel):
    prerequisites: List[str] = []
    derivatives: List[str] = []
    complements: List[str] = []
    competitors: List[str] = []


class Market(BaseModel):
    history: List[YearPoint] = []
    forecast: List[YearPoint] = []
    cagr_pct: Optional[float] = Field(None, allow_inf_nan=False)
    share_basis: Optional[str] = Field(None)
    as_of: str
    # 기관별 시장규모 추정치(선택·additive, task#282). Optional[List] = Field(None) 필수 —
    # List[X] = Field([])로 두면 루틴이 보낸 명시적 null 하나가 발행 전체를 422로 막는다(task#250).
    estimates: Optional[List[MarketEstimate]] = Field(None, max_length=6)

    @model_validator(mode="after")
    def _estimates_consistency(self):
        """estimates 배열 내 currency/unit/year 동일성 + is_basis 최대 1개.
        원소가 1개 이하면 집합 크기가 애초에 1 이하라 검증이 자연히 통과한다."""
        if not self.estimates:
            return self
        if len({e.size.currency for e in self.estimates}) > 1:
            raise ValueError("estimates의 currency는 전부 동일해야 합니다")
        if len({e.size.unit for e in self.estimates}) > 1:
            raise ValueError("estimates의 unit은 전부 동일해야 합니다")
        if len({e.year for e in self.estimates}) > 1:
            raise ValueError("estimates의 year는 전부 동일해야 합니다")
        if sum(1 for e in self.estimates if e.is_basis is True) > 1:
            raise ValueError("estimates의 is_basis=True는 최대 1개여야 합니다")
        return self


class Player(BaseModel):
    name: str
    country: str
    state_led: bool
    ticker: Optional[str] = Field(None)
    tech_level: int = Field(..., ge=1, le=5)
    gap_years: Optional[int] = Field(None)
    leader_name: Optional[str] = Field(None)
    share_pct: Optional[float] = Field(None, allow_inf_nan=False)
    note: Optional[str] = Field(None)
    # 계보 분류(선택) — 노형 계열 등 기술별 묶음. 기술마다 분류 체계가 다르므로 자유 문자열이고,
    # 전무하면 프론트가 섹션째 생략한다(로봇·배터리엔 "노형" 개념이 없다).
    category: Optional[str] = Field(None)


class PointMetric(BaseModel):
    """핵심 포인트의 지표 칩 — value는 **표시용 문자열**("1.1조원"·"22%").

    ADR-0033 결정 3이 기각한 "표시용 문자열로 받기"는 *그래프를 그리는 수치*(시장규모) 이야기다.
    요약 칩은 애초에 그릴 대상이 아니므로 경계 안에 있다 — 그래프를 그리는 수치는 여전히
    구조 데이터(MoneyValue·Milestone.year·tech_level)로만 받는다.
    """
    label: str = Field(..., min_length=1, max_length=40)
    value: str = Field(..., min_length=1, max_length=40)
    # 증감%(선택) — 프론트가 up/down 색. Optional 필수: pydantic v2는 validate_default=False라
    # 키 생략은 통과하지만 명시적 null은 타입 검증을 타서, float이면 발행 전체가 422로 죽는다(task#250).
    change_pct: Optional[float] = Field(None, allow_inf_nan=False)


class KeyPoint(BaseModel):
    """핵심 포인트 카드 — 애널리스트 리포트 points[] 미러(task#218 한눈 구조화)."""
    title: str = Field(..., min_length=1)
    body: str = Field(..., min_length=1)
    metrics: Optional[List[PointMetric]] = Field(None, max_length=4)


class Milestone(BaseModel):
    """진척 타임라인 항목. status는 추상 3단계 — 기술마다 구체 단계명이 다르므로(로봇엔 "착공"이
    없다) 구체 내용은 event 자유 문자열이 담고, 색·마커는 이 enum이 결정론적으로 정한다."""
    year: int
    actor: Optional[str] = Field(None)
    event: str = Field(..., min_length=1)
    status: Literal["done", "in_progress", "planned"]


class Difficulty(BaseModel):
    score: int = Field(..., ge=1, le=5)
    rationale: str = Field(..., min_length=1)


class Challenge(BaseModel):
    title: str
    body: str


class TechReportIn(BaseModel):
    published_date: str
    title: str
    description: str = ""
    difficulty: Difficulty
    players: List[Player] = []
    challenges: List[Challenge] = []
    related: Related = Related()
    market: Market
    sources: List[Source] = Field(..., min_length=1)
    # 요약 레이어(선택·additive, task#281) — 루틴이 못 채우면 프론트가 섹션째 생략한다.
    # Optional 필수: 루틴이 "없음"을 명시적 null로 표현해도 발행 전체가 422로 죽지 않아야 한다.
    key_points: Optional[List[KeyPoint]] = Field(None)
    milestones: Optional[List[Milestone]] = Field(None)

    @field_validator("published_date")
    @classmethod
    def _iso_date_only(cls, v: str) -> str:
        """ISO(YYYY-MM-DD)만 허용. plain str로 두면 psycopg2가 DATE 컬럼에 바인딩할 때
        서버 DateStyle(기본 MDY)이 "03/08/2026"을 8월 3일로 해석해 **불변 발행물에
        잘못된 날짜가 조용히 저장**된다(wrong < missing 위반). 조회 경로(get_detail)가
        이미 쓰는 가드를 입력에도 대칭으로 둔다."""
        try:
            date.fromisoformat(v)
        except ValueError:
            raise ValueError("published_date는 ISO 형식(YYYY-MM-DD)이어야 합니다")
        return v

    @model_validator(mode="after")
    def _share_pct_requires_basis(self):
        """어느 업체든 share_pct를 실으면 market.share_basis(무엇 기준인지)가 있어야
        그 수치가 해석 가능하다(ADR-0033 결정 3)."""
        if any(p.share_pct is not None for p in self.players) and self.market.share_basis is None:
            raise ValueError("share_pct가 있으면 market.share_basis가 필요합니다")
        return self


@router.post("/{slug}", status_code=201)
def publish_report(slug: SlugPath, body: TechReportIn, _: str = Depends(require_admin_or_api_key)):
    """발행 — 같은 (slug, published_date) 재발행은 upsert(그날 판 교체)."""
    svc.save_report(slug, body.model_dump())
    return {"ok": True, "slug": slug, "published_date": body.published_date}


@router.get("")
def list_all(_: str = Depends(get_current_user_or_api_key)):
    """목록 — 기술당 최신 1건."""
    return sanitize({"reports": svc.latest_all()})


@router.get("/{slug}")
def list_by_slug(slug: SlugPath, _: str = Depends(get_current_user_or_api_key)):
    """그 기술의 전 판(최신순, 문서 상세 이력 네비게이션용)."""
    return sanitize({"slug": slug, "reports": svc.list_by_slug(slug)})


@router.get("/{slug}/{published_date}")
def get_detail(slug: SlugPath, published_date: str, _: str = Depends(get_current_user_or_api_key)):
    """발행물 단건."""
    try:
        date.fromisoformat(published_date)  # 비정상 date 문자열의 DB 캐스트 500 방지
    except ValueError:
        raise HTTPException(status_code=404, detail="발행물 없음")
    report = svc.get_report(slug, published_date)
    if report is None:
        raise HTTPException(status_code=404, detail="발행물 없음")
    return sanitize(report)

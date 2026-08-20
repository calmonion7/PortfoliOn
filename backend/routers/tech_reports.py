"""주요기술 리포트 발행·조회 API (ADR-0033, 개명·저장모델 개정 ADR-0038).

기술 단위 발행물 — analyst_reports.py(ADR-0027)와 동형 인증 게이팅. 발행은
require_admin_or_api_key(루틴), 조회 2종은 get_current_user_or_api_key
(ADR-0029 — 무인증 read 없음).
"""
import logging
import math
from datetime import date
from typing import List, Literal, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field, field_validator, model_validator

from auth import get_current_user_or_api_key, require_admin_or_api_key
from services import tech_reports as svc
from services.utils import sanitize

logger = logging.getLogger(__name__)

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


class VariantOption(BaseModel):
    """계보 비교축의 선택지 1개 — "경수형"·"추진 수직착륙"·"황화물계" 등."""
    name: str = Field(..., min_length=1, max_length=40)
    examples: Optional[List[str]] = Field(None, max_length=6)  # 표시 문자열 — "중국 ACP100 125MWe"
    strength: Optional[str] = Field(None, max_length=120)  # 이점 1문장
    tradeoff: Optional[str] = Field(None, max_length=120)  # 대가 1문장

    @model_validator(mode="after")
    def _has_comparison_content(self):
        """이점·대가 중 **최소 하나**는 있어야 한다(적대 리뷰 렌즈1 #2).
        둘 다 결측이면 2of2의 2열 비교표에서 그 행이 이름만 남아 「비교가 아니라 서술」이 되는데,
        그건 axis의 min_length=2가 축 수준에서 막으려던 바로 그 상태다(같은 의도를 행 수준으로 내림).
        **둘 다 요구하지는 않는다** — 루틴이 한쪽만 아는 계열이 실제로 있고, 그때 발행 전체를 422로
        막는 것은 대가가 이득보다 크다(프롬프트는 여전히 "쌍으로"를 지시한다)."""
        if self.strength is None and self.tradeoff is None:
            raise ValueError("variants 옵션은 strength·tradeoff 중 최소 하나가 필요합니다")
        return self


class VariantAxis(BaseModel):
    """계보 비교축 1개 — "노형"·"회수 방식"·"고체 전해질 계열" 등. 선택지가 1개면 비교가 아니라
    서술이므로 min_length=2(루틴 프롬프트가 "2개 미만이면 필드를 생략하고 산문에 써라"를 지시)."""
    axis_label: str = Field(..., min_length=1, max_length=30)
    options: List[VariantOption] = Field(..., min_length=2, max_length=6)

    @model_validator(mode="after")
    def _option_names_unique(self):
        """한 축 안에서 계열명은 유일해야 한다(적대 리뷰 렌즈1 #1).
        중복이면 2of2 비교표에 같은 이름의 행이 두 번 나와 독자가 서로 다른 두 계열로 읽는다.
        형제 `Market._estimates_consistency`(is_basis 중복 방어)와 같은 성질의 검증이다."""
        names = [o.name for o in self.options]
        if len(set(names)) != len(names):
            raise ValueError("variants 축의 options name은 서로 달라야 합니다")
        return self


class WatchItem(BaseModel):
    """관찰 체크리스트 항목 — 진척 판단의 구체적 관측 대상."""
    label: str = Field(..., min_length=1, max_length=60)
    detail: Optional[str] = Field(None, max_length=200)
    not_signal: Optional[str] = Field(None, max_length=200)  # "이건 진척 신호가 아니다"


class MineralProducer(BaseModel):
    """광물 축의 채굴·정제 업체 — `players[]`와 **별개 목록**이고 [[기술 성숙 단계]]가 없다.

    간펑리튬·앨버말은 그 기술의 참여자가 아니라 원료 공급사이고, 광산기업에 1~5 성숙 단계란
    의미가 없다(ADR-0042 결정 4). 이름·국가·티커(선택)·생산 점유율만 싣는다.
    """
    name: str = Field(..., min_length=1, max_length=40)
    country: str = Field(..., min_length=1, max_length=30)
    ticker: Optional[str] = Field(None)
    share_pct: Optional[float] = Field(None, allow_inf_nan=False, ge=0, le=100)


class CompositionItem(BaseModel):
    """지분 축 항목의 공통 3필드 — 이름·지분·근거.

    `share_pct`는 **5의 배수만**(ADR-0042 결정 3): 이 수치는 출처가 없는 판단값이라 37%처럼
    설명할 수 없는 정밀도를 허용하면 허위정밀이 된다. 20단계면 정보량은 유지된다.
    근거 1문장은 필수 — ADR-0033이 "출처 필수"로 지킨 자리를 이 축에서는 판단 근거가 지킨다.

    ⚠️ 5% 그리드는 **축 항목의 share_pct에만** 적용한다. `MineralProducer.share_pct`·
    `MineralItem.top_source_pct`는 USGS류 *출처 있는* 외부 사실이라 그리드를 강제하면
    정확한 값(브라질 88%)을 반올림해 오히려 정직성을 깎는다(task#305 판단).
    """
    name: str = Field(..., min_length=1, max_length=40)
    share_pct: float = Field(..., allow_inf_nan=False, ge=0, le=100)
    rationale: str = Field(..., min_length=1, max_length=200)

    @field_validator("share_pct")
    @classmethod
    def _five_pct_grid(cls, v: float) -> float:
        # 비유한값을 명시적으로 먼저 배제한다 — allow_inf_nan=False가 이미 막지만, 이 가드가
        # 없으면 `round(inf)`가 **OverflowError**를 던지고 pydantic이 그건 안 잡아 422가 아니라
        # **500**이 된다(`round(nan)`은 ValueError라 우연히 422가 된다 — 두 비유한값의 운명이
        # 갈리는 것 자체가 이 경로를 암묵 의존으로 두면 안 되는 이유다, CLAUDE.md B52).
        if not math.isfinite(v):
            raise ValueError("share_pct는 유한한 수여야 합니다")
        # float 나눗셈 오차를 허용치로 흡수 — 35.0/5=7.0은 정확하지만 입력 표현에 기대지 않는다.
        if abs(v / 5.0 - round(v / 5.0)) > 1e-9:
            raise ValueError(f"share_pct는 5의 배수여야 합니다(받은 값 {v})")
        return v

    @field_validator("rationale")
    @classmethod
    def _rationale_not_blank(cls, v: str) -> str:
        """min_length=1은 공백 한 칸을 통과시킨다 — 근거는 실제 문장이어야 한다."""
        if not v.strip():
            raise ValueError("항목의 근거(rationale)는 비어있을 수 없습니다")
        return v


class TechItem(CompositionItem):
    """필요기술 축 — 남은 난제 총량이 자. leaders는 이름만 싣고 기술수준·점유율·티커는
    화면이 `players[]`에서 끌어온다(ADR-0042 결정 4). 참조 실재는 TechReportIn이 검증한다."""
    leaders: Optional[List[str]] = Field(None, max_length=6)


class MineralItem(CompositionItem):
    """핵심 광물 축 — 원재료비가 자."""
    top_source_country: Optional[str] = Field(None, max_length=30)
    top_source_pct: Optional[float] = Field(None, allow_inf_nan=False, ge=0, le=100)
    used_in: Optional[List[str]] = Field(None, max_length=6)  # 이 광물이 쓰이는 필요기술 이름
    producers: Optional[List[MineralProducer]] = Field(None, max_length=6)


class ExpertItem(CompositionItem):
    """전문가 축 — 인력 병목 총량이 자. **업체를 붙이지 않는다**(ADR-0042 결정 4):
    붙이면 기술 축의 선도기업과 중복되거나 대학·규제기관이 섞여 축이 무너진다."""


class Composition(BaseModel):
    """기술 해부 — 자가 서로 다른 [[지분 축]] 3개(ADR-0042).

    세 축은 분모가 달라 **합쳐서 하나로 읽으면 안 된다**. 각 축은 독립적으로 Σ=100이고,
    항목 3~7개(2개면 분해가 아니고 8개를 넘으면 각 %가 더 지어낸 값이 된다).
    루틴이 모르는 축은 **통째로 생략**한다(부분 발행 가능) — 그래서 세 축이 전부 Optional이다.
    """
    tech: Optional[List[TechItem]] = Field(None, min_length=3, max_length=7)
    minerals: Optional[List[MineralItem]] = Field(None, min_length=3, max_length=7)
    experts: Optional[List[ExpertItem]] = Field(None, min_length=3, max_length=7)
    # 광물 점유의 기준 문구 — *그 광물 세계 생산* 기준이라 market.share_basis(그 기술 시장의
    # 점유)와 자가 다르다. 그래서 별도 필드로 둔다(ADR-0042 결정 4).
    minerals_share_basis: Optional[str] = Field(None, min_length=1, max_length=60)

    @model_validator(mode="after")
    def _at_least_one_axis(self):
        """빈 객체 금지 — 「해부 없음」의 표현은 null 하나여야 한다.
        {}를 허용하면 2/2의 빈 상태 분기가 null과 {} 두 형태를 각각 다뤄야 한다."""
        if not (self.tech or self.minerals or self.experts):
            raise ValueError("composition은 최소 한 축(tech·minerals·experts)을 담아야 합니다")
        return self

    @model_validator(mode="after")
    def _axes_sum_to_100(self):
        """축마다 Σ=100 정확히 — 안 걸면 이건 지분이 아니라 떠다니는 점수다(ADR-0042 결정 3).
        잔여분은 숨기지 않고 「기타」 항목으로 명시한다."""
        for label, items in (("tech", self.tech), ("minerals", self.minerals),
                             ("experts", self.experts)):
            if not items:
                continue
            total = sum(i.share_pct for i in items)
            if abs(total - 100.0) > 1e-9:
                raise ValueError(
                    f"composition.{label}의 share_pct 합이 정확히 100이어야 합니다(받은 합 {total:g})")
        return self

    @model_validator(mode="after")
    def _item_names_unique(self):
        """한 축 안에서 항목명은 유일해야 한다 (형제 `VariantAxis._option_names_unique`와 동형).

        중복이면 화면이 같은 이름의 행을 두 번 그려 독자가 서로 다른 둘로 읽는다 — task#297이
        `variants`에서 HIGH로 잡은 바로 그 클래스인데, `composition`을 만들 때 그 형제의
        validator 목록을 전부 열거하지 않아 짝을 빠뜨렸다(task#306 자체 검토가 포착).
        부수로 2/2 렌더러가 `key={item.name}`을 쓰므로 중복은 React key 충돌도 만든다.
        """
        for label, items in (("tech", self.tech), ("minerals", self.minerals),
                             ("experts", self.experts)):
            if not items:
                continue
            names = [i.name for i in items]
            if len(set(names)) != len(names):
                dup = sorted({n for n in names if names.count(n) > 1})
                raise ValueError(f"composition.{label}의 항목 name은 서로 달라야 합니다: {', '.join(dup)}")
        return self

    @model_validator(mode="after")
    def _producer_share_requires_basis(self):
        """어느 producer든 점유율을 실으면 기준 문구가 있어야 그 수치가 해석 가능하다
        (TechReportIn._share_pct_requires_basis와 동형)."""
        if any(p.share_pct is not None
               for m in (self.minerals or []) for p in (m.producers or [])):
            if not (self.minerals_share_basis or "").strip():
                raise ValueError("producers[].share_pct가 있으면 minerals_share_basis가 필요합니다")
        return self


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
    # 계보 비교축·관찰 체크리스트(선택·additive, task#297). Optional 필수(task#250 함정) —
    # 루틴이 "없음"을 명시적 null로 표현해도 발행 전체가 422로 죽지 않아야 한다.
    variants: Optional[List[VariantAxis]] = Field(None, max_length=2)
    watch_items: Optional[List[WatchItem]] = Field(None, max_length=5)
    # 기술 해부 3축(선택·additive, task#305). Optional 필수(task#250 함정) — 루틴이 "없음"을
    # 명시적 null로 표현해도 발행 전체가 422로 죽지 않아야 한다. 검증 실패는 리포트 발행
    # **전체**를 막으므로(ADR-0042 결과) 실제로 비정합한 것만 건다.
    composition: Optional[Composition] = Field(None)

    @field_validator("published_date")
    @classmethod
    def _iso_date_only(cls, v: str) -> str:
        """ISO(YYYY-MM-DD)만 허용. plain str로 두면 psycopg2가 DATE 컬럼에 바인딩할 때
        서버 DateStyle(기본 MDY)이 "03/08/2026"을 8월 3일로 해석해 **불변 발행물에
        잘못된 날짜가 조용히 저장**된다(wrong < missing 위반)."""
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

    @model_validator(mode="after")
    def _variant_axis_labels_unique(self):
        """축 라벨은 서로 달라야 한다(적대 리뷰 렌즈1 #1). 상한이 2축이라 중복은 곧 "같은 축을
        두 번 그린다"는 뜻이고, 2of2는 축마다 표 1개 + 소제목 1개를 렌더하므로 같은 제목의 표가
        나란히 두 개 뜬다. 원소가 1개 이하면 집합 크기가 1 이하라 자연히 통과한다
        (형제 `Market._estimates_consistency`와 같은 관례)."""
        if not self.variants:
            return self
        labels = [a.axis_label for a in self.variants]
        if len(set(labels)) != len(labels):
            raise ValueError("variants의 axis_label은 서로 달라야 합니다")
        return self

    @model_validator(mode="after")
    def _composition_leaders_exist_in_players(self):
        """composition.tech[].leaders는 전부 players[].name에 실재해야 한다(ADR-0042 결정 4).

        화면이 이름으로 조인해 기술수준·점유율을 끌어오므로, 없는 이름은 조용히 결측된 칩이 된다.
        문자열 일치로 대충 이어붙이지 않고 발행 시점에 422로 막는다(ADR-0034가 is_basis 추론을
        금지한 것과 같은 성질). 이 검증은 axis 단위가 아니라 **발행 단위**여야 성립한다 —
        Composition만으로는 players[]를 볼 수 없다.
        """
        if not self.composition or not self.composition.tech:
            return self
        known = {p.name for p in self.players}
        missing = sorted({n for item in self.composition.tech
                          for n in (item.leaders or []) if n not in known})
        if missing:
            raise ValueError(
                "composition.tech[].leaders에 players에 없는 이름이 있습니다: " + ", ".join(missing))
        return self

    @model_validator(mode="after")
    def _minerals_used_in_exist_in_tech(self):
        """composition.minerals[].used_in은 전부 composition.tech[].name에 실재해야 한다.

        형제 `_composition_leaders_exist_in_players`와 같은 dangling-reference 클래스인데,
        이쪽은 **같은 composition 안의 상호참조**라 요청 본문만으로 닫힌다(ADR-0042 결정 1의
        참조 원자성). 끊긴 이름은 해부 화면이 그 문서에 없는 필요기술을 광물의 「쓰임」으로
        적는다(`TechAnatomy.jsx::MineralMeta`는 조인 없이 텍스트로 렌더하므로 결측 칩이 아니라
        **없는 이름을 사실처럼 적은 문구**가 된다).

        ⚠️ **tech 축이 없으면 검증을 생략한다.** 광물 축만 실은 부분 발행이 합법이고
        (Composition의 세 축 전부 Optional), 참조 대상 집합 자체가 없으면 「없는 이름」이라
        판정할 근거가 없다 — 여기서 422를 내면 광물만 아는 판의 발행 전체가 막힌다.
        라이브 7종엔 그런 판이 0건이라(task#313 S0) 이 분기는 픽스처로만 덮인다.
        생략이 위험해지는 경우(직전 판엔 tech가 있었는데 이번 판이 광물만 싣는 재발행)는
        `_reject_dropped_axes`가 축 소실 단계에서 먼저 422로 막는다(적대검토 #2·#15).

        ⚠️ **이 검증은 요청 본문만 본다.** composition이 보존되는 경로에서는 실행되지 않으므로,
        이 축을 앞으로 조여도 **이미 저장된 행에는 도달하지 않는다** — 저장 blob 전체를
        현재 스키마로 재검증하는 것은 별개 수단이 필요하다(적대검토 #11, 후속 후보로 남긴다:
        「보존 blob의 `Composition` 재검증」. 지금 넣으면 미측정 라이브 행이 422로 굳어
        그 기술의 발행이 무기한 동결될 수 있다).
        """
        if not self.composition or not self.composition.tech:
            return self
        known = {i.name for i in self.composition.tech}
        missing = sorted({n for m in (self.composition.minerals or [])
                          for n in (m.used_in or []) if n not in known})
        if missing:
            raise ValueError(
                "composition.minerals[].used_in에 composition.tech에 없는 이름이 있습니다: "
                + ", ".join(missing))
        return self


_AXES = ("tech", "minerals", "experts")


def _stored_composition(slug: str) -> dict:
    """직전 판의 composition(없으면 빈 dict). 발행은 admin·루틴 전용 저빈도 경로라
    요청당 SELECT 1회는 감당한다 — 두 게이트가 이 한 번의 read를 공유한다."""
    rows = svc.get_by_slug(slug)
    return (rows[0].get("composition") if rows else None) or {}


def _reject_dangling_preserved_leaders(stored: dict, body: TechReportIn) -> None:
    """보존될 직전 판 composition의 leaders를 **새** players[]로 재검증한다(task#313 S2).

    S1의 「키 생략 = 보존」이 참조자(옛 composition)와 피참조자(새 players)를 **시점 분리**시켜,
    ADR-0042 결정 1이 전용 엔드포인트에 대해 예고한 dangling 경로를 단일 엔드포인트 안에서
    열어 버린다. 그래서 보존이 일어나는 그 요청에서 바로 대조한다 — 통과시키면 화면이
    존재하지 않는 업체 칩을 그리고, 조용히 제거하면 데이터가 소리 없이 줄어든다.

    ⚠️ 메시지는 **되싣기를 먼저** 제시한다. 삭제 안내를 앞세우면 201을 최적화하는 루틴에게
    가장 값싼 탈출구가 「해부 삭제」가 되어, 이 게이트가 지키려던 3축을 그 자리에서 지운다
    (적대검토 #5·#8). 발동 사실은 `logger.warning`으로 남긴다 — 이 경로는 job_runs를 타지
    않아 로그가 유일한 사후 관측 수단이다(루틴 로그는 끝난 뒤에만 읽힌다, task#300).
    """
    known = {p.name for p in body.players}
    missing = sorted({n for item in (stored.get("tech") or [])
                      for n in (item.get("leaders") or []) if n not in known})
    if missing:
        logger.warning("[TechReport] 보존분 leaders 끊김으로 발행 거부 (missing=%s)", missing)
        raise HTTPException(
            status_code=422,
            detail="composition을 생략하면 직전 판이 보존되는데, 그 composition.tech[].leaders가 "
                   "새 players[]에 없습니다: " + ", ".join(missing)
                   + " — GET /api/tech-reports/{slug}의 composition을 이 요청에 그대로 다시 실어"
                     " 주세요(또는 그 업체를 players[]에 유지하세요)."
                     ' 해부를 지우려는 것이면 "composition": null.',
        )


def _reject_dropped_axes(stored: dict, comp: Composition) -> None:
    """새 composition이 직전 판의 축을 **말없이** 빼면 422(적대검토 #1·#14).

    보존 입도는 **컬럼 단위**다 — `composition`을 실으면 그 컬럼이 통째 치환되므로, 루틴이
    프롬프트 §3의 「모르는 축은 통째로 생략하라」를 따라 광물만 실은 재발행 하나가 직전 판의
    tech·experts 두 축(각 3~7항목의 share_pct+rationale 판단값)을 경고 없이 지운다. 그 경로엔
    게이트가 하나도 없었다(leaders·used_in 검증은 tech가 None이라 skip). 그래서 필드 수준의
    계약을 축 수준으로 내린다: **축 생략 = 유지 요구(422) / 명시적 null = 삭제 허용**.

    축 단위 자동 병합은 하지 않는다 — 「조용히 합쳐진다」는 이 저장소가 기각한 형태다
    (ADR-0034가 is_basis 추론을 금지한 것과 같은 성질).
    """
    dropped = [a for a in _AXES
               if stored.get(a) and not getattr(comp, a) and a not in comp.model_fields_set]
    if dropped:
        logger.warning("[TechReport] 축 소실로 발행 거부 (dropped=%s)", dropped)
        raise HTTPException(
            status_code=422,
            detail="composition을 실으면 그 컬럼이 통째 치환되므로 직전 판의 축이 사라집니다: "
                   + ", ".join(dropped)
                   + " — 그 축을 이 요청에 함께 다시 실어 주세요(GET /api/tech-reports/{slug}의"
                     " composition을 그대로 복사해도 됩니다)."
                     ' 정말 지우려는 것이면 그 축에 명시적 null을 실으세요(예 "tech": null).',
        )


@router.post("/{slug}", status_code=201)
def publish_report(slug: SlugPath, body: TechReportIn, _: str = Depends(require_admin_or_api_key)):
    """발행 — slug당 1행 upsert(ADR-0038). 선택 5필드는 **키 생략 = 보존 / 명시적 null = 삭제**.

    `model_fields_set`은 명시적 null도 포함하므로 그 케이스는 `omitted`에 들지 않고 컬럼이
    SET에 남아 NULL이 저장된다(= 삭제) — 계약이 여기서 분기 없이 성립한다(task#313).
    필드 목록은 `svc._PRESERVABLE`이 정본이다(여기 다시 적으면 dual-source가 된다).

    ⚠️ `published_date`·`created_at`은 **항상** 갱신되지만 보존분은 그대로다 — 그래서 행은
    여러 발행 시점의 모자이크가 되고 화면의 「YYYY-MM-DD 갱신」은 *본문* 갱신일이다
    (적대검토 #4·#9·#17). 응답 `preserved`가 그 사실의 유일한 관측 수단이다(필드별 vintage는
    ADR-0038의 slug당 1행 아래선 저장할 자리가 없다 — 알고도 미룬 한계로 기록).
    """
    omitted = frozenset(svc._PRESERVABLE) - body.model_fields_set
    if "composition" in omitted:                       # 보존 경로 — 옛 참조 ↔ 새 players
        _reject_dangling_preserved_leaders(_stored_composition(slug), body)
    elif body.composition is not None:                 # 치환 경로 — 축 소실
        _reject_dropped_axes(_stored_composition(slug), body.composition)
    svc.save_report(slug, body.model_dump(), omitted=omitted)
    return {"ok": True, "slug": slug, "published_date": body.published_date,
            "preserved": sorted(omitted)}


@router.get("")
def list_all(_: str = Depends(get_current_user_or_api_key)):
    """목록 — 기술당 최신 1건."""
    return sanitize({"reports": svc.latest_all()})


@router.get("/index")
def ticker_index(_: str = Depends(get_current_user_or_api_key)):
    """종목 → 기술 역방향 연결용 **경량 인덱스**(ADR-0043).

    ⚠️ 이 경로는 **반드시 `/{slug}`보다 먼저 선언**돼야 한다. `SlugPath`가 `Literal`이라
    `/{slug}`가 먼저 잡으면 "index"는 허용 slug이 아니어서 **422로 죽고** 이 핸들러까지
    오지도 못한다 — 다른 라우트로 흘러가는 것이 아니라 그 자리에서 실패한다(이 저장소의
    `GET /{ticker}/backlog`가 catch-all에 가려 500 나던 것과 같은 계열). 라우트 순서
    회귀 테스트(`test_tech_reports_index.py`)가 이 순서를 못박는다.

    **산문을 싣지 않는다** — 소비처(포트폴리오 노출 카드·종목 상세 칩)는 티커 교차만
    필요한데 6종 전문을 실으면 화면이 수백 KB를 받는다. `description`·`key_points`·
    `challenges`·`players` 본문은 전부 제외하고 티커 집합과 개수만 준다.

    `name`은 `TECH_TOPICS`의 표시명이다. 리포트 `title`은 150자짜리 헤드라인 문장이라
    칩 라벨로 못 쓰고, 프론트 `techReportUtils.js`의 `TECH_NAMES` 미러를 새 소비처가
    또 참조하면 dual-source 노출만 넓어지므로 여기서 직접 준다.
    """
    names = {t["slug"]: t["name"] for t in svc.TECH_TOPICS}
    out = []
    for r in svc.latest_all():
        players = r.get("players") or []
        # ticker 없는 업체(비상장·미매칭)는 집합에서 빠지지만 players_total에는 남는다 —
        # 그 차이가 곧 화면의 「미매칭 N개 제외」 부기다.
        tickers = sorted({p["ticker"] for p in players if p.get("ticker")})
        out.append({
            "slug": r["slug"],
            "name": names.get(r["slug"], r["slug"]),
            "title": r.get("title") or "",
            "tickers": tickers,
            "players_total": len(players),
        })
    return sanitize({"index": out})


@router.get("/{slug}")
def list_by_slug(slug: SlugPath, _: str = Depends(get_current_user_or_api_key)):
    """그 기술의 현재 판 1건(없으면 빈 배열)."""
    return sanitize({"slug": slug, "reports": svc.get_by_slug(slug)})

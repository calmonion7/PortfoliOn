"""드리프트 가드 — 라우터 BaseModel의 모든 float 필드가 NaN/Infinity를 거부하는지 열거·단언한다.

배경(task#211·#250, CLAUDE.md 가토): raw JSON 본문의 `NaN`/`Infinity` 토큰은
① `json.loads`가 허용하고 ② pydantic v2 float 필드가 기본 `allow_inf_nan=True`라 통과시키고
③ 범위 검증(`low <= high` 등)은 NaN에서 항상 False라 안 걸린다 — 그래서 입력은 통과하고
"불변이어야 할 문서"에 NaN이 조용히 저장된 뒤 나중에 응답 직렬화(`allow_nan=False`)에서
500이 나거나, 그보다 먼저 오염된 값 자체가 저장된다. `Field(gt=0)` 같은 부수 제약은 NaN은
막아도(NaN > 0 은 항상 False) **Infinity는 막지 못한다**(inf > 0 은 True) — 실측 확인,
`PromotePayload.quantity`가 그 예다. 그래서 이 테스트가 요구하는 가드는 오직 명시적
`allow_inf_nan=False`(모델 `ConfigDict` 또는 필드 `Field(...)`) 하나뿐이다.

왜 전역 JSON 경계 거부(커스텀 `route_class`)가 아니라 모델별 가드 + 이 드리프트 테스트인가:
전역 방식은 반경이 앱의 *모든* 엔드포인트(비-float 바디도 포함)이고, 거부 여부를 판정하려면
본문을 라우팅 전에 한 번 더 파싱해야 해 이중 파싱 비용이 생긴다. 그 비용 없이 같은 안전성을
얻으려고 "새 float 필드는 반드시 가드된 채로 추가된다"를 모델별 `Field(allow_inf_nan=False)`
관례로 두고, 이 테스트가 그 관례의 위반(드리프트)을 잡는 대가로 존재한다.
"""
import importlib
import pkgutil
from typing import get_args

from pydantic import BaseModel

import routers as routers_pkg

# 이 축의 정의역: routers 패키지의 각 모듈이 "자기 자신에" 정의한 BaseModel 서브클래스의
# 필드뿐이다. portfolio.set_rebalance_targets(weights: Dict[str, Optional[float]] = Body(...))
# 처럼 요청 바디가 BaseModel이 아니라 bare Body(...) 파라미터인 표면은 모델 열거에
# 원리적으로 잡히지 않는다(조건부 스킵이 아니라 이 축 자체가 다루지 않는 영역) — 그 표면의
# NaN 거부 행동 검증은 S2의 라우터 행동 테스트(client 기반 422 핀)가 맡는다.


def _annotation_has_float(annotation) -> bool:
    """annotation이 float를 어떤 깊이로든 포함하는지(Optional[float]·List[float] 등).

    `get_args`로 Union/List 등 제네릭만 내려간다 — 중첩 BaseModel(예: Market 필드)의
    *내부* 필드까지 파고들지 않는다. 그 모델이 routers 모듈에 직접 정의돼 있으면
    `_iter_own_models`가 별도 클래스로 이미 열거하므로 이중 처리가 아니라 분업이다.
    """
    if annotation is float:
        return True
    return any(_annotation_has_float(a) for a in get_args(annotation))


def _iter_own_models():
    """routers 패키지의 각 모듈을 walk해, 그 모듈이 *자기 자신에 정의한* BaseModel
    서브클래스만 yield한다(다른 모듈에서 import돼 네임스페이스에 노출된 것은
    `cls.__module__ == module.__name__` 비교로 제외)."""
    for modinfo in pkgutil.iter_modules(routers_pkg.__path__, prefix=f"{routers_pkg.__name__}."):
        module = importlib.import_module(modinfo.name)
        for obj in vars(module).values():
            if (
                isinstance(obj, type)
                and issubclass(obj, BaseModel)
                and obj is not BaseModel
                and obj.__module__ == module.__name__
            ):
                yield module.__name__, obj


def _iter_float_fields():
    """(모듈명, 모델클래스, 필드명, FieldInfo) — float를 포함하는 필드 전수."""
    seen = set()
    for modname, cls in _iter_own_models():
        if cls in seen:
            continue
        seen.add(cls)
        for fname, finfo in cls.model_fields.items():
            if _annotation_has_float(finfo.annotation):
                yield modname, cls, fname, finfo


def _is_guarded(cls, finfo) -> bool:
    """모델 `ConfigDict(allow_inf_nan=False)` 또는 필드 `Field(..., allow_inf_nan=False)` 중
    하나로 가드됐는가. 필드쪽은 타입이 아니라 속성으로 판별한다(`_PydanticGeneralMetadata`는
    준-사설 클래스라 pydantic 버전에 따라 바뀔 수 있음 — CLAUDE.md 배지색 가토와 같은 원칙)."""
    if cls.model_config.get("allow_inf_nan") is False:
        return True
    return any(getattr(m, "allow_inf_nan", None) is False for m in (finfo.metadata or []))


def test_router_float_field_enumeration_sentinel():
    """표본 부재를 FAIL로 — 열거 로직이 조용히 깨져 0건이 되면 아래 본 테스트가 공허하게
    통과(ALL PASS인데 아무것도 안 본 것)하는 것을 막는다. 하한만 건다(정확일치는 정당한
    모델 추가에 거짓 FAIL). 착수 시 실측: 모델 7개 · float 필드 12개."""
    float_fields = list(_iter_float_fields())
    models_with_float = {cls for _, cls, _, _ in float_fields}
    assert len(models_with_float) >= 5, (
        f"float 필드를 가진 라우터 모델이 {len(models_with_float)}개뿐(≥5 기대) — "
        "열거 로직이 깨졌을 수 있다(routers 패키지 walk 또는 float 판별 확인)"
    )
    assert len(float_fields) >= 10, (
        f"float 필드가 {len(float_fields)}개뿐(≥10 기대) — 열거 로직 확인"
    )


def test_router_float_fields_reject_nan_and_infinity():
    """routers 패키지의 모든 BaseModel float 필드는 allow_inf_nan=False로 가드돼야 한다.

    ⚠️ S2(portfolio.py/watchlist.py에 가드 추가) 적용 *전*에는 아래 6건이 무가드로 FAIL한다
    (정통 TDD red-first — 이 슬라이스의 정상 종료 상태). S2 이후 이 테스트가 green이 된다:
    portfolio.Stock.quantity, portfolio.Stock.avg_cost, portfolio.Stock.target_price,
    portfolio.Stock.stop_price, watchlist.PromotePayload.quantity,
    watchlist.PromotePayload.avg_cost.
    """
    unguarded = [
        f"{modname}.{cls.__name__}.{fname}"
        for modname, cls, fname, finfo in _iter_float_fields()
        if not _is_guarded(cls, finfo)
    ]
    assert not unguarded, (
        "다음 라우터 모델 필드가 allow_inf_nan=False로 가드되지 않았다 — raw JSON 본문의 "
        "NaN/Infinity 토큰이 pydantic 검증을 통과해 저장/응답 단계에서 오염되거나 500을 낼 "
        "수 있다. 처방: 해당 필드에 `Field(..., allow_inf_nan=False)`를 달 것 "
        "(Optional 필드는 `Field(None, allow_inf_nan=False)`).\n미가드 필드:\n"
        + "\n".join(f"  - {f}" for f in unguarded)
    )

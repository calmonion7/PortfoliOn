"""market_outlook 스키마 검증 (B53).

결함: `market_outlook`이 `Optional[Any]`라 검증이 0이었다. 루틴이 프롬프트 예시(문자열
템플릿)를 보고 **산문 문자열**을 보내면 그대로 저장되고, 프론트
(`MarketOutlookSection`)는 문자열에서 아무 필드도 못 읽어 "시장 전망" 섹션을 **통째로
조용히 생략**한다 — 크래시도 422도 없어 루틴이 같은 실수를 반복했다(라이브 실측:
124종 중 5종(UNH·RPRX·TSLA·PLUG·QS)이 산문 문자열로 저장돼 있다).

이 파일이 지키는 2축:
  ⓐ 산문 문자열 → 422 (스키마 이전엔 통과했다)
  ⓑ 대조군 — 올바른 객체는 계속 통과하고, **라이브 저장값의 실제 형태**도 통과한다
     (Cowork enrich 쓰기 경로라 좁은 검증은 기존에 성공하던 발행을 막는다)
"""
import json

import pytest
from fastapi import FastAPI
from fastapi.encoders import jsonable_encoder
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from fastapi.testclient import TestClient
from unittest.mock import patch

from routers.stocks import router
from auth import get_current_user, get_current_user_or_api_key, require_admin_or_api_key
from services.utils import sanitize


app = FastAPI()
app.include_router(router)


# main.py::_validation_error_handler와 동일 — 없으면 비유한값 거부가 **500**이 된다.
# 422 detail이 요청의 NaN/Infinity를 그대로 echo하고 starlette JSONResponse는
# allow_nan=False라 직렬화에서 터지기 때문이다(task#211). 즉 이 경로의 "422"는 필드
# 검증만으로 성립하지 않고 **앱 전역 핸들러가 load-bearing**이다 — 자체-app 테스트가
# 그것을 빠뜨리면 프로덕션과 다른 결과를 잰다.
@app.exception_handler(RequestValidationError)
async def _validation_error_handler(request, exc):
    return JSONResponse(status_code=422, content={"detail": sanitize(jsonable_encoder(exc.errors()))})

app.dependency_overrides[get_current_user] = lambda: "test-user-id"
app.dependency_overrides[get_current_user_or_api_key] = lambda: "test-user-id"
app.dependency_overrides[require_admin_or_api_key] = lambda: "test-user-id"
client = TestClient(app)


def put_single(payload):
    with patch("routers.stocks.storage.enrich_stock", return_value=True) as m:
        resp = client.put("/api/stocks/LLY/enrich", json=payload)
    return resp, m


def put_batch(payload):
    with patch("routers.stocks.storage.enrich_stock", return_value=True) as m:
        resp = client.put("/api/stocks/enrich/batch", json=payload)
    return resp, m


# ── ⓐ 산문 문자열 거부 ────────────────────────────────────────────────────────

# 프롬프트 예시(scripts/cowork-routine-prompt.md)가 문자열 템플릿이던 시절 루틴이
# 실제로 보낸 형태. 라이브 5종이 이 모양으로 저장돼 있다.
PROSE = (
    "글로벌 HBM 시장은 AI 서버 수요로 고성장 중이며 당사는 점유율 2위다. "
    "사업부문별로는 메모리가 매출의 대부분을 차지한다."
)


def test_prose_string_is_rejected():
    """산문 문자열 → 422. 스키마 이전(Optional[Any])엔 200으로 통과해 조용히 저장됐다."""
    resp, m = put_single({"market_outlook": PROSE})
    assert resp.status_code == 422, resp.text
    m.assert_not_called()  # 422는 아무것도 쓰지 않는다


def test_prose_string_is_rejected_in_batch():
    """배치 레인도 같은 모델을 쓴다(두 모델에 각각 필드가 선언돼 있어 한쪽만 고치기 쉽다)."""
    resp, m = put_batch([{"ticker": "LLY", "market_outlook": PROSE}])
    assert resp.status_code == 422, resp.text
    m.assert_not_called()


def test_prose_string_rejection_names_the_field():
    """422 본문이 어느 필드인지 말해야 루틴이 고칠 수 있다(피드백 없는 거부는 반복을 못 막는다)."""
    resp, _ = put_single({"market_outlook": PROSE})
    assert "market_outlook" in resp.text


@pytest.mark.parametrize("bad", [123, 4.5, True, ["a", "b"], "", "짧은 산문"])
def test_non_object_scalars_and_arrays_are_rejected(bad):
    resp, _ = put_single({"market_outlook": bad})
    assert resp.status_code == 422, f"{bad!r} → {resp.status_code}"


# ── ⓑ 대조군 1 — 정본 예시가 계속 통과한다 ────────────────────────────────────

# CLAUDE_COWORK_API.md의 market_outlook 예시(전 필드 채움 + segments 2개).
SPEC_EXAMPLE = {
    "market_name": "글로벌 비만치료제 시장",
    "size_current": {"value": 24, "unit": "십억달러", "year": 2025},
    "size_forecast": {"value": 100, "unit": "십억달러", "year": 2030},
    "cagr_pct": 33.0,
    "company_share_pct": 55.0,
    "position": "1위",
    "sources": ["Goldman Sachs Research (2026-02)", "회사 IR 발표자료"],
    "one_liner": "비만치료제 시장은 연 33% 고성장 중이며 당사가 점유율 1위",
    "segments": [
        {"name": "당뇨치료제", "period": "2025", "revenue_share_pct": 62.0,
         "prev_period": "2024", "prev_revenue_share_pct": 68.0,
         "market": {"size": 55, "unit": "십억달러", "year": 2025,
                    "size_forecast": 80, "forecast_year": 2030, "cagr_pct": 7.8},
         "share_pct": 40.0, "sources": ["IQVIA (2026-01)"]},
        {"name": "비만치료제", "period": "2025", "revenue_share_pct": 38.0,
         "prev_period": "2024", "prev_revenue_share_pct": 32.0,
         "market": {"size": 24, "unit": "십억달러", "year": 2025,
                    "size_forecast": 100, "forecast_year": 2030, "cagr_pct": 33.0},
         "share_pct": 55.0, "share_pct_forecast": 60.0,
         "note": "경구용 치료제 승인 이후 처방 확대 국면",
         "sources": ["Goldman Sachs Research (2026-02)"]},
    ],
}


def test_spec_example_object_is_accepted():
    resp, m = put_single({"market_outlook": SPEC_EXAMPLE})
    assert resp.status_code == 200, resp.text
    saved = m.call_args[0][1]["market_outlook"]
    assert saved["market_name"] == "글로벌 비만치료제 시장"
    assert [s["name"] for s in saved["segments"]] == ["당뇨치료제", "비만치료제"]
    assert saved["segments"][0]["market"]["cagr_pct"] == 7.8


def test_spec_example_object_is_accepted_in_batch():
    resp, m = put_batch([{"ticker": "LLY", "market_outlook": SPEC_EXAMPLE}])
    assert resp.status_code == 200, resp.text
    assert m.call_args[0][1]["market_outlook"]["cagr_pct"] == 33.0


# ── ⓑ 대조군 2 — 라이브 저장값의 실제 형태가 전부 통과한다 ────────────────────
#
# 라이브 124종(dict 119)을 새 모델에 전수 대입해 통과를 확인했고, 그중 **naive한
# 스키마라면 422가 됐을 형태**만 여기 박제한다(괄호 안은 라이브 관측 건수).
# 이 표본이 곧 "검증이 너무 좁지 않다"의 증언이므로, 스키마를 조일 때 이 목록을 먼저 볼 것.
#
# ⚠️ 단 하나의 예외가 있다 — **별칭 오타 키**(revenue_pct·change_pct 등 6종)는 이 표본에
# 실재하지만 통과 대상이 아니다. 그 키들은 정본 필드명이 아니고 프론트가 하나도 읽지 않아,
# 통과시키면 그 부문의 비중 막대가 **조용히 사라진다**(=이 파일이 닫는 결함과 같은 클래스).
# 그래서 아래 통과 축은 `_canonicalized()`로 그 6종만 걷어낸 판을 쓰고, 원본은 거부 축에서
# 422임을 잰다. **그 6종 밖의 미지 키는 여전히 통과·보존된다.**
LIVE_SHAPES = {
    # 스키마 밖 최상위 키 text(11건)·share_basis(1건) — extra="ignore"면 조용히 버려진다
    "MCO(text·share_basis·value null·segments 확장키)": {
        "text": "시장은 등급(발행 연동)과 리스크 애널리틱스(구독)의 두 축으로 나뉜다.",
        "sources": ["Moody's 2025년 4분기·연간 실적 발표(2026-02-18)"],
        "cagr_pct": None,
        "position": "등급 시장 복점(무디스 약 40%)",
        "segments": [
            {"name": "Moody's Investors Service", "note": "2025년 매출 41억달러", "period": "2025",
             "market_share_pct": 40.0, "revenue_share_pct": 53.1, "revenue_share_change_pp": 0.0},
            {"name": "Moody's Analytics", "period": "2025",
             "revenue_share_pct": 46.6, "revenue_share_change_pp": 0.0},
        ],
        "one_liner": "등급 시장은 빅3가 약 95%로 규제·평판 장벽에 막힌 복점이다.",
        "market_name": "신용평가·리스크 애널리틱스 시장",
        "share_basis": "미국 신용등급 시장 점유율 추정치(빅3 합계 약 95%)",
        # size_current.value=None (12건) — value를 필수로 두면 여기서 막힌다
        "size_current": {"unit": "USD", "year": 2026, "value": None},
        "size_forecast": {"unit": "USD", "year": 2032, "value": None},
        "company_share_pct": 40.0,
    },
    # segments가 정본 필드명이 아닌 revenue_pct(46건)를 쓴다 + size_current/forecast unit 불일치
    # ("대(현재 운항 기재)" vs "대(운항 기재)" — 라이브 5건). unit 동일성 검증은 그래서 넣지 않았다.
    "BA(revenue_pct·unit 불일치)": {
        "text": "수요 측 전망은 견고하다.",
        "sources": ["Boeing Commercial Market Outlook 2026(2026-07-17)"],
        "cagr_pct": None,
        "position": "에어버스와의 복점 중 한 축",
        "segments": [
            {"name": "Commercial Airplanes", "period": "2025", "revenue_pct": 46.4},
            {"name": "Defense, Space & Security", "period": "2025", "revenue_pct": 30.4},
            {"name": "Global Services", "period": "2025", "revenue_pct": 23.2},
        ],
        "one_liner": "실적을 가르는 변수는 시장 규모가 아니라 월 생산율이다.",
        "market_name": "글로벌 민항기 신규 인도 시장(20년 누적)",
        "size_current": {"unit": "대(현재 운항 기재)", "year": 2026, "value": 29000},
        "size_forecast": {"unit": "대(운항 기재)", "year": 2045, "value": 50000},
    },
    # segments의 change_pct(24건) — 정본에 없는 키, 프론트도 안 읽는다. 그래도 버리지 않는다.
    "NVO(change_pct)": {
        "sources": ["Novo Nordisk, 2026년 반기 실적 발표(2026-08-04/05)"],
        "cagr_pct": 12.4,
        "position": "2위",
        "segments": [
            {"name": "Diabetes care", "note": "Awiqli가 이 축의 방어 수단이다.",
             "period": "2025", "change_pct": -4.1, "revenue_share_pct": 67.0},
            {"name": "Obesity care", "period": "2025", "change_pct": 4.1, "revenue_share_pct": 26.6},
            {"name": "Rare disease", "period": "2025", "change_pct": -0.1, "revenue_share_pct": 6.3},
        ],
        "one_liner": "연 12.4% 성장하는 GLP-1 시장에서 점유율 39.4%로 2위",
        "market_name": "글로벌 GLP-1 수용체 작용제(비만·당뇨) 시장",
        "size_current": {"unit": "십억 달러", "year": 2026, "value": 82},
        "size_forecast": {"unit": "십억 달러", "year": 2033, "value": 185.3},
        "company_share_pct": 39.4,
    },
    # position=None(3건)·company_share_pct=None(88건)·size_forecast 자체 부재
    "GOOG(명시적 null·size_forecast 부재)": {
        "sources": ["GroupM 2026 Global Ad Forecast"],
        "cagr_pct": None,
        "position": "1위",
        "segments": [
            {"name": "Google Services", "period": "2025", "revenue_share_pct": 85.1},
            {"name": "Google Cloud", "period": "2025", "revenue_share_pct": 14.6},
            {"name": "Other Bets", "period": "2025", "revenue_share_pct": 0.4},
        ],
        "one_liner": "검색을 앞세운 알파벳이 최대 수혜 사업자다.",
        "market_name": "글로벌 디지털 광고 시장",
        "size_current": {"unit": "십억USD", "year": 2026, "value": 835.82},
        "company_share_pct": None,
    },
    # sources 전무(1건) — 정본은 "값 포함 시 필수"라 적지만 스키마로 강제하면 이 형태가 막힌다
    "LEU(sources 전무·text만)": {
        "text": "probe",
        "segments": [{"name": "LEU", "period": "2025", "revenue_share_pct": 77.2}],
    },
}


# 위 표본 중 **별칭 오타 키**를 담은 것은 그 키만 걷어내고 대조군으로 쓴다.
# 별칭은 정본 필드명이 아니고 `segmentUtils.js`가 하나도 읽지 않으므로 통과시키면 그 부문의
# 비중 막대가 조용히 사라진다(=B53의 증상) → 스키마가 거부하는 쪽으로 정했고, 그 거부는
# 아래 test_live_shapes_with_alias_keys_are_rejected가 따로 잰다.
# ⚠️ 여기서 걷어내는 것은 **아는 오타 6종뿐**이다 — 나머지 미지 키(`text`·`share_basis` 등)는
# 그대로 두고, 그것들이 여전히 200으로 통과·보존되는지가 이 두 테스트의 축이다.
_ALIAS_KEYS = ("revenue_pct", "market_share_pct", "change_pct", "revenue_pct_change",
               "revenue_share_change_pp", "revenue_share_change_pct")

_SHAPES_WITH_ALIASES = sorted(
    label for label, shape in LIVE_SHAPES.items()
    if any(k in seg for seg in (shape.get("segments") or []) for k in _ALIAS_KEYS)
)


def _canonicalized(shape):
    """라이브 형태에서 **별칭 오타 키만** 제거한 판(다른 키는 손대지 않는다)."""
    out = dict(shape)
    if out.get("segments"):
        out["segments"] = [{k: v for k, v in seg.items() if k not in _ALIAS_KEYS}
                           for seg in out["segments"]]
    return out


def test_alias_bearing_live_shapes_are_actually_in_the_sample():
    """이 파일이 별칭을 담은 라이브 표본을 실제로 갖고 있는지 — 표본이 비면 아래 두
    테스트(거부 축)와 _canonicalized(통과 축)가 **둘 다 공허하게** 통과한다."""
    assert _SHAPES_WITH_ALIASES, "별칭 키를 담은 라이브 표본이 없다 — 거부 축이 무의미해진다"


@pytest.mark.parametrize("label", sorted(LIVE_SHAPES))
def test_live_stored_shapes_still_pass(label):
    """라이브에 실재하는 형태(별칭 오타만 정본명으로 정리) → 계속 200.
    하나라도 422면 스키마가 너무 좁다는 뜻이다."""
    resp, m = put_single({"market_outlook": _canonicalized(LIVE_SHAPES[label])})
    assert resp.status_code == 200, f"{label}: {resp.text}"
    assert m.call_count == 1


@pytest.mark.parametrize("label", sorted(LIVE_SHAPES))
def test_live_stored_shapes_keep_unknown_keys(label):
    """스키마 밖 키를 조용히 버리지 않는다 — extra='ignore'(pydantic 기본)면 데이터 손실이다."""
    src = _canonicalized(LIVE_SHAPES[label])
    resp, m = put_single({"market_outlook": src})
    assert resp.status_code == 200
    saved = m.call_args[0][1]["market_outlook"]
    for key in ("text", "share_basis"):
        if key in src:
            assert saved.get(key) == src[key], f"{label}: {key} 소실"


def test_unknown_segment_keys_are_still_preserved():
    """별칭 거부가 `extra="allow"`를 통째로 닫은 것이 아님을 못박는다 — **아는 오타만** 막고
    처음 보는 키는 계속 보존한다(정본이 나중에 필드를 늘릴 때 값이 먼저 도착할 수 있다)."""
    seg = {"name": "메모리", "period": "2025", "revenue_share_pct": 60.0,
           "segment_note_source": "사업보고서 III-1"}
    resp, m = put_single({"market_outlook": {"segments": [seg]}})
    assert resp.status_code == 200, resp.text
    assert m.call_args[0][1]["market_outlook"]["segments"][0]["segment_note_source"] == "사업보고서 III-1"


# ── ⓑ' 별칭 오타 거부 (B53 잔여분 — 같은 결함 클래스) ──────────────────────────
#
# `extra="allow"`가 미지 키를 통과시키는데 프론트(`segmentUtils.js`)는 이 6종을 하나도 읽지
# 않는다 → 그 부문은 이름·기간만 뜨고 비중 막대가 안 그려진다(크래시도 422도 없다).
# 라이브 102부문 실측: revenue_pct 46 · change_pct 24 · revenue_pct_change 12 ·
# revenue_share_change_pp 2 · revenue_share_change_pct 2 · market_share_pct 1.

@pytest.mark.parametrize("label", _SHAPES_WITH_ALIASES)
def test_live_shapes_with_alias_keys_are_rejected(label):
    """별칭을 담은 원본 라이브 형태는 이제 422다 — 조용한 미렌더보다 거부가 낫다."""
    resp, m = put_single({"market_outlook": LIVE_SHAPES[label]})
    assert resp.status_code == 422, f"{label}: {resp.status_code}"
    m.assert_not_called()


@pytest.mark.parametrize("alias,canonical", [
    ("revenue_pct", "revenue_share_pct"),
    ("market_share_pct", "share_pct"),
    ("change_pct", "prev_revenue_share_pct"),
    ("revenue_pct_change", "prev_revenue_share_pct"),
    ("revenue_share_change_pp", "prev_revenue_share_pct"),
    ("revenue_share_change_pct", "prev_revenue_share_pct"),
])
def test_each_known_alias_is_rejected_and_names_the_canonical_field(alias, canonical):
    """422 본문이 **정본 필드명**을 실어야 루틴이 스스로 고친다(피드백 없는 거부는 반복을 못 막는다)."""
    seg = {"name": "A", "period": "2025", alias: 42.0}
    resp, _ = put_single({"market_outlook": {"segments": [seg]}})
    assert resp.status_code == 422, resp.text
    assert alias in resp.text and canonical in resp.text, resp.text


def test_canonical_field_names_are_accepted():
    """거부 축의 대조군 — 정본 필드명으로 쓴 같은 내용은 통과한다(별칭 6종만 막는다)."""
    resp, _ = put_single({"market_outlook": {"segments": [{
        "name": "A", "period": "2025", "revenue_share_pct": 42.0,
        "prev_period": "2024", "prev_revenue_share_pct": 48.0, "share_pct": 40.0,
    }]}})
    assert resp.status_code == 200, resp.text


# ── ⓑ'' 렌더 가능한 필드 0개 거부 (미지 키로 되살아나는 B53) ───────────────────
#
# `extra="allow"`라 `{"text": "<산문>"}`은 타입 검증을 통과하는데, 그러면 프론트
# MarketOutlookSection의 early-return이 그대로 성립해 "시장 전망" 섹션이 **통째로** 사라진다
# — 산문 문자열을 보냈을 때와 **증상이 동일**하다. 그래서 축을 그 early-return의 등가로 쓴다.

@pytest.mark.parametrize("payload,why", [
    ({"text": "글로벌 HBM 시장은 AI 서버 수요로 고성장 중이며 당사는 점유율 2위다."}, "산문을 미지 키에"),
    ({}, "빈 객체"),
    ({"position": "1위", "sources": ["Gartner (2026-01)"]}, "position·sources만(프론트가 안 그린다)"),
    ({"size_current": {"unit": "십억달러", "year": 2026}}, "size에 value가 없다"),
    ({"one_liner": "   ", "market_name": ""}, "공백만"),
    ({"segments": []}, "빈 배열뿐"),
])
def test_market_outlook_without_renderable_fields_is_rejected(payload, why):
    resp, m = put_single({"market_outlook": payload})
    assert resp.status_code == 422, f"{why}: {resp.status_code} {resp.text[:200]}"
    m.assert_not_called()


@pytest.mark.parametrize("payload,why", [
    ({"market_name": "글로벌 HBM 시장"}, "market_name"),
    ({"one_liner": "연 23% 성장"}, "one_liner"),
    ({"cagr_pct": 0.0}, "cagr_pct=0(0은 유효값이다)"),
    ({"company_share_pct": 0.0}, "company_share_pct=0"),
    ({"size_current": {"value": 43, "unit": "십억달러", "year": 2026}}, "size_current.value"),
    ({"text": "산문", "segments": [{"name": "A", "period": "2025"}]}, "미지 키 + segments"),
    ({"position": "1위", "market_name": "X"}, "position + market_name"),
])
def test_one_renderable_field_is_enough(payload, why):
    """대조군 — 화면이 읽는 필드가 하나라도 있으면 통과한다(이 축이 부분결측을 막지 않음을 못박는다).
    라이브에 부분결측이 흔하므로(company_share_pct null 88건 등) 이쪽이 더 중요하다."""
    resp, _ = put_single({"market_outlook": payload})
    assert resp.status_code == 200, f"{why}: {resp.text}"


# ── ⓒ 명시적 null 비대칭 (task#250) ───────────────────────────────────────────

def test_explicit_null_market_outlook_is_accepted():
    """`"market_outlook": null`은 422가 아니다 — Optional[X] = Field(None)이라야 성립한다.
    (`X = Field(None)`으로 쓰면 키 생략만 통과하고 명시적 null이 422가 되어, 그 필드
    하나 때문에 enrich 요청 전체가 막힌다.)"""
    resp, m = put_single({"moat": "특허 포트폴리오", "market_outlook": None})
    assert resp.status_code == 200, resp.text
    assert "market_outlook" not in m.call_args[0][1]  # None은 저장 대상이 아니다


def test_explicit_null_market_outlook_is_accepted_in_batch():
    resp, m = put_batch([{"ticker": "LLY", "moat": "x", "market_outlook": None}])
    assert resp.status_code == 200, resp.text


@pytest.mark.parametrize("null_field", [
    "size_current", "size_forecast", "cagr_pct", "company_share_pct",
    "position", "sources", "one_liner", "market_name", "segments",
])
def test_explicit_null_on_every_optional_subfield_is_accepted(null_field):
    """하위 필드의 명시적 null도 전부 통과해야 한다(선택 배열 segments·sources 포함)."""
    payload = dict(SPEC_EXAMPLE)
    payload[null_field] = None
    resp, _ = put_single({"market_outlook": payload})
    assert resp.status_code == 200, f"{null_field}: {resp.text}"


def test_explicit_null_on_nested_segment_optionals_is_accepted():
    seg = {"name": "메모리", "period": "2025", "revenue_share_pct": None,
           "prev_period": None, "prev_revenue_share_pct": None, "market": None,
           "share_pct": None, "share_pct_forecast": None, "note": None, "sources": None}
    resp, _ = put_single({"market_outlook": {"segments": [seg]}})
    assert resp.status_code == 200, resp.text


def test_empty_segments_array_is_accepted():
    """빈 배열은 사실이다(부문 분해 없음) — 프론트가 섹션째 생략한다."""
    resp, _ = put_single({"market_outlook": {"market_name": "X", "segments": []}})
    assert resp.status_code == 200, resp.text


def test_market_outlook_omitted_entirely_still_works():
    resp, m = put_single({"moat": "특허 포트폴리오"})
    assert resp.status_code == 200, resp.text
    assert list(m.call_args[0][1]) == ["moat"]


# ── ⓓ 비유한값 ────────────────────────────────────────────────────────────────
#
# raw JSON 본문의 NaN/Infinity 토큰은 json.loads를 통과하고, NaN 비교는 항상 False라
# 범위 검증도 통과하며, 응답 직렬화(starlette allow_nan=False)에서 500이 된다(task#211).
# allow_inf_nan=False가 그것을 422로 수렴시킨다. 두 토큰의 운명이 갈리지 않는지 함께 잰다.

_NONFINITE_PATHS = [
    ("cagr_pct", lambda v: {"cagr_pct": v}),
    ("company_share_pct", lambda v: {"company_share_pct": v}),
    ("size_current.value", lambda v: {"size_current": {"value": v, "unit": "억달러", "year": 2026}}),
    ("size_forecast.value", lambda v: {"size_forecast": {"value": v, "unit": "억달러", "year": 2030}}),
    ("segments.revenue_share_pct",
     lambda v: {"segments": [{"name": "A", "period": "2025", "revenue_share_pct": v}]}),
    ("segments.share_pct",
     lambda v: {"segments": [{"name": "A", "period": "2025", "share_pct": v}]}),
    ("segments.share_pct_forecast",
     lambda v: {"segments": [{"name": "A", "period": "2025", "share_pct_forecast": v}]}),
    ("segments.prev_revenue_share_pct",
     lambda v: {"segments": [{"name": "A", "period": "2025", "prev_revenue_share_pct": v}]}),
    ("segments.market.size",
     lambda v: {"segments": [{"name": "A", "period": "2025", "market": {"size": v}}]}),
    ("segments.market.size_forecast",
     lambda v: {"segments": [{"name": "A", "period": "2025", "market": {"size_forecast": v}}]}),
    ("segments.market.cagr_pct",
     lambda v: {"segments": [{"name": "A", "period": "2025", "market": {"cagr_pct": v}}]}),
]


@pytest.mark.parametrize("token", ["NaN", "Infinity", "-Infinity"])
@pytest.mark.parametrize("label,build", _NONFINITE_PATHS, ids=[p[0] for p in _NONFINITE_PATHS])
def test_nonfinite_numbers_are_rejected_on_every_float_field(token, label, build):
    """상한 없는 필드(size 계열)는 ge=0만으론 Infinity를 못 막는다 — allow_inf_nan=False가 실린다."""
    body = '{"market_outlook": %s}' % json.dumps(
        build("__TOKEN__"), ensure_ascii=False).replace('"__TOKEN__"', token)
    with patch("routers.stocks.storage.enrich_stock", return_value=True) as m:
        resp = client.put("/api/stocks/LLY/enrich", content=body.encode(),
                          headers={"Content-Type": "application/json"})
    assert resp.status_code == 422, f"{label}={token}: {resp.status_code} {resp.text[:200]}"
    m.assert_not_called()


# ── ⓔ 구조 위반 ───────────────────────────────────────────────────────────────

def test_segment_without_name_is_rejected():
    """부문명 없는 행은 비중 막대에 빈 라벨을 그린다 — 조용한 파손보다 422."""
    resp, _ = put_single({"market_outlook": {"segments": [{"period": "2025", "revenue_share_pct": 50}]}})
    assert resp.status_code == 422, resp.text


def test_segment_without_period_is_rejected():
    """period는 financials_annual의 period와 문자열 일치해야 서버가 부문 매출 금액을 환산한다.
    결측이면 금액이 통째로 사라지므로(조용한 소실) 422로 되돌린다."""
    resp, _ = put_single({"market_outlook": {"segments": [{"name": "메모리", "revenue_share_pct": 50}]}})
    assert resp.status_code == 422, resp.text


@pytest.mark.parametrize("blank", ["", "   "])
def test_segment_blank_name_is_rejected(blank):
    resp, _ = put_single({"market_outlook": {"segments": [{"name": blank, "period": "2025"}]}})
    assert resp.status_code == 422, resp.text


def test_duplicate_segment_names_are_rejected():
    """같은 이름의 행을 두 번 그리면 독자가 서로 다른 둘로 읽는다(task#297 형제 결함)."""
    resp, _ = put_single({"market_outlook": {"segments": [
        {"name": "메모리", "period": "2025", "revenue_share_pct": 60},
        {"name": "메모리", "period": "2025", "revenue_share_pct": 40},
    ]}})
    assert resp.status_code == 422, resp.text


def test_distinct_segment_names_are_accepted():
    """중복 검증의 대조군 — 이름이 다르면 통과한다(위 축이 배열 자체를 막는 게 아님을 못박는다)."""
    resp, _ = put_single({"market_outlook": {"segments": [
        {"name": "메모리", "period": "2025", "revenue_share_pct": 60},
        {"name": "파운드리", "period": "2025", "revenue_share_pct": 40},
    ]}})
    assert resp.status_code == 200, resp.text


def test_forecast_year_before_current_year_is_rejected():
    """전망 연도가 현재보다 앞서면 "현재→예상" 대조와 CAGR이 무의미해진다."""
    resp, _ = put_single({"market_outlook": {
        "size_current": {"value": 24, "unit": "십억달러", "year": 2030},
        "size_forecast": {"value": 100, "unit": "십억달러", "year": 2025},
    }})
    assert resp.status_code == 422, resp.text


def test_forecast_year_equal_to_current_year_is_accepted():
    """같은 연도는 통과 — 대조가 무의미해지는 것은 *역행*뿐이다(경계 대조군)."""
    resp, _ = put_single({"market_outlook": {
        "size_current": {"value": 24, "unit": "십억달러", "year": 2026},
        "size_forecast": {"value": 100, "unit": "십억달러", "year": 2026},
    }})
    assert resp.status_code == 200, resp.text


@pytest.mark.parametrize("field,bad", [
    ("company_share_pct", 120.0),
    ("company_share_pct", -1.0),
    ("cagr_pct", -150.0),
])
def test_out_of_range_percentages_are_rejected(field, bad):
    resp, _ = put_single({"market_outlook": {field: bad}})
    assert resp.status_code == 422, resp.text


@pytest.mark.parametrize("bad", [{"revenue_share_pct": 120.0}, {"share_pct": -1.0},
                                 {"prev_revenue_share_pct": 101.0}])
def test_out_of_range_segment_percentages_are_rejected(bad):
    seg = {"name": "메모리", "period": "2025", **bad}
    resp, _ = put_single({"market_outlook": {"segments": [seg]}})
    assert resp.status_code == 422, resp.text


def test_segment_share_sum_over_100_is_accepted():
    """Σ비중 초과는 서버가 막지 않는다 — 프론트 deriveSegments가 *금액만* 생략하며
    graceful하게 처리한다(정상값을 지우지 않는다, task#248→#249). 라이브에도 100.1이 3건
    있으므로 여기서 422를 내면 그 발행들이 막힌다."""
    resp, _ = put_single({"market_outlook": {"segments": [
        {"name": "A", "period": "2025", "revenue_share_pct": 70},
        {"name": "B", "period": "2025", "revenue_share_pct": 60},
    ]}})
    assert resp.status_code == 200, resp.text


def test_six_segments_are_accepted():
    """정본 기입지침은 "최대 5개"지만 스키마로 강제하지 않는다 — 6번째 행은 조금 붐비는
    차트일 뿐인데 422는 그 종목의 enrich 요청 전체(moat·risks…)를 잃게 만든다."""
    segs = [{"name": f"S{i}", "period": "2025", "revenue_share_pct": 10} for i in range(6)]
    resp, _ = put_single({"market_outlook": {"segments": segs}})
    assert resp.status_code == 200, resp.text


# ── ⓕ 다른 enrich 필드는 무변경 ────────────────────────────────────────────────

def test_other_enrich_fields_remain_unvalidated():
    """이 슬라이스는 market_outlook만 조인다 — 형제 필드(competitor_edge 등)는 Any 그대로다.
    (한 필드의 스키마화가 다른 필드의 기존 발행을 막지 않음을 못박는다.)"""
    resp, m = put_single({
        "moat": "산문도 그대로",
        "competitor_edge": {"axis": "임상 파이프라인 폭", "entries": [{"ticker": "NVO"}]},
        "key_resource": "산문 문자열",
        "insights": {"stance": "매수"},
    })
    assert resp.status_code == 200, resp.text
    assert m.call_args[0][1]["key_resource"] == "산문 문자열"


def test_nested_nulls_are_not_injected_into_stored_json():
    """model_dump(exclude_none=True) — 선언 필드 10개의 null을 저장 JSON에 새로 심지 않는다
    (기존 저장 형태 보존). 이걸 빼면 `{"market_name": "X"}`가
    `{"market_name": "X", "size_current": null, ...}`로 저장된다."""
    resp, m = put_single({"market_outlook": {"market_name": "글로벌 HBM 시장"}})
    assert resp.status_code == 200, resp.text
    assert m.call_args[0][1]["market_outlook"] == {"market_name": "글로벌 HBM 시장"}


# ── ⓖ 프롬프트 예시 ↔ 스키마 정합 (자동 가드) ──────────────────────────────────
#
# B53의 절반은 프롬프트 예시가 **문자열 템플릿**이었다는 것이다
# (`"market_outlook":"<시장 전망: …>"`). 루틴은 이 프롬프트만 보고 body를 만들므로
# 예시가 문자열이면 산문을 보내는 것이 "지시대로 한 것"이 된다.
# 아래 두 축이 그 예시를 스키마에 묶어 둔다 — 예시가 다시 문자열로 되돌아가거나
# 스키마와 어긋나면 실패한다.

from pathlib import Path  # noqa: E402

from routers.stocks import BatchEnrichItem, MarketOutlook  # noqa: E402

_PROMPT_PATH = Path(__file__).resolve().parents[2] / "scripts" / "cowork-routine-prompt.md"


def _prompt_enrich_example():
    for line in _PROMPT_PATH.read_text(encoding="utf-8").splitlines():
        stripped = line.strip()
        if stripped.startswith('[{"ticker"') and "market_outlook" in stripped:
            return json.loads(stripped)
    raise AssertionError("프롬프트에서 enrich body 예시 줄을 찾지 못했다")


def test_prompt_enrich_example_market_outlook_is_an_object():
    """예시의 market_outlook이 dict여야 한다 — 문자열이면 루틴이 산문을 보낸다."""
    items = _prompt_enrich_example()
    assert len(items) == 1
    mo = items[0]["market_outlook"]
    assert isinstance(mo, dict), f"market_outlook이 객체가 아니다: {type(mo).__name__}"
    # 정본(CLAUDE_COWORK_API.md)의 필드가 예시에 실려 있는지 — 부분집합 대조
    assert {"market_name", "size_current", "size_forecast", "cagr_pct",
            "sources", "one_liner", "segments"} <= set(mo)
    seg = mo["segments"][0]
    assert {"name", "period", "revenue_share_pct"} <= set(seg)
    assert "market" in seg and {"size", "unit", "year"} <= set(seg["market"])


def test_prompt_enrich_example_validates_against_the_schema():
    """예시를 그대로 보내면 통과해야 한다 — 예시가 422를 부르면 루틴은 첫 호출부터 실패한다."""
    items = _prompt_enrich_example()
    BatchEnrichItem.model_validate(items[0])  # ValidationError면 실패


def test_prompt_example_guard_has_teeth():
    """이빨 실증 — 예시의 market_outlook이 옛 문자열 템플릿으로 되돌아가면 검증이 실패한다."""
    items = _prompt_enrich_example()
    regressed = {**items[0], "market_outlook": "<시장 전망: 시장 규모·성장률과 자사 위치>"}
    with pytest.raises(Exception):
        BatchEnrichItem.model_validate(regressed)


# ── ⓗ 정본 명세서의 예시 ↔ 스키마 정합 (자동 가드) ────────────────────────────
#
# `test_api_doc_sync.py`는 엔드포인트 *존재*만 대조하므로 요청 스키마 산문·예시 drift에
# 원리적으로 블라인드하다(스위트 초록 상태로 무기한 생존한다). 이 축이 최소한
# **예시가 실제로 통과하는지**를 잰다 — 예시가 422를 부르면 그 문서를 읽고 만든 요청은
# 첫 호출부터 실패한다.

_DOCS = [Path(__file__).resolve().parents[2] / name
         for name in ("API_SPEC.md", "CLAUDE_COWORK_API.md")]


def _market_outlook_examples(text):
    """`"market_outlook": { ... }` 의 균형 잡힌 객체만 잘라 낸다(형제 필드의 `[...]`
    플레이스홀더에 걸리지 않도록 market_outlook 값 자체만 파싱한다)."""
    out, key = [], '"market_outlook":'
    idx = text.find(key)
    while idx != -1:
        start = text.find("{", idx)
        if start != -1 and text[idx + len(key):start].strip() == "":
            depth, i = 0, start
            while i < len(text):
                if text[i] == "{":
                    depth += 1
                elif text[i] == "}":
                    depth -= 1
                    if depth == 0:
                        out.append(text[start:i + 1])
                        break
                i += 1
        idx = text.find(key, idx + 1)
    return out


@pytest.mark.parametrize("doc", _DOCS, ids=[d.name for d in _DOCS])
def test_spec_market_outlook_examples_validate(doc):
    examples = _market_outlook_examples(doc.read_text(encoding="utf-8"))
    assert examples, f"{doc.name}에서 market_outlook 예시를 찾지 못했다 — 이 가드가 공허해진다"
    for raw in examples:
        MarketOutlook.model_validate(json.loads(raw))  # ValidationError면 실패


def test_spec_example_guard_has_teeth():
    """이빨 실증 — 예시에 별칭 오타가 섞이면(=문서가 스키마와 어긋나면) 위 축이 실패한다."""
    broken = json.loads(_market_outlook_examples(_DOCS[0].read_text(encoding="utf-8"))[0])
    broken["segments"] = [{"name": "A", "period": "2025", "revenue_pct": 50.0}]
    with pytest.raises(Exception):
        MarketOutlook.model_validate(broken)


# ── ⓘ 배치 레인의 대가 — 한 항목의 위반이 요청 전체를 되돌린다 ─────────────────
#
# 본문 검증은 핸들러 진입 *전*이라 422면 저장이 0건이고, **같은 배열의 정상 종목 필드까지**
# 저장되지 않는다(task#248→#249: `wrong<missing`은 *정상값을 지우기*엔 적용되지 않는다).
# 이 축이 그 성질을 못박아, 두 명세서와 루틴 프롬프트의 「분할 재시도」 지시가 왜 필요한지를
# 코드로 증언한다. 회피 수단은 소비자 쪽 분할이므로 여기선 사실만 고정한다.

def test_one_bad_item_discards_the_whole_batch():
    resp, m = put_batch([
        {"ticker": "AAPL", "moat": "생태계 락인", "risks": "규제"},
        {"ticker": "TSLA", "market_outlook": PROSE},
    ])
    assert resp.status_code == 422, resp.text
    m.assert_not_called()  # 정상 항목(AAPL)의 moat·risks도 저장되지 않는다
    assert "1" in str(resp.json()["detail"][0]["loc"]), resp.text  # loc이 인덱스를 알려준다


def test_splitting_the_batch_saves_the_good_item():
    """위 손실의 회피 경로 — 종목별 단건 PUT으로 분할하면 정상 종목은 저장된다
    (프롬프트·두 명세서가 지시하는 복구 절차가 실제로 통하는지의 대조군)."""
    resp, m = put_single({"moat": "생태계 락인", "risks": "규제"})
    assert resp.status_code == 200, resp.text
    assert m.call_args[0][1] == {"moat": "생태계 락인", "risks": "규제"}

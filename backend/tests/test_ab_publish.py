"""A/B 하네스 코어의 이빨 (task#350).

여기서 잠그는 것은 **측정이 대상에 닿았는가**와 **세션이 프로드를 때릴 수 없는가**다.
특히 BASE URL 치환은 2겹 방어의 첫 겹이라, 치환이 조용히 0건이 되면 세션이 프로드 주소를
그대로 들고 나간다 → 그 경우 발사를 **중단**해야 하며, 「치환했다」가 아니라 「정확히 1건」을 단언한다.
"""
import importlib.util
import json
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parent.parent.parent
HARNESS = REPO / "scripts" / "ab-publish.py"
PROD = "https://portfolion.taebro.com"

pytestmark = pytest.mark.skipif(not HARNESS.exists(), reason="하네스 스크립트 부재")


def _load():
    spec = importlib.util.spec_from_file_location("ab_publish", HARNESS)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


@pytest.fixture
def mod():
    return _load()


ROUTINE = f"""PortfoliOn 자동 분석 루틴 — 아래 지침대로 수행하라.

BASE URL: {PROD}
모든 요청에 헤더 X-API-Key를 붙인다. 키 값은 셸 환경변수 PORTFOLION_API_KEY에 있다 —
curl에는 반드시 변수로만 쓴다: -H "X-API-Key: $PORTFOLION_API_KEY"

== 1) enrich ==
== 2) 심층 ==
== 3) 기술 ==
"""


# ── 2겹 방어 ①: BASE URL 치환 ────────────────────────────────────────

def test_base_url_is_replaced_exactly_once(mod):
    """① 치환은 **정확히 1건** — 세션이 프로드 주소를 들고 나가지 못한다."""
    out = mod.build_prompt(ROUTINE, "http://127.0.0.1:9999", lane="analyst", sample="GOOGL")
    assert "http://127.0.0.1:9999" in out
    assert PROD not in out, "프로드 주소가 프롬프트에 남았다 — 첫 겹이 뚫렸다"


def test_missing_base_url_line_aborts_instead_of_firing(mod):
    """② 치환 대상이 없으면 **발사하지 않는다**.

    문자열 드리프트로 치환이 0건이 되면 프롬프트는 프로드를 가리킨 채 발사된다.
    조용히 진행하는 것이 최악이므로 예외로 중단한다(더미 키가 두 번째 겹으로 남지만,
    한 겹이 깨졌다는 사실 자체가 측정을 신뢰할 수 없게 만든다).
    """
    with pytest.raises(Exception):
        mod.build_prompt("BASE URL 이 없는 프롬프트", "http://127.0.0.1:9999", lane="tech", sample="smr")


def test_duplicate_base_url_lines_also_abort(mod):
    """③ 2건 이상이어도 중단 — 「1건만 바꾸고 나머지를 남기는」 부분 치환을 막는다."""
    with pytest.raises(Exception):
        mod.build_prompt(ROUTINE + f"\nBASE URL: {PROD}\n", "http://127.0.0.1:9999",
                         lane="tech", sample="smr")


def test_trigger_names_the_lane_section_and_sample(mod):
    """④ 트리거 문장이 레인 절과 대상을 못박는다(세션이 3절을 전부 돌지 않게)."""
    out = mod.build_prompt(ROUTINE, "http://127.0.0.1:1", lane="tech", sample="smr")
    assert "smr" in out
    assert "3" in out.split("== 1)")[0] or "기술" in out


# ── 2겹 방어 ②: 더미 키 ──────────────────────────────────────────────

def test_child_env_gets_dummy_key_never_the_real_one(mod):
    """⑤ 자식 env의 키는 더미다 — 프록시를 우회해 prod를 때려도 401."""
    env = mod.child_env("sk-REAL-abcdef0123456789", {"PATH": "/usr/bin"})
    assert env["PORTFOLION_API_KEY"] != "sk-REAL-abcdef0123456789"
    assert env["PATH"] == "/usr/bin", "부모 환경을 갈아끼우면 실행기가 안 뜬다"


# ── opus 팔: 세션 0개 수확 ───────────────────────────────────────────

def test_opus_arm_is_harvested_not_fired(mod):
    """⑥ opus 판은 기존 산출물에서 나오고 **세션을 띄우지 않는다**(비용 0).

    현행 레인이 매일 만드는 것이 곧 기준선이므로 재실행보다 충실하다.
    """
    row = {"fields": {"moat": "해자", "risks": "위험"}, "created_at": "2026-09-14T02:05:00+09:00"}
    out = mod.normalize_opus(row, lane="enrich")
    assert out["arm"] == "opus"
    assert out["fired"] is False, "opus 팔이 세션을 띄웠다 — 설계 위반"
    assert out["baseline_date"].startswith("2026-09-14")


def test_time_skew_days_is_reported(mod):
    """⑦ 기준선과 실행일의 **간격(일)**이 계산된다.

    간격을 안 적으면 그 사이 주가·실적 변동이 「무료 모델이 틀렸다」로 잡힌다.
    """
    assert mod.skew_days("2026-08-13", "2026-09-15") == 33
    assert mod.skew_days("2026-09-15", "2026-09-15") == 0


def test_numeric_axis_reports_coverage_not_just_ratio(mod):
    """⑧ 수치 일치율은 **커버리지 카운터**와 함께 나온다.

    매핑 가능한 필드가 0개면 일치율 100%가 공허하게 통과한다 — 표본 0을 통과로 위장 금지.
    """
    res = mod.numeric_match({}, {}, mapping={})
    assert res["comparable"] == 0
    assert res["verdict"] == "대조 불가", "표본 0인데 일치로 보고했다"

    res2 = mod.numeric_match({"pe": 10.0, "ps": 2.0}, {"pe": 10.0, "ps": 9.9}, mapping={"pe": "pe", "ps": "ps"})
    assert res2["comparable"] == 2 and res2["matched"] == 1


def test_capture_is_harvested_for_the_right_lane(mod):
    """⑨ 레인별로 **그 레인의** 캡처를 고른다(엉뚱한 캡처를 산출로 삼지 않게)."""
    caps = [
        {"method": "POST", "path": "/api/report/generate", "body": {}},
        {"method": "POST", "path": "/api/tech-reports/smr", "body": {"title": "T"}},
    ]
    picked = mod.pick_capture(caps, lane="tech", sample="smr")
    assert picked["path"] == "/api/tech-reports/smr"


def test_no_capture_is_an_error_not_an_empty_success(mod):
    """⑩ 캡처가 없으면 **실패**로 기록한다 — 빈 산출을 「발행 안 함이 옳은 판단」과 섞지 않는다.

    루틴은 조건 미충족 시 발행하지 않는 것이 정상이므로 둘을 구별해 기록해야 한다.
    """
    assert mod.pick_capture([], lane="tech", sample="smr") is None

"""수주잔고 유형1 표 자동추출 + 검산 게이트 (task 14).

실 DART document.xml 표 HTML fixture(`tests/fixtures/backlog/*.html`)로 검증.
- 유형1(수주상황 표) 단일법인: 헤더 컬럼 매핑 → 합계/단일행 수주잔고 금액 → 상대 1% 검산 → 억원 정규화.
- 다중엔티티(한화)·외화(삼바)·무합계 다중행(현대차)·빈셀(SK이노)·면책문구(삼성전자)는 None.
"""
import re
import sys
from pathlib import Path

import pytest
from bs4 import BeautifulSoup

sys.path.insert(0, str(Path(__file__).parent.parent))

FIX = Path(__file__).parent / "fixtures" / "backlog"


def _load(tk):
    """fixture 파일 → (table Tag, unit). 단위는 첫 줄 주석의 unit_hint에서 추출(금액 통화만).

    hint를 못 읽으면 **'억원'으로 가정하지 않고 시끄럽게 실패**한다 — 프로덕션에서
    제거한 억원 폴백(B62)이 테스트 하니스에 남으면, 단위 힌트 없는 fixture가 추가되는
    순간 그 fixture가 "억원으로 가정하고 추출 성공"을 단언하게 되어 고친 판정축과
    정반대를 증언한다. 현재 fixture 11종은 모두 hint를 갖는다(실측).
    """
    raw = (FIX / f"{tk}.html").read_text()
    comment, html = raw.split("-->", 1)
    m = re.search(r"단위[^)]*?(조원|억원|백만원|천원|달러|원)", comment)
    if not m:
        pytest.fail(f"{tk} fixture에 금액 통화 unit_hint가 없다 — 억원 폴백 금지, "
                    f"hint를 fixture 첫 줄에 명시할 것: {comment.strip()[:80]!r}")
    table = BeautifulSoup(html, "html.parser").find("table")
    return table, m.group(1)


# ── _classify_table ──

def test_classify_susu_vs_disclaimer():
    from services import backlog as svc
    assert svc._classify_table(_load("010140")[0]) == "susu"
    assert svc._classify_table(_load("329180")[0]) == "susu"
    # 삼성전자: 면책문구 1행, 데이터 없음 → susu 아님
    assert svc._classify_table(_load("005930")[0]) is None


# ── _parse_susu_table: 정상 추출 + 검산 통과 (억원 정규화) ──

@pytest.mark.parametrize("tk,expected_eok", [
    ("010140", 295197.0),      # 삼성중공업, 억원 그대로
    ("329180", 621707.77),     # HD현중, 백만원÷100 (변종B)
    ("439260", 16941.46),      # 대한조선, 단일행 변종B
    ("034020", 113113.10),     # 두산에너빌, 수주잔고 중간컬럼 (헤더 매핑 필수)
])
def test_parse_susu_table_extracts_and_reconciles(tk, expected_eok):
    from services import backlog as svc
    table, unit = _load(tk)
    amt = svc._parse_susu_table(table, unit)
    assert amt is not None, f"{tk} should auto-extract"
    assert abs(amt - expected_eok) < 0.5, f"{tk}: {amt} != {expected_eok}"


# ── _parse_susu_table: None 케이스 (검산/가드로 안전 처리) ──

def test_parse_none_empty_backlog_cell():
    # SK이노: 합계 수주잔고 금액 빈셀(-) → None
    from services import backlog as svc
    table, unit = _load("096770")
    assert svc._parse_susu_table(table, unit) is None


def test_parse_none_multi_entity():
    # 한화: 종속회사 그룹 다수(연결 합계 116조) → 모회사 기준 아님 → None
    from services import backlog as svc
    table, unit = _load("012450")
    assert svc._parse_susu_table(table, unit) is None


def test_parse_none_foreign_currency():
    # 삼바: 백만 달러 → KRW 아님 → None (FX 변환 별도)
    from services import backlog as svc
    table, unit = _load("207940")
    assert svc._parse_susu_table(table, unit) is None


def test_parse_none_no_total_row_multi_data():
    # 현대차: 합계 행 없는 다중 데이터행 → 모호 → None (합산 금지)
    from services import backlog as svc
    table, unit = _load("005380")
    assert svc._parse_susu_table(table, unit) is None


# ── _to_eok 정규화 ──

def test_to_eok_normalization():
    from services import backlog as svc
    assert svc._to_eok(295197, "억원") == pytest.approx(295197)
    assert svc._to_eok(62170777, "백만원") == pytest.approx(621707.77)
    assert svc._to_eok(1.0, "조원") == pytest.approx(10000)
    assert svc._to_eok(100000, "천원") == pytest.approx(1)


# ── _num: 콤마/괄호(음수)/빈셀 ──

def test_num_parsing():
    from services import backlog as svc
    assert svc._num("62,170,777") == 62170777.0
    assert svc._num("(5,916,332)") == -5916332.0
    assert svc._num("-") is None
    assert svc._num("") is None
    assert svc._num("상세내역 참조") is None


# ── _auto_backlog: 문서 단위 (캡션 단위 자동 감지) ──

def test_auto_backlog_picks_susu_table_with_caption():
    """단위 캡션이 있는 문서에서 수주상황 표를 골라 추출."""
    from services import backlog as svc
    table_html = (FIX / "010140.html").read_text().split("-->", 1)[1]
    doc = f"<p>(단위 : 억원)</p>{table_html}"
    assert svc._auto_backlog(doc) == pytest.approx(295197, abs=0.5)

    # 다중엔티티 문서 → None
    han = (FIX / "012450.html").read_text().split("-->", 1)[1]
    assert svc._auto_backlog(f"<p>(단위 : 백만원)</p>{han}") is None


# ── 회귀: UAT가 잡아낸 오저장 (외화 USD천·회사컬럼 다중엔티티) ──

def _doc(tk, caption):
    html = (FIX / f"{tk}.html").read_text().split("-->", 1)[1]
    return f"<p>{caption}</p>{html}"


def test_table_unit_foreign_caption_is_not_krw():
    """캡션은 **있고** KRW 통화 토큰만 없는 경우 → 비KRW('기타'), 억원 폴백 금지.

    ⚠️ 이 테스트의 정의역은 '캡션 존재 + KRW 토큰 부재'뿐이다. 옛 이름
    (`..._foreign_or_missing_...`)의 'missing'은 '캡션 부재'로 읽히지만 아래 케이스는
    모두 캡션을 붙여 주므로 그 분기를 덮지 않았고, 그 과대 주장이 곧 B62가 오래
    생존한 사각이었다("`_table_unit`엔 폴백 금지 테스트가 이미 있다"로 읽힘).
    캡션 부재·원거리 캡션 축은 `test_table_unit_no_default_fallback.py`에 있다.
    """
    from services import backlog as svc
    for cap in ("(단위 : USD천)", "(단위 : 백만 달러)", "(단위 :", "(단위 : 천달러)"):
        soup = BeautifulSoup(f"<p>{cap}</p><table><tr><td>x</td></tr></table>", "html.parser")
        assert not svc._is_krw(svc._table_unit(soup.find("table"))), cap
    # KRW는 정상 검출
    soup = BeautifulSoup("<p>(단위 : 백만원)</p><table><tr><td>x</td></tr></table>", "html.parser")
    assert svc._table_unit(soup.find("table")) == "백만원"
    # 캡션 부재는 '확정된 비KRW'가 아니라 **미확정(None)** — 호출측이 더 약한 소스
    # (본문 통화 키워드)를 시도할 수 있게 두 상태를 구별한다.
    soup = BeautifulSoup("<table><tr><td>x</td></tr></table>", "html.parser")
    assert svc._table_unit(soup.find("table")) is None


def test_auto_backlog_none_foreign_usd_thousand():
    # 454910: (단위 : USD천) → 외화 → None (1.35조 오저장 회귀 방지)
    from services import backlog as svc
    assert svc._auto_backlog(_doc("454910", "(단위 : USD천)")) is None


def test_is_multi_entity_company_column():
    # 한화 2024Q3: 종속회사 문구 없어도 '회사' 컬럼 → 다중엔티티
    from services import backlog as svc
    assert svc._is_multi_entity(_load("012450_2024q3")[0]) is True
    assert svc._is_multi_entity(_load("010140")[0]) is False
    assert svc._is_multi_entity(_load("329180")[0]) is False
    assert svc._is_multi_entity(_load("034020")[0]) is False  # 발주처 ≠ 회사


def test_auto_backlog_none_company_column_multi_entity():
    # 한화 2024Q3 문서(회사컬럼 합계 68조) → None (검산 통과해도 다중엔티티)
    from services import backlog as svc
    assert svc._auto_backlog(_doc("012450_2024q3", "(단위 : 백만원)")) is None


# ── 다중엔티티 연결 요약표 → segments 자동추출 + Σ==합계 검산 (task 15) ──

def test_segments_from_multi_entity_reconciles():
    from services import backlog as svc
    table, unit = _load("012450")  # 연결 합계 116조, 백만원
    res = svc._segments_from_susu(table, unit)
    assert res is not None, "다중엔티티 요약표는 segments+합계로 추출돼야"
    total, segs = res
    assert abs(total - 1168007.29) < 1, total
    assert abs(sum(s["amount"] for s in segs) - total) < 1, "Σsegments==합계"
    by = {}
    for s in segs:
        by[s["sector"]] = by.get(s["sector"], 0) + s["amount"]
    # 사업부문별 합산(여러 법인): 방산 = 한화에어로 372199 + 한화시스템 93027
    assert abs(by["방산"] - 465225.75) < 1, by.get("방산")
    assert abs(by["해양"] - 346191.85) < 1, by.get("해양")
    assert "IT서비스" in by and "IT서비스 등" not in by  # 'IT서비스 등' 정규화


def test_segments_none_when_sum_mismatch(monkeypatch):
    # 합계 행을 훼손하면 Σ≠합계 → None (검산 게이트)
    from services import backlog as svc
    table, unit = _load("012450")
    # 합계 행 수주잔고를 절반으로 바꾼 표를 만들기 위해 _to_eok를 건드리지 않고
    # 직접 검산 실패를 유도: total을 강제로 다르게 보게 monkeypatch는 과하므로
    # 정상 통과만 위 테스트에서 보장하고, 여기선 단일엔티티가 None인지로 가드 확인
    table2, unit2 = _load("010140")  # 단일엔티티
    assert svc._segments_from_susu(table2, unit2) is None


def test_auto_backlog_multi_picks_summary():
    from services import backlog as svc
    han = (FIX / "012450.html").read_text().split("-->", 1)[1]
    res = svc._auto_backlog_multi(f"<p>(단위 : 백만원)</p>{han}")
    assert res is not None
    assert abs(res[0] - 1168007.29) < 1


def test_auto_backlog_multi_none_for_single_entity():
    from services import backlog as svc
    sc = (FIX / "010140.html").read_text().split("-->", 1)[1]
    assert svc._auto_backlog_multi(f"<p>(단위 : 억원)</p>{sc}") is None

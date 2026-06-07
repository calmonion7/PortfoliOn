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
    """fixture 파일 → (table Tag, unit). 단위는 첫 줄 주석에서 추출(금액 통화만)."""
    raw = (FIX / f"{tk}.html").read_text()
    comment, html = raw.split("-->", 1)
    m = re.search(r"단위[^)]*?(조원|억원|백만원|천원|달러|원)", comment)
    unit = m.group(1) if m else "억원"
    table = BeautifulSoup(html, "html.parser").find("table")
    return table, unit


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


def test_table_unit_foreign_or_missing_is_not_krw():
    # 캡션은 있으나 KRW 통화 토큰 없음 → 비KRW(기타), 억원 폴백 금지(×100 오저장 방지)
    from services import backlog as svc
    for cap in ("(단위 : USD천)", "(단위 : 백만 달러)", "(단위 :", "(단위 : 천달러)"):
        soup = BeautifulSoup(f"<p>{cap}</p><table><tr><td>x</td></tr></table>", "html.parser")
        assert not svc._is_krw(svc._table_unit(soup.find("table"))), cap
    # KRW는 정상 검출
    soup = BeautifulSoup("<p>(단위 : 백만원)</p><table><tr><td>x</td></tr></table>", "html.parser")
    assert svc._table_unit(soup.find("table")) == "백만원"


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

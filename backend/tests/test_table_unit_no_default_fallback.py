"""단위 캡션 추출 실패는 '억원' 가정이 아니라 미확정('기타')이어야 한다 (B62·B64).

`wrong < missing` — 단위를 못 정하면 pending으로 흘려 Cowork가 채운다. 억원으로
가정하면 실제가 천원/원 단위였을 때 ×100~×100,000 대형 오저장이 된다.

라이브 실측(**probe327**, 실 DART document.xml 최근 정기보고서 **123건 / 16종목**,
susu 표 **159개**). 거리는 **비공백 문자열 노드** 기준(= `_UNIT_CAPTION_LOOKBACK`의 단위):
  - 올바른 캡션까지의 분포 = **{1: 158, 3: 1}** → **min=1, max=3**. 구조는
    `<table><td>(단위 : 백만원)</td></table>` 1셀 표가 수주표 바로 위에 오는 형태라
    "표 경계에서 중단"·"직전 형제 N개" 규칙은 **실문서를 전부 깨뜨린다**(캡션이 다른 표
    안에 있다).
  - 그 앞 무관 섹션의 다음 캡션까지 = **14~132**(n=142).
  - ⚠️ **정정** — 이 파일의 옛 서술은 probe326(최신 보고서 1건/종목, susu 22개)을 근거로
    「min=max=1, 상한 3은 관측거리의 **3배**」라고 적었는데, 분기별로 표본을 넓히니
    **거리 3이 실재**했다(005380 분기보고서형: 표 직전 비공백 노드가
    `')'`→`'백만원'`→`'(단위 :'`로 캡션이 줄바꿈 분리). 즉 **위쪽 여유는 3배가 아니라 0**이며
    상한은 **양방향 load-bearing**이다 — 줄이면 실문서가 pending으로 강하하고, 늘리면
    무관 섹션 캡션을 주워 ×100~×10000 오저장이 된다.
  - 라이브 라벨 변경은 **1건**(454910 억원 → 기타)이고 나머지는 unit·추출 금액이
    **완전 동일**했다 — 상한이 실문서를 해치지 않는다는 대조군 증거.
  ⚠️ 같은 문서를 *공백 포함* raw hop으로 재면 5와 80~377이 된다. 단위가 다르므로 그
  숫자를 이 상한과 직접 비교하지 말 것.

축 구성: ⓐ 캡션 부재 → 미확정 / ⓑ 원거리 캡션 미채택 / ⓒ **대조군**(정상 입력은 계속
그 단위를 낸다 — 없으면 "전부 pending으로 만들기"가 통과한다) / ⓓ 폴백 잔존 0 스윕.
"""
import re
import sys
from pathlib import Path

import pytest
from bs4 import BeautifulSoup

sys.path.insert(0, str(Path(__file__).parent.parent))

FIX = Path(__file__).parent / "fixtures" / "backlog"


def _susu_html(tk="010140"):
    """fixture의 수주상황 표 HTML만(캡션 없음)."""
    return (FIX / f"{tk}.html").read_text().split("-->", 1)[1]


def _table(html):
    return BeautifulSoup(html, "html.parser").find("table")


# ── ⓐ B62: 캡션 부재 → 억원 가정 금지 ──

def test_table_unit_no_caption_is_not_krw():
    """표 앞에 '단위' 캡션이 아예 없으면 억원이 아니라 비KRW(미확정)."""
    from services import backlog as svc
    t = _table("<table><tr><td>x</td></tr></table>")
    unit = svc._table_unit(t)
    assert not svc._is_krw(unit), f"캡션 부재인데 KRW 단위로 확정됐다: {unit!r}"


def test_table_unit_no_caption_on_real_fixture_is_not_krw():
    """실 fixture(캡션 없이 저장된 수주상황 표)에도 억원 폴백이 없어야."""
    from services import backlog as svc
    unit = svc._table_unit(_table(_susu_html()))
    assert not svc._is_krw(unit), f"010140 캡션 부재인데 {unit!r}로 확정됐다"


def test_auto_backlog_without_caption_returns_none():
    """캡션 없는 문서는 자동추출하지 않는다(pending 경로로 흘러야) — ×100 오저장 방지.

    수정 전엔 억원으로 가정해 295197.0을 'dart' 확정값으로 저장했다.
    """
    from services import backlog as svc
    assert svc._auto_backlog(_susu_html()) is None


def test_extract_blocks_without_caption_or_keyword_is_not_krw():
    """B62 형제(`_extract_backlog_blocks` 최종 폴백): 캡션도 텍스트 키워드도 없으면 미확정.

    이 unit은 `_save_pending`을 통해 Cowork에 '이 문서의 단위'로 전달되므로,
    억원 오라벨은 Cowork의 ×100 오저장으로 직결된다.
    """
    from services import backlog as svc
    raw_text, unit = svc._extract_backlog_blocks(_susu_html())
    assert raw_text, "수주 블록 자체는 추출돼야(대조군)"
    assert not any(kw in raw_text for kw in ("백만원", "조원", "억원")), \
        "이 fixture는 텍스트 단위 키워드가 없어야 이 축이 성립한다"
    assert not svc._is_krw(unit), f"캡션·키워드 모두 없는데 {unit!r}로 확정됐다"


# ── ⓑ B64: 원거리 캡션 미채택 ──

def _far_doc(caption, filler_cells, susu):
    """caption ⋯ (무관 표 filler_cells개 셀) ⋯ susu표. 캡션을 원거리로 밀어낸다."""
    cells = "".join(f"<tr><td>무관항목{i}</td></tr>" for i in range(filler_cells))
    return f"<p>{caption}</p><table>{cells}</table>{susu}"


def test_table_unit_ignores_distant_caption():
    """무관 섹션의 먼 캡션은 이 표의 단위가 아니다 → 미확정."""
    from services import backlog as svc
    doc = _far_doc("(단위 : 조원)", 8, "<table><tr><td>x</td></tr></table>")
    t = BeautifulSoup(doc, "html.parser").find_all("table")[-1]
    unit = svc._table_unit(t)
    assert not svc._is_krw(unit), f"원거리 캡션을 주워 왔다: {unit!r}"


def test_auto_backlog_ignores_distant_caption():
    """원거리 캡션에 기대 자동추출하지 않는다(무관 섹션 단위로 확정 금지).

    수정 전엔 문서 전체를 거슬러 '(단위 : 조원)'을 주워 295197 × 10000 = 29.5억 억원으로
    저장했다 — 단위 오채택이 만드는 최악의 오저장 형태.
    """
    from services import backlog as svc
    assert svc._auto_backlog(_far_doc("(단위 : 조원)", 8, _susu_html())) is None


def test_distant_wrong_unit_is_not_adopted_over_missing():
    """원거리 캡션 단위가 실제와 달라도 그것을 채택하지 않는다(wrong < missing)."""
    from services import backlog as svc
    doc = _far_doc("(단위 : 백만원)", 8, _susu_html())
    t = BeautifulSoup(doc, "html.parser").find_all("table")[-1]
    assert svc._table_unit(t) != "백만원"


# ── ⓒ 대조군: 정상 입력은 계속 그 단위를 낸다 ──

@pytest.mark.parametrize("caption,expected", [
    ("(단위 : 억원)", "억원"),
    ("(단위 : 백만원)", "백만원"),
    ("(단위 : 조원)", "조원"),
    ("(단위 : 천원)", "천원"),
    ("(단위 : 백만원, %)", "백만원"),      # 라이브 034020 실캡션
    ("(단위 : 천배럴, 백만원)", "백만원"),  # 라이브 096770 실캡션(수량 단위 혼재)
])
def test_adjacent_caption_still_resolves(caption, expected):
    """표 직전 캡션(<p>)은 정상 채택 — 이것이 없으면 '전부 pending'이 통과한다."""
    from services import backlog as svc
    t = _table(f"<p>{caption}</p><table><tr><td>x</td></tr></table>")
    assert svc._table_unit(t) == expected


@pytest.mark.parametrize("caption,expected", [
    ("(단위 : 억원)", "억원"),
    ("(단위 : 백만원)", "백만원"),
])
def test_live_shaped_caption_in_preceding_one_cell_table_resolves(caption, expected):
    """라이브 실구조 대조군: 캡션이 **직전 1셀 표 안**에 있는 형태(probe327 실측 158/159).

    이 축이 곧 "표 경계에서 중단" 규칙을 금지하는 근거다 — 그 규칙이면 실문서가 전부 깨진다.
    """
    from services import backlog as svc
    doc = (f"<table><tr><td>{caption}</td></tr></table>"
           "<table><tr><td>x</td></tr></table>")
    t = BeautifulSoup(doc, "html.parser").find_all("table")[-1]
    assert svc._table_unit(t) == expected


def test_auto_backlog_with_adjacent_caption_still_extracts():
    """대조군: 캡션이 붙은 정상 문서는 계속 정확히 추출된다(억원 그대로)."""
    from services import backlog as svc
    doc = f"<p>(단위 : 억원)</p>{_susu_html()}"
    assert svc._auto_backlog(doc) == pytest.approx(295197, abs=0.5)


def test_auto_backlog_with_live_shaped_caption_still_extracts():
    """대조군: 라이브 실구조(직전 1셀 표 캡션)에서도 정확히 추출된다."""
    from services import backlog as svc
    doc = f"<table><tr><td>(단위 : 억원)</td></tr></table>{_susu_html()}"
    assert svc._auto_backlog(doc) == pytest.approx(295197, abs=0.5)


def test_extract_blocks_text_keyword_path_still_works():
    """대조군: 캡션이 없어도 raw_text에 통화 키워드가 있으면 그것을 쓴다."""
    from services import backlog as svc
    doc = f"{_susu_html()}<p>수주잔고는 백만원 기준입니다</p>"
    raw_text, unit = svc._extract_backlog_blocks(doc)
    assert raw_text
    assert unit == "백만원"


# ── ⓓ 폴백 잔존 0 스윕 ──

def test_no_krw_default_unit_fallback_remains():
    """실패 경로 어디에도 KRW 기본단위 폴백이 남아 있지 않다.

    S1 실측이 지목한 `_DEFAULT_UNIT` 4개 사용 지점(_table_unit 반환 · 최종
    `unit or ...` · html 부재 · raw_text 부재)을 모두 덮는다.
    """
    from services import backlog as svc
    # ① _table_unit 반환(캡션 부재)
    assert not svc._is_krw(svc._table_unit(_table("<table><tr><td>x</td></tr></table>")))
    # ② _extract_backlog_blocks 최종 폴백(캡션·키워드 모두 부재)
    assert not svc._is_krw(svc._extract_backlog_blocks(_susu_html())[1])
    # ③ html 부재 / ④ raw_text 부재(수주 블록 없음)
    assert not svc._is_krw(svc._extract_backlog_blocks("")[1])
    assert not svc._is_krw(
        svc._extract_backlog_blocks("<p>수주와 무관한 문단</p>")[1])


def test_default_unit_constant_is_not_a_krw_unit():
    """`_DEFAULT_UNIT`(억원 기본단위)이라는 개념 자체가 남아 있지 않아야.

    상수가 남아 있으면 다음 사람이 '기본 단위는 억원'으로 읽고 새 폴백을 만든다
    (S1 산문 감사 지적). 이름이 남았더라도 KRW 단위여서는 안 된다.
    """
    from services import backlog_parser as bp
    val = getattr(bp, "_DEFAULT_UNIT", None)
    assert val is None or not bp._is_krw(val), \
        f"_DEFAULT_UNIT이 여전히 KRW 단위({val!r})다"


def test_lookback_bound_equals_live_max_correct_caption_distance():
    """상한 상수는 **양방향** load-bearing이다 — 관측 최대 거리와 정확히 같게 유지.

    ⚠️ 이 축은 앞서 `1 <= LOOKBACK < 14/2`(=7)로 적혀 있었고 그 docstring이
    「4~8 구간을 이 축이 닫는다」고 주장했는데 **거짓이었다** — 경계가 `< 7.0`이므로
    실제로는 7·8만 닫고 **4·5·6은 통과**했다(실측 스윕: 4·5·6 → 21 passed / 7·8 → 1 failed).
    그리고 그 느슨한 구간이 그냥 남는 게 아니라 **판정축을 조용히 바꾼다** — LOOKBACK=6이면
    비공백 거리 4에 있는 캡션을 다시 주워 오게 되어(`test_prose_fallback_*` 계열의 입력)
    어떤 축도 반대하지 않는 채로 동작이 달라진다. 그래서 등가로 좁혀 exact 핀으로 쓴다.

    아래쪽도 마찬가지로 이빨이 필요하다: probe327 확대 표본에서 올바른 캡션의 **최대 거리가
    정확히 3**이었으므로(005380 분기보고서형, 캡션이 줄바꿈으로 분리) 2로 조이면 그 문서형이
    확정 → 미확정으로 뒤집혀 dart 커버리지가 조용히 회귀한다.

    상한을 정말 바꿔야 하면 **probe327을 다시 돌려** 두 분포(올바른 캡션 / 다음 무관 캡션)를
    재고 이 상수와 아래 두 숫자를 함께 갱신할 것(추측으로 넓히거나 좁히지 말 것).
    """
    from services import backlog_parser as bp
    LIVE_MAX_CORRECT_CAPTION_DIST = 3    # probe327 실측 max (n=159, 분포 {1:158, 3:1})
    LIVE_MIN_WRONG_CAPTION_DIST = 14     # probe327 실측 min (n=142)
    assert bp._UNIT_CAPTION_LOOKBACK == LIVE_MAX_CORRECT_CAPTION_DIST, (
        f"상한 {bp._UNIT_CAPTION_LOOKBACK} != 라이브 관측 최대 올바른 캡션 거리 "
        f"{LIVE_MAX_CORRECT_CAPTION_DIST} — 줄이면 실문서가 pending으로 강하하고, "
        f"늘리면 무관 섹션 캡션(최소 거리 {LIVE_MIN_WRONG_CAPTION_DIST})을 주울 여지가 생긴다. "
        f"probe327을 다시 돌려 두 분포를 재고 이 숫자들을 함께 갱신할 것"
    )
    # 두 분포가 아직 분리돼 있다는 사실 자체도 못박는다(겹치면 이 설계가 성립하지 않는다).
    assert LIVE_MAX_CORRECT_CAPTION_DIST < LIVE_MIN_WRONG_CAPTION_DIST

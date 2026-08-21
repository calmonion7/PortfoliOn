"""단위 캡션의 **복합 토큰**과 **텍스트 폴백 우회** (적대 검토 F1·F7·F8·F11).

B62(억원 기본값 폴백)·B64(원거리 캡션 오채택)를 닫은 뒤에도 같은 클래스의 구멍이
셋 남아 있었다 — 전부 「파싱 실패를 None이 아니라 *그럴듯한 값*으로 접는」 형태다.

ⓐ **복합 KRW 단위의 접미사 매칭** — 옛 정규식 `단위[^)]*?(조원|억원|백만원|천원|원)`은
   lazy 확장이라 `십억원`에서 `억원`을, `만원`/`천만원`/`십억 원`에서 `원`을 뽑았다.
   `_is_krw`가 True라 자동추출이 그대로 진행돼 **`source='dart'`(최고 신뢰) 행에
   ×1/10 · ×1/10,000 오값**이 저장된다 — 미확정이 아니라 *자신 있게 틀린 단위*다.
   라이브 census(probe327, 실 DART 정기보고서 123건 / susu 표 159개):
     캡션 토큰 `십억원` **25건** + `십억 원` **4건** = **29건 실재**.
     단 그중 susu 표에 인접(거리 ≤ 상한)한 것은 **0건** → 잠재 + 메커니즘 증명 등급.
   처방은 두 갈래다: `십억원`은 **정확한 factor(10.0)로 화이트리스트에 넣고**(실재 29건의
   커버리지를 지킨다), 화이트리스트 밖 통화 토큰(`만원`·`천만원`·`백억원` …)은
   `_UNKNOWN_UNIT`으로 떨어뜨린다(pending → Cowork).

ⓑ **텍스트 폴백이 캡션을 우회** — `_table_unit`이 원거리 캡션을 거부해 `None`을 내면
   `_extract_backlog_blocks`가 그 자리를 **본문 산문의 통화 낱말**로 채웠다. 그래서
   옛 코드가 *정확한* 단위를 냈던 입력에서 새 코드가 *틀린* 단위를 내며, B62가 막으려던
   ×100 오저장이 pending 라벨 경로로 재도입된다(이 unit은 `_save_pending`을 통해
   "이 문서의 단위"로 Cowork에 전달된다). 폴백은 **문서에 '단위' 캡션이 아예 없을 때만**
   허용해야 한다 — 캡션이 존재하는데 원거리라면 그것은 '모른다'이지 '산문을 믿어라'가 아니다.
   라이브 발현: probe327에서 `_table_unit=None` & 원거리 캡션 존재 = **0/159**(무해 확인).

ⓒ **관측 부재** — 단위 미확정으로 pending 강하하는 데 로그·카운터가 하나도 없었다.
   상한이 실문서군의 일부를 놓쳐 `source='dart'`가 pending으로 옮겨가도 어떤 신호도
   나지 않는다(`job_runs`는 예외 전파를 전제하고 이 경로는 예외를 내지 않는다).
"""
import logging
import sys
from pathlib import Path

import pytest
from bs4 import BeautifulSoup

sys.path.insert(0, str(Path(__file__).parent.parent))

FIX = Path(__file__).parent / "fixtures" / "backlog"


def _susu_html(tk="010140"):
    return (FIX / f"{tk}.html").read_text().split("-->", 1)[1]


def _susu_table(doc):
    from services import backlog as svc
    return [t for t in BeautifulSoup(doc, "html.parser").find_all("table")
            if svc._classify_table(t) == "susu"][0]


# ── ⓐ 복합 토큰: 화이트리스트 밖은 미확정 ──

@pytest.mark.parametrize("caption", [
    "(단위 : 만원)",
    "(단위 : 천만원)",
    "(단위 : 백억원)",
    "(단위 : 십조원)",
    "(단위: 만원, %)",
])
def test_unknown_compound_krw_unit_is_undetermined(caption):
    """화이트리스트 밖 복합 통화 토큰은 접미사(`원`·`억원`)로 접지 않고 미확정.

    옛 정규식은 `만원`→`원`(factor 1e-8), `백억원`→`억원`(factor 1.0)을 뽑아
    ×1/10,000,000 · ×1/100 오값을 확정값으로 저장했다.
    """
    from services import backlog as svc
    t = _susu_table(f"<p>{caption}</p>{_susu_html()}")
    unit = svc._table_unit(t)
    assert not svc._is_krw(unit), f"{caption}가 KRW 단위 {unit!r}로 확정됐다"


@pytest.mark.parametrize("caption", [
    "(단위 : 만원)", "(단위 : 천만원)", "(단위 : 백억원)",
])
def test_auto_backlog_refuses_unknown_compound_unit(caption):
    """미확정이므로 자동추출하지 않는다(pending 경로로 흘러야)."""
    from services import backlog as svc
    assert svc._auto_backlog(f"<p>{caption}</p>{_susu_html()}") is None


@pytest.mark.parametrize("caption", ["(단위 : 십억원)", "(단위: 십억원)",
                                     "(단위 : 십억 원)", "(단위 : 십억원, %)",
                                     "(단위 : 만명, 십억원)"])
def test_ten_billion_won_caption_resolves_to_its_own_unit(caption):
    """`십억원`은 실재 29건(probe327)이므로 **정확한 단위로 확정**한다 — `억원`이 아니다.

    옛 코드는 `억원`을 뽑아 ×1/10 오값을 `source='dart'`로 저장했다.
    """
    from services import backlog as svc
    t = _susu_table(f"<p>{caption}</p>{_susu_html()}")
    assert svc._table_unit(t) == "십억원", f"{caption} 오라벨"


def test_ten_billion_won_scales_by_ten_not_one():
    """factor 검산 — 십억원 = 10 억원. 억원으로 오라벨되면 정확값의 1/10이 된다."""
    from services import backlog as svc
    doc = f"<p>(단위 : 십억원)</p>{_susu_html()}"
    assert svc._auto_backlog(doc) == pytest.approx(2951970, abs=5)


@pytest.mark.parametrize("caption,expected", [
    ("(단위 : 억원)", "억원"),
    ("(단위 : 백만원)", "백만원"),
    ("(단위 : 조원)", "조원"),
    ("(단위 : 천원)", "천원"),
    ("(단위 : 원)", "원"),
    ("(단위 :백만원 )", "백만원"),          # 라이브 042660 실캡션(공백 변형)
    ("(단위 : M/T, 백만원)", "백만원"),      # 라이브 103140 실캡션
    ("(단위 : 척, 백만원)", "백만원"),        # 라이브 439260 실캡션
])
def test_whitelisted_units_still_resolve_control(caption, expected):
    """대조군 — 정상 캡션은 계속 그 단위를 낸다(처방이 전부 pending으로 만들지 않았다)."""
    from services import backlog as svc
    t = _susu_table(f"<p>{caption}</p>{_susu_html()}")
    assert svc._table_unit(t) == expected


@pytest.mark.parametrize("text,expected", [
    ("수주잔고는 3,500억원 수준입니다", "억원"),      # 숫자 뒤 — 정상 채택
    ("수주잔고는 116,800,729백만원입니다", "백만원"),
    ("수주잔고는 35십억원 수준입니다", None),          # 복합 접미사 — 채택 금지
    ("수주잔고는 3,500만원 수준입니다", None),
])
def test_text_keyword_fallback_rejects_compound_suffix(text, expected):
    """텍스트 폴백도 같은 함정을 가진다 — `"억원" in "십억원"`은 True다.

    `_UNIT_KEYWORDS` 부분문자열 검사는 `십억원`을 `억원`으로 읽어 ×1/10 오라벨을 만든다.
    """
    from services import backlog as svc
    raw, unit = svc._extract_backlog_blocks(f"{_susu_html()}<p>{text}</p>")
    assert raw, "대조군 — 수주 블록 자체는 추출돼야"
    if expected is None:
        assert not svc._is_krw(unit), f"{text!r}에서 {unit!r}로 확정됐다"
    else:
        assert unit == expected


# ── ⓑ 텍스트 폴백 우회: 캡션이 존재하면 산문을 믿지 않는다 ──

def _doc_with_far_caption():
    """캡션(백만원)이 비공백 노드 4칸 뒤 → 상한 3 밖. 본문 산문은 '억원'을 말한다."""
    return ('<table><tr><td>(단위 : 백만원)</td></tr></table>'
            '<table><tr><td>주1</td><td>주2</td><td>주3</td><td>주4</td></tr></table>'
            + _susu_html()
            + '<p>당사의 수주잔고는 약 3,500억원 수준입니다.</p>')


def test_prose_fallback_does_not_override_existing_far_caption():
    """원거리 캡션이 존재하면 산문 통화 낱말로 단위를 확정하지 않는다.

    실측(수정 전): `_table_unit`=None → 폴백이 '억원'을 채택. 실제 표 단위는 '백만원'이라
    Cowork가 116,800,729(백만원)을 억원으로 읽으면 **100배 과대저장**이 된다.
    """
    from services import backlog as svc
    raw, unit = svc._extract_backlog_blocks(_doc_with_far_caption())
    assert raw, "대조군 — 수주 블록은 추출돼야"
    assert not svc._is_krw(unit), (
        f"원거리 캡션(백만원)이 있는데 산문에서 {unit!r}을 확정했다 — ×100 오저장 경로")


def test_prose_fallback_still_works_when_no_caption_exists_anywhere_control():
    """대조군 — 문서에 '단위' 캡션이 **아예 없으면** 산문 폴백은 계속 유효하다.

    이 축이 없으면 "폴백을 통째로 끄기"라는 과잉 처방이 통과한다(정상 pending 라벨 소실).
    """
    from services import backlog as svc
    raw, unit = svc._extract_backlog_blocks(
        f"{_susu_html()}<p>수주잔고는 116,800,729백만원입니다</p>")
    assert raw and unit == "백만원"


def test_adjacent_caption_beats_prose_control():
    """대조군 — 근거리 캡션이 있으면 그것이 정본이고 산문은 무시된다."""
    from services import backlog as svc
    doc = (f"<p>(단위 : 백만원)</p>{_susu_html()}"
           "<p>수주잔고는 약 3,500억원 수준입니다</p>")
    assert svc._extract_backlog_blocks(doc)[1] == "백만원"


# ── ⓒ 관측: 단위 미확정 pending 강하는 로그로 남는다 ──

def _run_fetch(monkeypatch, doc):
    from services import backlog as svc
    pendings = []
    monkeypatch.setattr(svc, "_get_corp_code", lambda t: "00164478")
    monkeypatch.setattr(svc, "_get_recent_reports", lambda cc: [
        {"rcept_no": "111", "report_nm": "사업보고서 (2025.12)", "rcept_dt": "20260318"}])
    monkeypatch.setattr(svc, "_get_document_text", lambda rc: doc)
    monkeypatch.setattr(svc, "_upsert", lambda t, e: None)
    monkeypatch.setattr(svc, "_save_pending",
                        lambda t, q, u, r: pendings.append((t, q, u, r)))
    monkeypatch.setattr(svc, "get_backlog", lambda t: [])
    monkeypatch.setattr(svc, "get_financials", lambda *a, **k: {})
    monkeypatch.setattr(svc.time, "sleep", lambda s: None)
    svc.fetch_and_save_backlog("000720.KS")
    return pendings


def test_undetermined_unit_pending_is_logged(monkeypatch, caplog):
    """단위 미확정 강하에 grep 앵커가 있어야 배포 후 발생률을 셀 수 있다.

    관측 수단이 0이면 상한이 실문서군을 놓쳐 dart→pending 커버리지가 회귀해도
    「Cowork 대기가 왜 늘었지」로만 드러난다(job_runs는 계속 초록 — 예외가 없다).
    """
    from services import backlog as svc
    with caplog.at_level(logging.INFO, logger="services.backlog"):
        pendings = _run_fetch(monkeypatch, _susu_html())
    assert len(pendings) == 1 and not svc._is_krw(pendings[0][2])
    msgs = [r.getMessage() for r in caplog.records]
    assert any("단위 미확정" in m for m in msgs), msgs
    assert any("000720.KS" in m for m in msgs), msgs


def test_determined_unit_pending_logs_no_marker_control(monkeypatch, caplog):
    """대조군 — 단위가 확정된 pending은 그 마커를 남기지 않는다(강하/확정이 갈린다).

    캡션이 없어 자동추출은 실패하지만(→ pending) 산문 폴백이 단위를 확정한 케이스.
    이 축이 없으면 "모든 pending에 마커를 붙이기"가 통과해 마커가 신호를 잃는다.
    """
    with caplog.at_level(logging.INFO, logger="services.backlog"):
        pendings = _run_fetch(
            monkeypatch, f"{_susu_html()}<p>수주잔고는 116,800,729백만원입니다</p>")
    assert len(pendings) == 1 and pendings[0][2] == "백만원"
    assert not any("단위 미확정" in r.getMessage() for r in caplog.records)

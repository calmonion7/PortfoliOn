"""`_rd_unit`도 근거리 캡션만 믿는다 (적대 검토 F3·F12 — B64의 형제).

B64를 `backlog._table_unit`에서만 닫으면 **같은 함정의 형제가 남는다**:
`market/kr.py::_rd_unit`은 무제한 `table.find_previous(string=re.compile("단위"))`로
문서 전체를 거슬러 올라가 임의 거리의 `(단위 : 백만원)`을 주워 왔다.

`get_rd_intensity_kr`의 2순위 계산 경로는 `if _rd_unit(table) is None: continue`를
**표 오인식 필터**로 쓴다 — 원거리 캡션을 주우면 그 필터가 사실상 무력해져, R&D 표가
아닌 표가 `0 < rd < revenue`만 만족하면 엉뚱한 연구개발비/매출액 비율을 반환한다
(비율은 단위 무관이라 값 자체는 '그럴듯'하고, 어떤 테스트도 이것을 단언하지 않았다).

부수로 `_RD_UNIT_RE`도 `_UNIT_CAPTION_RE`와 같은 접미사 함정을 가졌다
(`십억원`→`억원`). 여기서 unit 값은 게이트로만 쓰이므로 오값이 되지는 않았지만,
두 곳이 서로 다른 캡션 규약을 갖는 것 자체가 다음 사람을 오도한다 —
그래서 `backlog_parser`의 규약(근거리 + `_EOK_FACTOR` 화이트리스트)을 **재사용**한다.
"""
import sys
from pathlib import Path

import pytest
from bs4 import BeautifulSoup

sys.path.insert(0, str(Path(__file__).parent.parent))

_RD_TABLE = "<table><tr><td>연구개발비</td><td>100</td></tr></table>"


def _last_table(doc):
    return BeautifulSoup(doc, "html.parser").find_all("table")[-1]


def _far_doc(caption, filler_cells=8):
    cells = "".join(f"<tr><td>무관항목{i}</td></tr>" for i in range(filler_cells))
    return f"<p>{caption}</p><table>{cells}</table>{_RD_TABLE}"


def test_rd_unit_ignores_distant_caption():
    """무관 섹션의 원거리 캡션은 이 표의 단위가 아니다 → None(게이트가 계속 닫힌다)."""
    from services.market import kr as kr_mod
    assert kr_mod._rd_unit(_last_table(_far_doc("(단위 : 백만원)"))) is None


def test_rd_unit_no_caption_is_none():
    from services.market import kr as kr_mod
    assert kr_mod._rd_unit(_last_table(_RD_TABLE)) is None


@pytest.mark.parametrize("caption", ["(단위 : USD천)", "(단위 : 백만달러)",
                                     "(단위 : 만원)", "(단위 : 천만원)"])
def test_rd_unit_non_krw_or_unknown_compound_is_none(caption):
    """비KRW·화이트리스트 밖 복합단위는 KRW 확정이 아니므로 None."""
    from services.market import kr as kr_mod
    assert kr_mod._rd_unit(_last_table(f"<p>{caption}</p>{_RD_TABLE}")) is None


@pytest.mark.parametrize("caption,expected", [
    ("(단위 : 백만원)", "백만원"),
    ("(단위 : 억원)", "억원"),
    ("(단위 : 천원)", "천원"),
    ("(단위 : 십억원)", "십억원"),
    ("(단위 : 백만원, %)", "백만원"),
])
def test_rd_unit_adjacent_caption_still_resolves_control(caption, expected):
    """대조군 — 근거리 캡션은 계속 확정된다(게이트를 영구히 닫는 과잉 처방 차단).

    이 축이 없으면 "`_rd_unit`이 항상 None을 반환하기"가 통과해 2순위 계산 경로가
    통째로 죽는다(R&D집약도가 조용히 전부 결측이 된다).
    """
    from services.market import kr as kr_mod
    assert kr_mod._rd_unit(_last_table(f"<p>{caption}</p>{_RD_TABLE}")) == expected


def test_rd_unit_shares_the_backlog_caption_regime():
    """캡션 규약이 두 곳에서 갈리지 않는다 — 같은 입력에 같은 KRW 판정."""
    from services.market import kr as kr_mod
    from services import backlog_parser as bp
    for caption in ("(단위 : 백만원)", "(단위 : 십억원)", "(단위 : 만원)",
                    "(단위 : USD천)"):
        t = _last_table(f"<p>{caption}</p>{_RD_TABLE}")
        rd = kr_mod._rd_unit(t)
        bl = bp._table_unit(t)
        assert (rd is not None) == bp._is_krw(bl), (
            f"{caption}: _rd_unit={rd!r} vs _table_unit={bl!r} — 규약이 갈렸다")

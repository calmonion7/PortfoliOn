# backend/tests/test_valid_events_matches_frontend.py
"""VALID_EVENTS ↔ 프론트 발신 이벤트명 교차 대조 (B24 회귀 가드).

`routers/events.py::track_event`는 화이트리스트에 없는 이벤트를 **200 OK로 돌려주고 저장만
생략**한다 — 요청도 콘솔도 서버 로그도 아무 신호를 내지 않으므로, 이 교차 대조 없이는
"프론트가 쏘는데 백엔드가 버린다"를 **원리적으로 관측할 수 없다**. 실사례가 `nav_analytics`다
(task#178 Sidebar→Masthead 이식 때 유입, 그 run.md에 "후속 후보"로만 적힌 채 생존).

⚠️ 수집기는 리터럴만 훑어서는 안 된다 — 이 저장소의 nav 이벤트명은 `section.key`가 아니라
**`section.perm`**에서 파생된다(task#251: key로 파생하면 `nav_schedule`이 되어 이 화이트리스트에서
조용히 탈락한다). 그래서 아래 수집기는 파생 규칙까지 재현하고, **분류되지 않는 호출 형태가
하나라도 나오면 실패**한다(새 파생 형태가 조용히 사각으로 들어오는 것을 막는 이빨).
"""
import re
import sys
from pathlib import Path
from types import SimpleNamespace

import pytest

sys.path.insert(0, str(Path(__file__).parent.parent))

from fastapi import FastAPI
from fastapi.testclient import TestClient
from unittest.mock import patch
from routers.events import router, VALID_EVENTS
from auth import get_current_user

FRONT_SRC = Path(__file__).parent.parent.parent / "frontend" / "src"

# 프론트가 더는 쏘지 않지만 화이트리스트에 남겨 두는 이름 — exact-match 베이스라인
# (`test_api_doc_sync.py::KNOWN_UNDOCUMENTED`와 같은 형태).
#  - tab_holdings·tab_watch: Portfolio 보유/관심 탭이 리포트 탭으로 흡수돼 발신자가 사라졌다.
#  - stock_search: 검색 입력이 Portfolio에서 빠지며 발신이 사라졌다.
# 셋 다 **캐시된 옛 PWA 번들이 아직 쏠 수 있으므로** 화이트리스트에서 빼지 않는다 — 빼는 순간
# 그 텔레메트리가 무음 폐기되고, 그게 이 파일이 막으려는 바로 그 클래스다.
RETIRED_EVENTS = {"tab_holdings", "tab_watch", "stock_search"}

# ⚠️ 인용부호는 **단·쌍·백틱 모두** 받는다 — 단일 인용부호만 보면 새 이벤트를 `evt: "tab_new"`로
# 정의하는 순간 그 이름이 수확에서 조용히 빠지고, 호출 지점은 `trackEvent(it.evt)`라 "분류됨"이므로
# `test_every_trackevent_call_site_is_classified` 이빨도 못 본다. 즉 좁은 패턴은 **정확히 B24가
# 재발하는 방향에서만** 무음이다(화이트리스트 등록을 잊은 경우 ⊆ 축이 공허 통과). `assert evt_fields`
# sentinel도 *전부* 쌍따옴표인 경우만 잡으므로 한 건 섞이면 안 걸린다.
# (가토 「감사 패턴을 좁히면 그 감사는 통과해도 무의미하다」의 자기적용.)
_Q = r"['\"`]"
_CALL = re.compile(r"\btrackEvent\s*\(")
_EVT_FIELD = re.compile(r"\bevt\s*:\s*" + _Q + r"([a-z0-9_]+)" + _Q)
_PERM_FIELD = re.compile(r"\bperm\s*:\s*" + _Q + r"([a-z0-9_]+)" + _Q)
_ARG_LITERAL = re.compile(r"^" + _Q + r"([a-z0-9_]+)" + _Q + r"$")
_ARG_FIELD_REF = re.compile(r"^\w+\.evt$")
_ARG_PERM_CONCAT = re.compile(r"^" + _Q + r"([a-z0-9_]+)" + _Q + r"\s*\+\s*\w+\.perm$")


def _first_arg(text, pos):
    """`trackEvent(` 여는 괄호 다음부터 최상위 `,` 또는 닫는 `)`까지 = 첫 인자."""
    depth, out = 0, []
    for ch in text[pos:]:
        if ch in "([{":
            depth += 1
        elif ch in ")]}":
            if depth == 0:
                break
            depth -= 1
        elif ch == "," and depth == 0:
            break
        out.append(ch)
    return "".join(out).strip()


def _sources(src_root):
    for path in sorted(Path(src_root).rglob("*")):
        if path.suffix not in (".js", ".jsx"):
            continue
        if "test" in path.relative_to(src_root).parts[:-1]:
            continue  # 테스트는 발신자가 아니다(모킹만 한다)
        yield path


def collect_frontend_events(src_root):
    """프론트가 실제로 발신하는 이벤트명 집합 + 미분류 호출 지점.

    수확이 비면 **실패**한다 — 빈 집합끼리 `==`로 통과하는 무이빨 형태가 이 저장소의
    반복 함정이라, 그 방향을 수집기 안에서 막는다(가토: "0을 성공으로 읽는 게이트").
    """
    literals, evt_fields, perms, prefixes, unclassified = set(), set(), set(), set(), []
    scanned = 0
    for path in _sources(src_root):
        scanned += 1
        text = path.read_text(encoding="utf-8")
        evt_fields |= set(_EVT_FIELD.findall(text))
        perms |= set(_PERM_FIELD.findall(text))
        for m in _CALL.finditer(text):
            if text[: m.start()].rstrip().endswith("function"):
                continue  # utils/analytics.js의 정의부
            arg = _first_arg(text, m.end())
            lit = _ARG_LITERAL.match(arg)
            concat = _ARG_PERM_CONCAT.match(arg)
            if lit:
                literals.add(lit.group(1))
            elif _ARG_FIELD_REF.match(arg):
                pass  # 이름은 `evt:` 필드 수확이 덮는다
            elif concat:
                prefixes.add(concat.group(1))
            else:
                unclassified.append("{}: trackEvent({})".format(path.name, arg))

    assert scanned, "프론트 소스를 하나도 못 읽었다 — 경로 오류: {}".format(src_root)
    assert literals, "trackEvent 리터럴 수확 0건 — 수집기가 프론트를 못 읽었다"
    assert evt_fields, "`evt:` 필드 수확 0건 — 수집기가 프론트를 못 읽었다"
    assert prefixes and perms, "perm 파생 규칙 수확 0건 — 수집기가 프론트를 못 읽었다"

    derived = {p + perm for p in prefixes for perm in perms}
    return SimpleNamespace(
        names=literals | evt_fields | derived,
        literals=literals,
        evt_fields=evt_fields,
        derived=derived,
        unclassified=unclassified,
        scanned=scanned,
    )


def test_every_frontend_event_is_whitelisted():
    """ⓐ B24 본체 — 프론트가 쏘는 이름이 전부 화이트리스트에 있어야 한다."""
    found = collect_frontend_events(FRONT_SRC)
    dropped = found.names - VALID_EVENTS
    assert not dropped, (
        "프론트가 쏘지만 VALID_EVENTS에 없어 200 OK로 무음 폐기되는 이벤트: "
        "{} (수확 {}개 / 파일 {}개)".format(sorted(dropped), len(found.names), found.scanned)
    )


def test_whitelist_has_no_unexplained_extras():
    """반대 방향 — 화이트리스트에만 있는 이름은 RETIRED_EVENTS와 정확히 일치해야 한다."""
    found = collect_frontend_events(FRONT_SRC)
    assert VALID_EVENTS - found.names == RETIRED_EVENTS, (
        "화이트리스트 잔여가 베이스라인과 다르다 — 실제={} 기대={}".format(
            sorted(VALID_EVENTS - found.names), sorted(RETIRED_EVENTS)
        )
    )


def test_collector_fails_when_nothing_is_harvested(tmp_path):
    """대조군(무이빨 방지) — 수확이 비면 통과가 아니라 **실패**여야 한다.

    이 축이 없으면 위 두 테스트는 "프론트를 한 글자도 못 읽었다"를 초록으로 보고한다
    (빈 집합 - 화이트리스트 = 빈 집합이라 `not dropped`가 참이 된다).
    """
    (tmp_path / "empty.jsx").write_text("export default function X(){ return null }\n")
    with pytest.raises(AssertionError):
        collect_frontend_events(tmp_path)


def test_every_trackevent_call_site_is_classified():
    """이빨 — 알려진 3형태(리터럴 · `X.evt` · `'접두'+X.perm`) 밖의 호출은 실패로 드러난다.

    새 파생 형태가 들어오면 그 이름은 수확되지 않으므로, 여기서 막지 않으면 위 대조가
    "그 이름은 애초에 없는 것"으로 취급해 조용히 통과한다.
    """
    found = collect_frontend_events(FRONT_SRC)
    assert not found.unclassified, (
        "분류되지 않은 trackEvent 호출: {} — 이 형태의 이름은 수확되지 않아 "
        "화이트리스트 대조를 우회한다".format(found.unclassified)
    )


def test_each_extraction_rule_actually_fired():
    """커버리지 sentinel — 3규칙이 각각 실제로 이름을 하나씩 냈는지 서로 겹치지 않는 표본으로 못박는다."""
    found = collect_frontend_events(FRONT_SRC)
    # report_view_open: Reports.jsx 리터럴만 (evt 필드에도, perm 파생에도 없다)
    assert "report_view_open" in found.literals
    # tab_calendar: navSections의 `evt:` 필드만 (리터럴로 쓰인 곳이 없다)
    assert "tab_calendar" in found.evt_fields
    # nav_research: `perm: 'research'` 파생만 (리터럴 'nav_research'는 코드에 없다)
    assert "nav_research" in found.derived
    assert "nav_research" not in found.literals


def test_nav_analytics_is_persisted():
    """ⓐ 행동 축 — B24가 실제로 관측하던 증상(요청은 200인데 저장이 안 된다)."""
    app = FastAPI()
    app.include_router(router)
    app.dependency_overrides[get_current_user] = lambda: "user-1"
    client = TestClient(app)
    with patch("routers.events._persist") as mock_persist:
        resp = client.post("/api/events", json={"event_name": "nav_analytics", "properties": {}})
    assert resp.status_code == 200
    assert mock_persist.called, "nav_analytics가 화이트리스트에서 탈락해 저장되지 않았다"


def _synthetic_tree(tmp_path, extra=""):
    """3규칙을 각각 정확히 한 번씩 담은 최소 트리 — 수집기 자체의 이빨을 재는 정의역."""
    (tmp_path / "navSections.js").write_text(
        "export const NAV_SECTIONS = [{ key: 'x', perm: 'research', "
        "items: [{ to: '/r', evt: 'tab_calendar' }] }]\n",
        encoding="utf-8",
    )
    (tmp_path / "Nav.jsx").write_text(
        "onClick={() => trackEvent('nav_' + section.perm)}\n"
        "onClick={() => trackEvent('report_view_open', { ticker })}\n"
        "onClick={() => trackEvent(item.evt)}\n" + extra,
        encoding="utf-8",
    )
    return tmp_path


def test_collector_identity_on_synthetic_tree(tmp_path):
    """identity — 3규칙이 합쳐져 정확히 3개 이름을 낸다(과잉·누락 둘 다 잡는다)."""
    found = collect_frontend_events(_synthetic_tree(tmp_path))
    assert found.names == {"nav_research", "tab_calendar", "report_view_open"}
    assert found.unclassified == []


def test_unknown_call_form_is_reported_not_silently_dropped(tmp_path):
    """이빨 — 4번째 호출 형태는 이름을 못 내므로 반드시 미분류로 보고돼야 한다.

    이 축이 없으면 새 파생 형태(`trackEvent(EVENTS.x)` 등)가 들어와도 수집기가 그 이름을
    모르는 채 조용히 지나가고, 위 화이트리스트 대조는 "없는 이름"으로 취급해 통과한다.
    """
    found = collect_frontend_events(_synthetic_tree(tmp_path, "trackEvent(EVENTS.newThing)\n"))
    assert found.unclassified, "미분류 호출 형태가 보고되지 않았다 — 수집기에 이빨이 없다"


def test_double_quoted_evt_field_is_harvested(tmp_path):
    """이빨 — 쌍따옴표로 정의한 `evt`도 수확된다(좁은 패턴 재발 가드).

    수집기가 단일 인용부호만 보던 판에서는 이 트리가 `{"nav_research", "report_view_open"}`만 내고
    `tab_new`는 **조용히 사라졌다**. 그러면 화이트리스트 등록을 잊어도 대조가 통과한다 —
    정확히 B24가 재발하는 방향에서만 무음인 사각이다.
    """
    tree = _synthetic_tree(tmp_path)
    (tree / "extra.js").write_text(
        'export const X = [{ to: "/n", evt: "tab_new" }]\n', encoding="utf-8"
    )
    found = collect_frontend_events(tree)
    assert "tab_new" in found.evt_fields, "쌍따옴표 `evt:`가 수확되지 않았다"


# ── ⓑ 세 번째 대조축: admin 표시 라벨 ⊇ 화이트리스트 ────────────────────────────
# 위 두 대조가 "프론트가 쏘는 이름 ↔ 백엔드가 저장하는 이름"이라면, 이것은 **저장한 것을 관리
# 화면이 읽을 수 있는가**다. 라벨이 없으면 `AdminAnalytics.jsx`의 `eName` 폴백이 원시 영문 키를
# 한글 라벨 사이에 렌더한다 — 크래시가 아니라 graceful 폴백이라 어떤 자동 게이트도 알리지 않는다.
_LABEL_BLOCK = re.compile(r"const EVENT_LABELS = \{(.*?)\n\}", re.S)
_LABEL_KEY = re.compile(r"^\s*([a-z0-9_]+)\s*:", re.M)


def _admin_event_labels():
    path = FRONT_SRC / "pages" / "AdminAnalytics.jsx"
    block = _LABEL_BLOCK.search(path.read_text(encoding="utf-8"))
    assert block, "EVENT_LABELS 블록을 못 찾았다 — 수집기 패턴이 스테일하다: {}".format(path)
    keys = set(_LABEL_KEY.findall(block.group(1)))
    assert keys, "EVENT_LABELS 키 수확 0건 — 빈 집합끼리 통과하는 무이빨 형태를 막는다"
    return keys


def test_admin_labels_cover_whitelist():
    missing = VALID_EVENTS - _admin_event_labels()
    assert not missing, (
        "VALID_EVENTS에 있으나 AdminAnalytics EVENT_LABELS에 라벨이 없어 원시 영문 키로 "
        "렌더되는 이벤트: {}".format(sorted(missing))
    )


def test_admin_label_extras_are_middleware_events():
    """반대 방향 — 라벨에만 있는 이름은 화이트리스트를 우회해 직접 INSERT하는 5종이어야 한다.

    `middleware/event_tracker.py::_TRACKED`가 그 출처다. 이 베이스라인이 틀리면 라벨이
    실제로 나타날 수 없는 이름을 설명 없이 담고 있다는 뜻이다.
    """
    extras = _admin_event_labels() - VALID_EVENTS
    assert extras == {
        "stock_add", "stock_delete", "stock_promote", "report_generate", "guru_crawl",
    }, "라벨 잔여가 미들웨어 직접 INSERT 5종과 다르다 — 실제={}".format(sorted(extras))

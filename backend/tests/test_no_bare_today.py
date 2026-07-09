"""bare date.today()/datetime.today() 스윕 가드 (S2, CLAUDE.md gotcha/task#157).

컨테이너는 UTC라 bare date.today()/datetime.today()는 00~09시 KST에 하루 어긋난다.
앱 코드는 services.utils.today_kst() 사용. ast로 실제 .today() 호출 노드만 탐지 —
docstring/주석에서 이 규약을 설명하는 문구는 오탐 없음.
tests/·scripts/·data/는 앱 코드가 아니라 대상 외.
"""
import ast
import pathlib

_BACKEND = pathlib.Path(__file__).resolve().parent.parent
_APP_TARGETS = ["main.py", "routers", "services", "scheduler", "middleware"]


def _iter_app_py():
    for entry in _APP_TARGETS:
        p = _BACKEND / entry
        if p.is_file():
            yield p
        elif p.is_dir():
            yield from p.rglob("*.py")


def test_no_bare_today_in_app_code():
    offenders = []
    for f in _iter_app_py():
        tree = ast.parse(f.read_text(encoding="utf-8"), filename=str(f))
        for node in ast.walk(tree):
            if (
                isinstance(node, ast.Call)
                and isinstance(node.func, ast.Attribute)
                and node.func.attr == "today"
            ):
                offenders.append(f"{f.relative_to(_BACKEND)}:{node.lineno}")
    assert not offenders, (
        "bare date.today()/datetime.today() 발견 — services.utils.today_kst() 사용 "
        "(CLAUDE.md gotcha/task#157):\n" + "\n".join(offenders)
    )

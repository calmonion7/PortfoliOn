"""로깅 방출 규약 가드 (task#163, CONVENTIONS §4).

앱 코드는 print() 대신 모듈 logger를 쓴다. 신규 print가 새어들면 이 테스트가 즉시 실패한다.
ast로 print() 호출 노드만 탐지 — 문자열/주석/pprint 등 오탐 없음.
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


def test_no_print_in_app_code():
    offenders = []
    for f in _iter_app_py():
        tree = ast.parse(f.read_text(encoding="utf-8"), filename=str(f))
        for node in ast.walk(tree):
            if (
                isinstance(node, ast.Call)
                and isinstance(node.func, ast.Name)
                and node.func.id == "print"
            ):
                offenders.append(f"{f.relative_to(_BACKEND)}:{node.lineno}")
    assert not offenders, (
        "print() 발견 — 앱 코드는 logger 사용 (CONVENTIONS §4):\n" + "\n".join(offenders)
    )

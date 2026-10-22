"""렌즈 발행 음성 테스트 재발 가드 (task#401).

발행 엔드포인트 422 테스트는 상태코드만 보지 말고 `tests._reject.assert_rejected`로 *사유*를 단언한다 —
검증을 조이면 옛 모양 픽스처가 엉뚱한 사유로 422를 받아 거짓 통과한다(task#392).
ast로 `.status_code`를 422 리터럴 또는 비리터럴(매개변수 `status` 등)과 비교하는 Compare 노드를 찾는다.
피연산자 순서(`422 == r.status_code`)와 무관하다. 201·404 등 다른 리터럴 비교는 대상 외.
"""
import ast
import pathlib

_TESTS = pathlib.Path(__file__).resolve().parent
_TARGETS = ["test_analyst_report_lenses.py", "test_analyst_reports.py"]


def _status_only_compares(tree):
    for node in ast.walk(tree):
        if not isinstance(node, ast.Compare):
            continue
        operands = [node.left, *node.comparators]
        for i, o in enumerate(operands):
            if isinstance(o, ast.Attribute) and o.attr == "status_code":
                others = operands[:i] + operands[i + 1:]
                if any(not isinstance(x, ast.Constant) or x.value == 422 for x in others):
                    yield node.lineno
                    break


def test_publish_422_asserts_check_reason():
    offenders = []
    for name in _TARGETS:
        f = _TESTS / name
        tree = ast.parse(f.read_text(encoding="utf-8"), filename=str(f))
        offenders += [f"{name}:{n}" for n in _status_only_compares(tree)]
    assert not offenders, (
        "상태코드만 보는 422 단언 발견 — tests._reject.assert_rejected 로 사유까지 단언할 것(task#392·401):\n"
        + "\n".join(offenders)
    )

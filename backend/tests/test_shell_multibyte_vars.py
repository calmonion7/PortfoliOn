"""셸 스크립트에서 `$이름` 바로 뒤에 비ASCII 문자가 붙으면 안 된다(task#386 회고).

UTF-8 로케일의 bash는 `"$BE_L·$NG_L"`의 `·`(U+00B7) 첫 바이트를 변수명으로 읽는다 → `set -u`면
`BE_L�: unbound variable`로 즉사한다. `bash -n`은 구문이 유효해 통과하므로 실행 경로에 닿아야만 터진다
(task#386 컷오버 스크립트의 `--remove-legacy`가 실제로 그렇게 죽었다). 이 레포의 스크립트는 한국어 메시지가
많아 재발하기 쉽다 — 그 자리에선 `${BE_L}`처럼 중괄호를 쓸 것.
"""
import re
import subprocess
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
# `$` + 변수명 + 곧바로 비ASCII. `${…}`·`$1`은 걸리지 않는다.
TRAP = re.compile(r"\$[A-Za-z_][A-Za-z0-9_]*[^\x00-\x7f]")


def test_pattern_has_teeth():
    assert TRAP.search('echo "$BE_L·$NG_L"')
    assert TRAP.search('echo "asset=$A→200"')
    assert not TRAP.search('echo "${BE_L}·${NG_L}"')
    assert not TRAP.search('echo "$BE_L · $NG_L"')


def test_no_multibyte_char_right_after_shell_var():
    files = subprocess.run(
        ["git", "ls-files", "*.sh"], cwd=REPO, capture_output=True, text=True, check=True
    ).stdout.split()
    assert files, "추적되는 .sh 가 0개 — git ls-files 경로가 틀렸다(공허 통과 방지)"
    hits = [
        f"{f}:{n}: {line.strip()}"
        for f in files
        for n, line in enumerate((REPO / f).read_text(encoding="utf-8").splitlines(), 1)
        if TRAP.search(line)
    ]
    assert not hits, "변수 뒤 비ASCII — ${VAR}로 감쌀 것:\n" + "\n".join(hits)

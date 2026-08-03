"""트리거 해석 규칙(범위:)이 프롬프트 파일에 정밀화돼 있는지 확인 (task S2).

배경: 트리거 지시가 정책을 일부만 열거하면 그 열거가 곧 범위로 오독돼
나머지 정책(예: 선도기술)이 통째 스킵되는 버그가 있었다. 고칠 것은
"트리거 우선" 문구를 "특정 정책 명시가 없으면 전부 검토"로 정밀화하는 것.
"""
import re
from pathlib import Path
from typing import Optional

PROMPT_PATH = Path(__file__).resolve().parents[2] / "scripts" / "cowork-routine-prompt.md"


def _read_prompt() -> str:
    return PROMPT_PATH.read_text(encoding="utf-8")


def _scope_line(text: str) -> Optional[str]:
    for line in text.splitlines():
        if line.startswith("범위:"):
            return line
    return None


def test_scope_marker_line_states_review_all_unless_explicit_override():
    """(a) '범위:'로 시작하는 마커 줄이 있고, '특정 정책 명시가 없으면 전부 검토'를 말한다."""
    text = _read_prompt()
    line = _scope_line(text)
    assert line is not None, "프롬프트에 '범위:'로 시작하는 마커 줄이 없다"
    assert "전부 검토" in line, f"범위 줄이 '전부 검토'를 말하지 않는다: {line!r}"
    assert "특정" in line and "명시" in line, (
        f"범위 줄이 '특정 정책 명시' 조건을 담고 있지 않다: {line!r}"
    )


def test_scope_marker_preserves_explicit_reassignment_escape_hatch():
    """명시적 재지정(특정 종목 발행 지시 등) 탈출구가 그대로 남아 있어야 한다."""
    text = _read_prompt()
    line = _scope_line(text)
    assert line is not None
    assert "재지정" in line or "명시" in line


_SECTION_HEADER_RE = re.compile(r"^==\s*\d+\)\s*.+?==\s*$", re.MULTILINE)


def test_policy_sections_sentinel_at_least_three_including_tech_report():
    """(b) sentinel — '== N) ... ==' 정책 섹션이 3개 이상이고 그중 하나가 선도기술을 담는다.

    하한(>=3)으로 판정 — 정확일치면 정당한 섹션 추가에 거짓 FAIL한다.
    섹션이 사라지거나 파싱이 깨지면 이 단언이 실패해야 한다.
    """
    text = _read_prompt()
    headers = _SECTION_HEADER_RE.findall(text)
    assert len(headers) >= 3, f"정책 섹션이 3개 미만이다: {headers!r}"
    assert any("선도기술" in h for h in headers), (
        f"선도기술 섹션이 없다: {headers!r}"
    )


def test_policy_section_regex_has_teeth():
    """(b)의 sentinel이 이빨을 가짐을 실증 — 섹션 헤더 형식이 깨지면 실패해야 한다."""
    broken = "1) enrich\n2) 애널리스트\n3) 선도기술\n"  # '==' 없는 형태
    headers = _SECTION_HEADER_RE.findall(broken)
    assert len(headers) < 3, (
        "섹션 헤더 정규식이 '==' 없는 파손 형태도 통과시킨다 — sentinel이 이빨이 없다"
    )


def test_common_rules_ask_reason_for_skipped_policies():
    """(c) 공통 규칙에 '건너뛴 정책은 이유를 한 줄로' 남기라는 지시가 있다."""
    text = _read_prompt()
    assert "공통 규칙" in text
    common_section = text.split("공통 규칙", 1)[1]
    assert "수행하지 않은 정책" in common_section or "건너뛴 정책" in common_section
    assert "이유" in common_section

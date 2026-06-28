"""TDD: parse_agm_meeting_date — 주총 일시 파서 fixture 테스트.

Real doc slices from the spike (see task spec). Strategy order:
  structured_table (소집결의) → free_text_ilsi (소집공고) → fallback.
"""
import sys
from datetime import date
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

from services.agm import parse_agm_meeting_date


# ── Fixture 1: 소집결의 — structured_table strategy ──

SOZIP_GYEOLUI_SLICE = (
    'an> </td> \r\n      </tr> \r\n      <tr> \r\n'
    '       <td colspan="2" width="225"> <span style="width:225px;font-size:10pt;">2. 일시</span> </td> \r\n'
    '       <td width="139"> <span class="xforms_input" style="width:139px;font-size:10pt;">2026-03-18</span> </td> \r\n'
    '       <td width="236"> <span class="xforms_input" style="width:236px;font-size:10pt;">09 : 00</span> </td> \r\n'
    '      </tr> \r\n      <tr> \r\n'
    '       <td colspan="2" width="22'
)


def test_structured_table_extracts_iso_date():
    result = parse_agm_meeting_date(SOZIP_GYEOLUI_SLICE)
    assert result == date(2026, 3, 18)


# ── Fixture 2: 소집공고 — free_text_ilsi strategy (HTML tag between ':' and date) ──

SOZIP_GONGGGO_SLICE = (
    '----------</P>\n<P></P>\n\n<P>\n'
    '<SPAN USERMARK="B">1. 일    시 :</SPAN> 2026년 3월 25일(수) 오전 10시\n'
    '</P>\n\n<P>\n'
    '<SPAN USERMARK="B">2. 장    소 : </SPAN>경기도 이천시 부발읍 경충대로 2091'
    '                  에스케이하이닉스 주식회사 본사 SUPEX C'
)


def test_free_text_ilsi_with_html_tag_gap():
    """HTML </SPAN> appears between '일 시 :' and '2026년' — regex must absorb it."""
    result = parse_agm_meeting_date(SOZIP_GONGGGO_SLICE)
    assert result == date(2026, 3, 25)


# ── Strategy priority: structured_table wins over free_text when both present ──

def test_structured_table_takes_priority_over_free_text():
    combined = SOZIP_GYEOLUI_SLICE + "\n" + SOZIP_GONGGGO_SLICE
    result = parse_agm_meeting_date(combined)
    # structured_table (2026-03-18) should win, not free_text (2026-03-25)
    assert result == date(2026, 3, 18)


# ── Returns None on empty / no match ──

def test_returns_none_when_no_date_found():
    assert parse_agm_meeting_date("") is None
    assert parse_agm_meeting_date("아무 날짜도 없는 문서입니다.") is None


# ── Validation guard: year out of range ──

def test_validation_guard_rejects_out_of_range():
    bad = '2. 일시\n1999-12-31'  # year < 2000
    assert parse_agm_meeting_date(bad) is None


def test_invalid_calendar_date_returns_none_not_exception():
    """_valid() allows day≤31, but date(2026, 2, 30) would raise ValueError without guard."""
    bad_iso = '2. 일시\n2026-02-30'
    assert parse_agm_meeting_date(bad_iso) is None
    bad_kr = '본 주주총회는 2026년 2월 30일에 열립니다.'
    assert parse_agm_meeting_date(bad_kr) is None


# ── Fallback strategy: first KR date after 주주총회 ──

FALLBACK_SLICE = (
    "본 주주총회는 다음과 같이 개최됩니다.\n"
    "2026년 4월 5일 오전 9시에 서울 여의도에서 열립니다."
)


def test_fallback_kr_date_after_agm_mention():
    result = parse_agm_meeting_date(FALLBACK_SLICE)
    assert result == date(2026, 4, 5)

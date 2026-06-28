"""주총(AGM) 일시 추출·저장 배치.

parse_agm_meeting_date: document.xml 텍스트 → date | None
fetch_agm_meeting_dates: KR 보유·관심 종목의 주총 공시에서 meeting_date를 DB에 upsert

배치 id: agm_fetch (batch_registry 등록, KR 전용, DART_API_KEY 필수)
저장: stock_disclosures.meeting_date (ticker, rcept_no 기준 upsert)

전략 우선순위:

전략 우선순위:
  1. structured_table: '2. 일시 … YYYY-MM-DD' (소집결의 XHTML 테이블)
  2. free_text_ilsi: '일    시 : …2026년 3월 25일' (소집공고 자유 텍스트; HTML 태그 허용)
  3. fallback: '주주총회' 첫 등장 후 600자 이내 첫 한국어 날짜

추출 실패 시 None 반환(wrong < missing — 기본값/추측 금지).
검증 가드: year 2000–2100, month 1–12, day 1–31.
"""
from __future__ import annotations

import logging
import os
import re
import time
from datetime import date

import requests

logger = logging.getLogger(__name__)

# ── 전략 1: 소집결의 XHTML 구조 테이블 ──────────────────────────────────────
# '2. 일시' 레이블 셀 직후 xforms_input 셀의 ISO 날짜
STRUCT_TABLE_RE = re.compile(
    r"2\.\s*일\s*시\b.*?(\d{4}-\d{2}-\d{2})",
    re.DOTALL,
)

# ── 전략 2: 소집공고 자유 텍스트 ────────────────────────────────────────────
# '일    시 :' (공백 최대 6개) → 닫는 HTML 태그 선택적 허용 → 한국어 날짜
FREE_ILSI_RE = re.compile(
    r"일\s{0,6}시\s*[:：]\s*(?:<[^>]*>\s*)*(\d{4}\s*년\s*\d{1,2}\s*월\s*\d{1,2}\s*일)",
)
KR_DATE_RE = re.compile(r"(\d{4})\s*년\s*(\d{1,2})\s*월\s*(\d{1,2})\s*일")

# ── 전략 3: 폴백 — '주주총회' 이후 600자 이내 첫 한국어 날짜 ────────────────
_AGM_MARK = "주주총회"
_FALLBACK_WINDOW = 600


def _valid(year: int, month: int, day: int) -> bool:
    return 2000 <= year <= 2100 and 1 <= month <= 12 and 1 <= day <= 31


def _from_iso(m: re.Match) -> date | None:
    parts = m.group(1).split("-")
    if len(parts) != 3:
        return None
    y, mo, d = int(parts[0]), int(parts[1]), int(parts[2])
    if not _valid(y, mo, d):
        return None
    try:
        return date(y, mo, d)
    except ValueError:
        return None  # eco: _valid allows day≤31 but date() rejects e.g. Feb 30


def _from_kr(text: str) -> date | None:
    m = KR_DATE_RE.search(text)
    if not m:
        return None
    y, mo, d = int(m.group(1)), int(m.group(2)), int(m.group(3))
    if not _valid(y, mo, d):
        return None
    try:
        return date(y, mo, d)
    except ValueError:
        return None  # eco: same guard as _from_iso


def parse_agm_meeting_date(document_text: str) -> date | None:
    """document.xml 텍스트에서 주총 개최일을 추출한다. 실패 시 None."""
    if not document_text:
        return None

    # 전략 1: 구조 테이블 ISO 날짜
    m = STRUCT_TABLE_RE.search(document_text)
    if m:
        result = _from_iso(m)
        if result:
            return result

    # 전략 2: 자유 텍스트 '일    시 :' 레이블
    m2 = FREE_ILSI_RE.search(document_text)
    if m2:
        result = _from_kr(m2.group(1))
        if result:
            return result

    # 전략 3: 폴백 — '주주총회' 이후 첫 한국어 날짜
    idx = document_text.find(_AGM_MARK)
    if idx != -1:
        window = document_text[idx: idx + _FALLBACK_WINDOW]
        result = _from_kr(window)
        if result:
            return result

    return None


# ── 배치: KR 보유·관심 주총 공시 → meeting_date upsert ───────────────────────

_DART_BASE = "https://opendart.fss.or.kr/api"
_DART_THROTTLE = 0.3  # 초; DART 공손한 직렬 throttle


def _dart_key() -> str:
    return os.environ.get("DART_API_KEY", "")


def _fetch_agm_list(corp_code: str) -> list[dict]:
    """corp_code의 전체 기간 주총 공시 목록(no pblntf_ty, '주주총회' 필터).

    발견: pblntf_ty를 지정하면 주총 공시가 0건 반환된다 → 미지정 호출 후 직접 필터.
    """
    try:
        resp = requests.get(
            f"{_DART_BASE}/list.json",
            params={
                "crtfc_key": _dart_key(),
                "corp_code": corp_code,
                "page_count": 100,
            },
            timeout=15,
        )
        data = resp.json()
    except Exception as e:
        logger.warning(f"[AGM] list.json 조회 실패 (corp={corp_code}): {e}")
        return []
    if data.get("status") != "000":
        return []
    return [
        item for item in data.get("list", [])
        if "주주총회" in (item.get("report_nm") or "")
    ]


def _select_best(items: list[dict]) -> dict | None:
    """소집결의 → 소집공고 → 기타 주주총회 순서로 최신 항목 선택."""
    for keyword in ("소집결의", "소집공고", "주주총회"):
        matched = [i for i in items if keyword in (i.get("report_nm") or "")]
        if matched:
            return max(matched, key=lambda i: i.get("rcept_no") or "")
    return None


def fetch_agm_meeting_dates() -> dict:
    """KR 보유·관심 종목 전체의 주총 공시에서 meeting_date를 추출·저장.

    DART_API_KEY 미설정 시 graceful skip(휴면). KR 전용·직렬.
    반환: {total, updated, failed}
    """
    if not _dart_key():
        logger.info("[AGM] DART_API_KEY 미설정 — skip")
        return {"total": 0, "updated": 0, "failed": 0}

    from services.backlog import _get_corp_code_map
    from services.db import execute, query

    tickers = [r["ticker"] for r in query(
        "SELECT DISTINCT us.ticker FROM user_stocks us "
        "JOIN tickers t ON us.ticker = t.ticker "
        "WHERE t.market = 'KR' AND us.type IN ('holding', 'watchlist')"
    )]

    corp_map = _get_corp_code_map()
    updated = 0
    failed = 0

    for ticker in tickers:
        code = ticker.upper().replace(".KS", "").replace(".KQ", "")
        corp_code = corp_map.get(code)
        if not corp_code:
            continue

        try:
            items = _fetch_agm_list(corp_code)
            time.sleep(_DART_THROTTLE)
            if not items:
                continue

            best = _select_best(items)
            if not best:
                continue

            rcept_no = (best.get("rcept_no") or "").strip()
            if not rcept_no:
                continue

            # 증분 + 매년 갱신 안전: 최신 주총 공시(rcept_no)가 이미 해결돼 있으면
            # 비싼 document fetch 스킵. 연도별 신규 주총은 새 rcept_no라 미해결 → 재fetch.
            if query(
                "SELECT 1 FROM stock_disclosures WHERE rcept_no = %s AND meeting_date IS NOT NULL",
                (rcept_no,),
            ):
                continue

            from services.backlog import _get_document_text
            text = _get_document_text(rcept_no)
            time.sleep(_DART_THROTTLE)

            meeting_date = parse_agm_meeting_date(text)
            if meeting_date is None:
                logger.info(f"[AGM] 날짜 추출 실패: {ticker} rcept_no={rcept_no}")
                continue

            # rcept_no가 stock_disclosures에 없으면 먼저 삽입, 있으면 meeting_date만 갱신
            execute(
                """
                INSERT INTO stock_disclosures
                    (ticker, rcept_no, rcept_dt, report_nm, pblntf_ty, corp_name, meeting_date, fetched_at)
                VALUES (%s, %s, %s, %s, %s, %s, %s, NOW())
                ON CONFLICT (rcept_no) DO UPDATE SET
                    meeting_date = EXCLUDED.meeting_date,
                    fetched_at   = NOW()
                """,
                (
                    ticker.upper(),
                    rcept_no,
                    (best.get("rcept_dt") or "").strip() or None,
                    (best.get("report_nm") or "").strip(),
                    None,  # pblntf_ty: no-type query라 알 수 없음
                    (best.get("corp_name") or "").strip(),
                    meeting_date,
                ),
            )
            updated += 1
            logger.info(f"[AGM] {ticker} meeting_date={meeting_date}")

        except Exception as e:
            failed += 1
            logger.warning(f"[AGM] {ticker} 실패: {e}")

    logger.info(f"[AGM] fetch_agm_meeting_dates: {updated}/{len(tickers)} updated, {failed} failed")
    return {"total": len(tickers), "updated": updated, "failed": failed}

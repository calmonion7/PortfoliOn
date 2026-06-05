"""
DART 수주잔고(Order Backlog) 수집 서비스.

흐름:
1. corpCode.xml → {stock_code: corp_code} 매핑 (메모리 캐시, 1주일)
2. list.json → 최근 4개 사업/반기/분기보고서 rcept_no
3. index.json → "수주" 포함 섹션 찾기
4. 섹션 HTML → BeautifulSoup 테이블 파싱
5. 파싱 실패 시 → source='pending', raw_text DB 저장 (Claude Cowork 방식)
6. backlog_history 테이블에 upsert
"""
from __future__ import annotations

import io
import logging
import os
import re
import time
import zipfile
from datetime import datetime, timedelta
from typing import Optional
from xml.etree import ElementTree as ET

import requests
from bs4 import BeautifulSoup

from services.db import execute, query

logger = logging.getLogger(__name__)

_DART_BASE = "https://opendart.fss.or.kr/api"
_CORP_CODE_URL = f"{_DART_BASE}/corpCode.xml"

# 메모리 캐시
_corp_code_cache: dict[str, str] = {}
_corp_code_cached_at: Optional[datetime] = None
_CORP_CODE_TTL = timedelta(weeks=1)


def _dart_key() -> str:
    return os.environ.get("DART_API_KEY", "")


def _get_corp_code_map() -> dict[str, str]:
    """stock_code → corp_code 매핑. 1주일 메모리 캐시."""
    global _corp_code_cache, _corp_code_cached_at
    now = datetime.utcnow()
    if _corp_code_cache and _corp_code_cached_at and (now - _corp_code_cached_at) < _CORP_CODE_TTL:
        return _corp_code_cache

    try:
        resp = requests.get(_CORP_CODE_URL, params={"crtfc_key": _dart_key()}, timeout=30)
        resp.raise_for_status()
        with zipfile.ZipFile(io.BytesIO(resp.content)) as zf:
            xml_data = zf.read(zf.namelist()[0])
        root = ET.fromstring(xml_data)
        mapping: dict[str, str] = {}
        for item in root.findall("list"):
            stock_code = (item.findtext("stock_code") or "").strip()
            corp_code = (item.findtext("corp_code") or "").strip()
            if stock_code:
                mapping[stock_code] = corp_code
        _corp_code_cache = mapping
        _corp_code_cached_at = now
        return mapping
    except Exception as e:
        logger.warning(f"[Backlog] corpCode.xml 다운로드 실패: {e}")
        return {}


def _get_corp_code(ticker: str) -> Optional[str]:
    m = _get_corp_code_map()
    # KR 종목은 보통 6자리 숫자
    code = ticker.upper().replace(".KS", "").replace(".KQ", "")
    return m.get(code)


def _get_recent_reports(corp_code: str) -> list[dict]:
    """최근 2년 사업/반기/분기 보고서 목록 (최대 8개)."""
    try:
        resp = requests.get(
            f"{_DART_BASE}/list.json",
            params={
                "crtfc_key": _dart_key(),
                "corp_code": corp_code,
                "pblntf_ty": "A",
                "bgn_de": (datetime.utcnow() - timedelta(days=730)).strftime("%Y%m%d"),
                "page_count": 10,
            },
            timeout=15,
        )
        data = resp.json()
        if data.get("status") != "000":
            return []
        return data.get("list", [])[:8]
    except Exception as e:
        logger.warning(f"[Backlog] list.json 조회 실패: {e}")
        return []


def _get_report_index(rcept_no: str) -> list[dict]:
    """보고서 섹션 목록."""
    try:
        resp = requests.get(
            f"{_DART_BASE}/index.json",
            params={"crtfc_key": _dart_key(), "rcept_no": rcept_no},
            timeout=15,
        )
        data = resp.json()
        if data.get("status") != "000":
            return []
        return data.get("list", [])
    except Exception as e:
        logger.warning(f"[Backlog] index.json 조회 실패 (rcept_no={rcept_no}): {e}")
        return []


def _get_section_html(rcept_no: str, dcm_no: str, ele_id: str) -> str:
    """섹션 HTML 다운로드."""
    try:
        resp = requests.get(
            f"{_DART_BASE}/document.json",
            params={
                "crtfc_key": _dart_key(),
                "rcept_no": rcept_no,
                "dcm_no": dcm_no,
                "ele_id": ele_id,
                "offset": 0,
                "length": 50000,
                "traverse": "Y",
            },
            timeout=20,
        )
        data = resp.json()
        if data.get("status") != "000":
            return ""
        return data.get("text") or ""
    except Exception as e:
        logger.warning(f"[Backlog] document.json 조회 실패: {e}")
        return ""


def _quarter_from_report(report_nm: str, rcept_dt: str) -> Optional[str]:
    """보고서명/접수일로부터 분기 문자열 추정. e.g. '2024Q1'"""
    nm = report_nm or ""
    year = rcept_dt[:4] if rcept_dt else ""
    if not year:
        return None
    if "1분기" in nm or "1·4" in nm:
        return f"{year}Q1"
    if "반기" in nm or "2분기" in nm:
        return f"{year}Q2"
    if "3분기" in nm or "3·4" in nm:
        return f"{year}Q3"
    if "사업" in nm or "연간" in nm or "4분기" in nm:
        return f"{year}Q4"
    return None


def _parse_amount_from_text(text: str) -> Optional[float]:
    """텍스트에서 억원 단위 금액 추출."""
    # 숫자(콤마 포함) 패턴
    nums = re.findall(r"[\d,]+(?:\.\d+)?", text.replace(" ", ""))
    if not nums:
        return None
    # 가장 큰 수치 선택 (수주잔고는 보통 큰 숫자)
    candidates = []
    for n in nums:
        try:
            candidates.append(float(n.replace(",", "")))
        except ValueError:
            pass
    return max(candidates) if candidates else None


def _parse_backlog_from_html(html: str, quarter: str) -> Optional[dict]:
    """BeautifulSoup으로 수주잔고 파싱. 성공 시 {quarter, amount, raw_text} 반환."""
    if not html:
        return None
    soup = BeautifulSoup(html, "lxml")
    for table in soup.find_all("table"):
        rows = table.find_all("tr")
        for row in rows:
            cells = [c.get_text(strip=True) for c in row.find_all(["td", "th"])]
            row_text = " ".join(cells)
            if "수주잔고" in row_text or "수주 잔고" in row_text:
                # 같은 행에서 숫자 추출
                for cell in cells:
                    amt = _parse_amount_from_text(cell)
                    if amt and amt > 0:
                        return {"quarter": quarter, "amount": amt, "raw_text": row_text[:500]}
    return None


def _upsert(ticker: str, entries: list[dict]):
    for e in entries:
        execute(
            """
            INSERT INTO backlog_history (ticker, quarter, amount, unit, source, raw_text, fetched_at)
            VALUES (%s, %s, %s, %s, %s, %s, NOW())
            ON CONFLICT (ticker, quarter) DO UPDATE SET
              amount = EXCLUDED.amount,
              unit = EXCLUDED.unit,
              source = EXCLUDED.source,
              raw_text = EXCLUDED.raw_text,
              fetched_at = NOW()
            """,
            (
                ticker.upper(),
                e["quarter"],
                e.get("amount"),
                e.get("unit", "억원"),
                e.get("source", "dart"),
                e.get("raw_text"),
            ),
        )


def get_backlog(ticker: str) -> list[dict]:
    """DB에서 수주잔고 이력 반환. [{quarter, amount, unit, source}]"""
    rows = query(
        "SELECT quarter, amount, unit, source FROM backlog_history WHERE ticker = %s ORDER BY quarter",
        (ticker.upper(),),
    )
    return [dict(r) for r in rows]


def get_pending_backlog() -> list[dict]:
    """분석 대기 중인 수주잔고 목록. [{ticker, quarter, raw_text, unit}]"""
    rows = query(
        "SELECT ticker, quarter, raw_text, unit FROM backlog_history WHERE source = 'pending' ORDER BY ticker, quarter",
    )
    return [dict(r) for r in rows]


def save_llm_backlog(ticker: str, entries: list[dict]):
    """Claude Code 분석 결과 저장. entries: [{quarter, amount}]"""
    for e in entries:
        execute(
            """
            UPDATE backlog_history
            SET amount = %s, source = 'llm', fetched_at = NOW()
            WHERE ticker = %s AND quarter = %s AND source = 'pending'
            """,
            (float(e["amount"]), ticker.upper(), e["quarter"]),
        )


def fetch_and_save_backlog(ticker: str) -> list[dict]:
    """DART에서 파싱해서 DB 저장 후 반환."""
    corp_code = _get_corp_code(ticker)
    if not corp_code:
        logger.info(f"[Backlog] corp_code 없음: {ticker}")
        return []

    reports = _get_recent_reports(corp_code)
    if not reports:
        return []

    saved: list[dict] = []
    seen_quarters: set[str] = set()

    for report in reports:
        rcept_no = report.get("rcept_no", "")
        report_nm = report.get("report_nm", "")
        rcept_dt = report.get("rcept_dt", "")
        quarter = _quarter_from_report(report_nm, rcept_dt)
        if not quarter or quarter in seen_quarters:
            continue

        sections = _get_report_index(rcept_no)
        # "수주" 포함 섹션 탐색
        target_sections = [s for s in sections if "수주" in (s.get("section_nm") or "")]
        if not target_sections:
            continue

        for sec in target_sections:
            dcm_no = sec.get("dcm_no", "")
            ele_id = sec.get("ele_id", "0")
            html = _get_section_html(rcept_no, dcm_no, ele_id)
            if not html:
                continue

            # 1차: BeautifulSoup 파싱
            parsed = _parse_backlog_from_html(html, quarter)
            if parsed:
                entry = {**parsed, "source": "dart"}
                _upsert(ticker, [entry])
                seen_quarters.add(quarter)
                saved.append(entry)
                break

            # 파싱 실패 시: raw_text 저장 후 Claude Cowork 분석 대기
            soup = BeautifulSoup(html, "lxml")
            raw_text = soup.get_text(separator="\n", strip=True)[:8000]
            pending_entry = {"quarter": quarter, "amount": None, "source": "pending", "raw_text": raw_text}
            _upsert(ticker, [pending_entry])
            seen_quarters.add(quarter)
            break

        # DART API 레이트 리밋 방지
        time.sleep(0.3)

        if len(seen_quarters) >= 8:
            break

    return get_backlog(ticker)

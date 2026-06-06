"""
DART 수주잔고(Order Backlog) 수집 서비스.

흐름:
1. corpCode.xml → {stock_code: corp_code} 매핑 (메모리 캐시, 1주일)
2. list.json → 최근 사업/반기/분기보고서 rcept_no
3. document.xml(ZIP) → 전 멤버 디코드·결합 원문 텍스트
4. "수주" 포함 표/문단 추출 → source='pending', raw_text DB 저장 (Claude Cowork 방식)
5. backlog_history 테이블에 upsert (수치는 Cowork가 채움)
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


def _get_document_text(rcept_no: str) -> str:
    """document.xml(ZIP)을 받아 전 멤버를 디코드·결합한 원문 텍스트 반환.

    DART /api/document.xml은 ZIP을 반환하며 내부에 메인+서브 문서 XML 멤버가
    여러 개 들어 있다. "수주" 텍스트가 서브문서에 있을 수 있으므로 전 멤버를
    디코드(UTF-8, 실패 시 euc-kr→cp949 폴백)해 결합한다. 비-ZIP/HTTP실패/예외
    시 빈 문자열을 반환한다(graceful)."""
    try:
        resp = requests.get(
            f"{_DART_BASE}/document.xml",
            params={"crtfc_key": _dart_key(), "rcept_no": rcept_no},
            timeout=20,
        )
        if getattr(resp, "status_code", 200) != 200:
            return ""
        content = resp.content
        if not content or content[:2] != b"PK":
            return ""
        parts: list[str] = []
        with zipfile.ZipFile(io.BytesIO(content)) as zf:
            for name in zf.namelist():
                raw = zf.read(name)
                text = ""
                for enc in ("utf-8", "euc-kr", "cp949"):
                    try:
                        text = raw.decode(enc)
                        break
                    except UnicodeDecodeError:
                        continue
                if not text:
                    text = raw.decode("utf-8", errors="ignore")
                parts.append(text)
        return "\n".join(parts)
    except Exception as e:
        logger.warning(f"[Backlog] document.xml 조회 실패 (rcept_no={rcept_no}): {e}")
        return ""


_MONTH_TO_QUARTER = {"03": "Q1", "06": "Q2", "09": "Q3", "12": "Q4"}


def _quarter_from_report(report_nm: str, rcept_dt: str) -> Optional[str]:
    """보고서명/접수일로부터 분기 문자열 추정. e.g. '2024Q1'

    보고서명의 (YYYY.MM) 괄호를 우선 파싱(연도=괄호값). 괄호가 없거나
    월이 03/06/09/12가 아니면 명칭 휴리스틱으로 폴백."""
    nm = report_nm or ""
    m = re.search(r"\((\d{4})\.(\d{2})\)", nm)
    if m:
        q = _MONTH_TO_QUARTER.get(m.group(2))
        if q:
            return f"{m.group(1)}{q}"
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


_DEFAULT_UNIT = "억원"
_UNIT_KEYWORDS = ("백만원", "조원", "억원")
_RAW_TEXT_CAP = 8000


def _extract_backlog_blocks(html: str) -> tuple[str, str]:
    """원문 HTML에서 "수주" 포함 표/문단을 추출해 (raw_text, unit) 반환.

    BeautifulSoup(html.parser)으로 "수주"가 들어간 <table>·<p> 블록만 골라 태그를
    제거하고 공백을 정규화·중복 제거한 뒤 총 길이를 ~8000자로 캡한다.
    블록 내 단위 키워드(백만원/억원/조원)를 감지해 함께 반환하며, 감지
    실패 시 기본값('억원')을 쓴다. "수주"가 없으면 ('', 기본단위)를 반환해
    저장하지 않음을 알린다."""
    if not html:
        return "", _DEFAULT_UNIT
    soup = BeautifulSoup(html, "html.parser")
    blocks: list[str] = []
    seen: set[str] = set()
    for el in soup.find_all(["table", "p"]):
        text = re.sub(r"\s+", " ", el.get_text(separator=" ", strip=True)).strip()
        if not text or "수주" not in text:
            continue
        if text in seen:
            continue
        seen.add(text)
        blocks.append(text)
    raw_text = "\n".join(blocks)[:_RAW_TEXT_CAP]
    if not raw_text:
        return "", _DEFAULT_UNIT
    unit = _DEFAULT_UNIT
    for kw in _UNIT_KEYWORDS:
        if kw in raw_text:
            unit = kw
            break
    return raw_text, unit


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
    """DART document.xml 원문에서 "수주" 블록을 추출해 pending으로 적재 후 반환.

    최근 정기보고서(최대 8개 distinct quarter)를 순회하며 document.xml 원문을
    받아 "수주" 블록이 있으면 source='pending'·amount=None·raw_text로 저장하고
    없으면 skip한다. 수치는 Claude Cowork(PUT /report/{ticker}/backlog)가 채운다."""
    corp_code = _get_corp_code(ticker)
    if not corp_code:
        logger.info(f"[Backlog] corp_code 없음: {ticker}")
        return get_backlog(ticker)

    reports = _get_recent_reports(corp_code)
    seen_quarters: set[str] = set()

    for report in reports:
        rcept_no = report.get("rcept_no", "")
        report_nm = report.get("report_nm", "")
        rcept_dt = report.get("rcept_dt", "")
        quarter = _quarter_from_report(report_nm, rcept_dt)
        if not quarter or quarter in seen_quarters:
            continue

        text = _get_document_text(rcept_no)
        raw_text, unit = _extract_backlog_blocks(text)
        if raw_text:
            _upsert(ticker, [{
                "quarter": quarter,
                "amount": None,
                "unit": unit,
                "source": "pending",
                "raw_text": raw_text,
            }])
            seen_quarters.add(quarter)

        # DART API 레이트 리밋 방지
        time.sleep(0.3)

        if len(seen_quarters) >= 8:
            break

    return get_backlog(ticker)


def fetch_all_backlog() -> dict:
    """user_stocks ∩ tickers의 KR 종목 전체에 대해 직렬로 수주잔고 수집."""
    tickers = [r["ticker"] for r in query(
        "SELECT DISTINCT us.ticker FROM user_stocks us "
        "JOIN tickers t ON us.ticker = t.ticker WHERE t.market = 'KR'")]
    ok = 0
    failed = 0
    for t in tickers:
        try:
            fetch_and_save_backlog(t)
            ok += 1
        except Exception as e:
            failed += 1
            logger.warning(f"[Backlog] fetch_all failed for {t}: {e}")
    logger.info(f"[Backlog] fetch_all: {ok}/{len(tickers)} ok, {failed} failed")
    return {"total": len(tickers), "ok": ok, "failed": failed}

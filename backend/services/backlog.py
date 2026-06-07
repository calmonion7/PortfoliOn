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
import warnings
import zipfile
from datetime import datetime, timedelta
from typing import Optional
from xml.etree import ElementTree as ET

import requests
from bs4 import BeautifulSoup, XMLParsedAsHTMLWarning

from services.db import execute, query

# document.xml 원문은 XML이지만 html.parser로 파싱하므로(lxml 로컬 미설치) 경고가
# 배치 로그를 오염시킨다. 파싱은 정상 동작하므로 경고만 억제한다.
warnings.filterwarnings("ignore", category=XMLParsedAsHTMLWarning)

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
# 백로그 지표 정탐 키워드. 바 "수주" 매칭은 수주추진비(비용)·수주산업전문가(감사)·
# 수주계약/수주현황 등 노이즈까지 잡으므로, 실제 잔고/총액 용어로만 좁힌다.
_BACKLOG_KEYWORDS = ("수주잔고", "수주총액", "수주잔량", "수주잔액")
_RAW_TEXT_CAP = 8000

# 모든 금액을 억원으로 정규화(프론트 BacklogChart는 amount를 억원으로 가정).
_EOK_FACTOR = {"조원": 10000.0, "억원": 1.0, "백만원": 0.01, "천원": 1e-5, "원": 1e-8}
_TOTAL_ROW_RE = re.compile(r"합\s*계|총\s*계")
_RECONCILE_TOL = 0.01  # 상대 1%


def _num(s: str) -> Optional[float]:
    """셀 텍스트 → 숫자. 콤마 제거, 괄호(123)는 음수, '-'/빈칸/비수치는 None."""
    s = (s or "").strip()
    if not s or s in ("-", "—", "–"):
        return None
    neg = s.startswith("(") and s.endswith(")")
    s = s.strip("()").replace(",", "").replace(" ", "")
    if not re.fullmatch(r"-?\d+(\.\d+)?", s):
        return None
    v = float(s)
    return -v if neg else v


def _is_krw(unit: Optional[str]) -> bool:
    return unit in _EOK_FACTOR


def _to_eok(v: float, unit: str) -> float:
    """원 단위 금액을 억원으로 정규화."""
    return v * _EOK_FACTOR.get(unit, 1.0)


def _expand_grid(table) -> list[list[str]]:
    """rowspan/colspan을 전개한 직사각 셀 그리드(텍스트). 2행 헤더 정렬에 필요."""
    grid: dict[tuple[int, int], str] = {}
    occ: set[tuple[int, int]] = set()
    for r, tr in enumerate(table.find_all("tr")):
        c = 0
        for cell in tr.find_all(["td", "th"], recursive=False):
            while (r, c) in occ:
                c += 1
            text = re.sub(r"\s+", " ", cell.get_text(" ", strip=True)).strip()
            try:
                cs = int(cell.get("colspan") or 1)
                rs = int(cell.get("rowspan") or 1)
            except ValueError:
                cs = rs = 1
            for dr in range(rs):
                for dc in range(cs):
                    grid[(r + dr, c + dc)] = text
                    occ.add((r + dr, c + dc))
            c += cs
    if not grid:
        return []
    maxr = max(k[0] for k in grid)
    maxc = max(k[1] for k in grid)
    return [[grid.get((r, c), "") for c in range(maxc + 1)] for r in range(maxr + 1)]


def _is_data_row(row: list[str]) -> bool:
    return sum(1 for c in row if _num(c) is not None) >= 2


def _header_rows(grid: list[list[str]]) -> list[int]:
    """선두의 라벨-only 행들을 헤더로 본다(숫자 데이터 등장 직전까지)."""
    hrs = []
    for i, row in enumerate(grid):
        if _is_data_row(row):
            break
        hrs.append(i)
    return hrs or [0]


def _col_label(grid: list[list[str]], hrs: list[int], c: int) -> str:
    parts: list[str] = []
    for r in hrs:
        t = grid[r][c] if c < len(grid[r]) else ""
        if t and (not parts or parts[-1] != t):
            parts.append(t)
    return " ".join(parts)


def _find_col(grid: list[list[str]], hrs: list[int], *kw: str) -> Optional[int]:
    """헤더 라벨이 kw를 모두 포함하는 컬럼(우측 우선, 금액 컬럼 우선)."""
    ncol = max((len(r) for r in grid), default=0)
    cands = [c for c in range(ncol) if all(k in _col_label(grid, hrs, c) for k in kw)]
    if not cands:
        return None
    amt = [c for c in cands if "금액" in _col_label(grid, hrs, c)]
    pool = amt or [c for c in cands if "수량" not in _col_label(grid, hrs, c)] or cands
    return pool[-1]


def _total_or_single_row(grid: list[list[str]], hrs: list[int]) -> Optional[int]:
    """합계행 인덱스. 없으면 데이터행이 정확히 1개일 때 그 행, 아니면 None(모호)."""
    data_rows = [i for i in range(len(grid)) if i not in hrs and _is_data_row(grid[i])]
    for i in data_rows:
        if _TOTAL_ROW_RE.search(" ".join(grid[i])):
            return i
    non_total = [i for i in data_rows if not _TOTAL_ROW_RE.search(" ".join(grid[i]))]
    return non_total[0] if len(non_total) == 1 else None


def _classify_table(table) -> Optional[str]:
    """'susu'(수주상황: 기납품+수주잔고)·'progress'(공사진행: 수주총액+진행률)·None."""
    grid = _expand_grid(table)
    if not grid:
        return None
    hrs = _header_rows(grid)
    if not any(i not in hrs and _is_data_row(grid[i]) for i in range(len(grid))):
        return None  # 데이터행 없음(면책문구 등)
    hdr = " ".join(grid[r][c] for r in hrs for c in range(len(grid[r])))
    has_jango = ("수주잔고" in hdr) or ("기말수주잔고" in hdr)
    if has_jango and "기납품" in hdr:
        return "susu"
    if "수주총액" in hdr and "진행률" in hdr:
        return "progress"
    return None


def _parse_susu_table(table, unit: str) -> Optional[float]:
    """수주상황 표에서 수주잔고를 추출·검산하고 억원으로 정규화. 실패 시 None.

    가드: 외화(비KRW) / 다중엔티티(종속회사 2그룹+) / 빈셀 / 검산불일치(상대1%) / 모호(무합계 다중행).
    """
    if not _is_krw(unit):
        return None
    grid = _expand_grid(table)
    if not grid:
        return None
    hrs = _header_rows(grid)
    # 다중엔티티 가드: '종속회사'가 2개 이상 데이터행에 등장(한화형 연결 합계 차단)
    ent = sum(1 for i in range(len(grid)) if i not in hrs and "종속회사" in " ".join(grid[i]))
    if ent >= 2:
        return None
    bcol = _find_col(grid, hrs, "기말수주잔고") or _find_col(grid, hrs, "수주잔고")
    if bcol is None:
        return None
    row = _total_or_single_row(grid, hrs)
    if row is None:
        return None
    amount = _num(grid[row][bcol]) if bcol < len(grid[row]) else None
    if amount is None:
        return None
    if not _reconcile(grid, hrs, row, amount):
        return None
    return _to_eok(amount, unit)


def _reconcile(grid: list[list[str]], hrs: list[int], row: int, amount: float) -> bool:
    """수주총액−기납품≈잔고(변종A) 또는 기초+신규−기납품≈기말(변종B), 상대 1%."""
    def colval(*kw):
        c = _find_col(grid, hrs, *kw)
        if c is None or c >= len(grid[row]):
            return None
        return _num(grid[row][c])

    total = colval("수주총액")
    deliv = colval("기납품")
    base = colval("기초수주잔")
    delta = colval("신규")
    expected = None
    if total is not None and deliv is not None:
        expected = total - abs(deliv)
    elif base is not None and delta is not None and deliv is not None:
        expected = base + delta - abs(deliv)
    if expected is None:
        return False
    tol = _RECONCILE_TOL * max(abs(amount), abs(expected), 1.0)
    return abs(expected - amount) <= tol


def _table_unit(table) -> str:
    """표 직전의 '(단위 ... )' 캡션에서 금액 통화 단위만 추출(수량 단위 무시)."""
    node = table.find_previous(string=re.compile("단위"))
    if node:
        m = re.search(r"단위[^)]*?(조원|억원|백만원|천원|달러|위안|엔|원)", str(node))
        if m:
            return m.group(1)
    return _DEFAULT_UNIT


def _auto_backlog(html: str) -> Optional[float]:
    """문서에서 수주상황 표를 골라 수주잔고(억원)를 자동 추출. 실패 시 None."""
    if not html:
        return None
    soup = BeautifulSoup(html, "html.parser")
    for table in soup.find_all("table"):
        if _classify_table(table) != "susu":
            continue
        amt = _parse_susu_table(table, _table_unit(table))
        if amt is not None:
            return amt
    return None


def _extract_backlog_blocks(html: str) -> tuple[str, str]:
    """원문 HTML에서 수주 관련 블록을 추출해 (raw_text, unit) 반환.

    표(수주상황/공사진행)는 행=라인·셀 ' | ' 결합으로 **구조를 보존**하고(컬럼↔숫자
    정렬 유지 → 다운스트림 자동추출이 헤더 매핑 가능), 정탐 키워드(수주잔고/수주총액/
    수주잔량/수주잔액) 문단(<p>)도 함께 담는다. 면책문구('생략')는 제외한다(삼성전자형).
    단위는 수주상황 표 캡션('(단위 ... )')을 우선하고, 없으면 텍스트에서 통화 키워드를
    찾는다. 수주 블록이 없으면 ('', 기본단위)를 반환해 저장하지 않음을 알린다."""
    if not html:
        return "", _DEFAULT_UNIT
    soup = BeautifulSoup(html, "html.parser")
    blocks: list[str] = []
    seen: set[str] = set()
    unit: Optional[str] = None
    for table in soup.find_all("table"):
        kind = _classify_table(table)
        if kind is None:
            continue
        rows = [" | ".join(row) for row in _expand_grid(table)]
        text = "\n".join(r for r in rows if r.strip()).strip()
        if not text or text in seen:
            continue
        seen.add(text)
        blocks.append(text)
        if unit is None and kind == "susu":
            u = _table_unit(table)
            if _is_krw(u):
                unit = u
    for p in soup.find_all("p"):
        text = re.sub(r"\s+", " ", p.get_text(separator=" ", strip=True)).strip()
        if not text or text in seen:
            continue
        if not any(kw in text for kw in _BACKLOG_KEYWORDS) or "생략" in text:
            continue
        seen.add(text)
        blocks.append(text)
    raw_text = "\n".join(blocks)[:_RAW_TEXT_CAP]
    if not raw_text:
        return "", _DEFAULT_UNIT
    if unit is None:
        for kw in _UNIT_KEYWORDS:
            if kw in raw_text:
                unit = kw
                break
    return raw_text, unit or _DEFAULT_UNIT


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
    """DART document.xml 원문에서 수주잔고를 수집해 저장 후 반환.

    최근 정기보고서(최대 8개 distinct quarter)를 순회하며 document.xml 원문을 받아:
    - 수주상황 표(유형1)가 검산을 통과하면 자동 추출값을 source='dart'·amount(억원)로 저장,
    - 추출 실패(다중엔티티·외화·무합계·검산불일치)지만 수주 블록은 있으면 source='pending'·
      amount=None으로 저장(수치는 Cowork가 채움),
    - 수주 정보가 없으면 skip(행 미생성, 유형3)."""
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
            amount = _auto_backlog(text)
            if amount is not None:
                _upsert(ticker, [{
                    "quarter": quarter, "amount": amount, "unit": "억원",
                    "source": "dart", "raw_text": raw_text,
                }])
            else:
                _upsert(ticker, [{
                    "quarter": quarter, "amount": None, "unit": unit,
                    "source": "pending", "raw_text": raw_text,
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

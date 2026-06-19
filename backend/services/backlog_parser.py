"""
DART 수주잔고 HTML 표 파싱 (순수 함수 클러스터).

backlog.py에서 분리한 파싱/검산/단위정규화 헬퍼. DB·DART fetch 의존 없이
document.xml 원문(HTML)만 입력받아 수주잔고/segments를 추출한다.
backlog.py가 이 심볼들을 re-export하므로 공개 표면은 불변.
"""
from __future__ import annotations

import re
import warnings
from typing import Optional

from bs4 import BeautifulSoup, XMLParsedAsHTMLWarning

# document.xml 원문은 XML이지만 html.parser로 파싱하므로(lxml 로컬 미설치) 경고가
# 배치 로그를 오염시킨다. 파싱은 정상 동작하므로 경고만 억제한다.
warnings.filterwarnings("ignore", category=XMLParsedAsHTMLWarning)


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


def _is_multi_entity(table) -> bool:
    """다중엔티티(지주사 연결) 수주상황 표인가.

    신호: ① 헤더에 '회사' 컬럼(여러 법인을 행으로 나열) ② '종속회사'가 2개 이상
    데이터행에 등장. 한화에어로형(연결 합계)을 모회사 기준 아님으로 보고 차단한다.
    (2024년처럼 연결 전이라 종속회사 문구가 없어도 '회사' 컬럼으로 잡는다.)"""
    grid = _expand_grid(table)
    if not grid:
        return False
    hrs = _header_rows(grid)
    ncol = max((len(r) for r in grid), default=0)
    if any("회사" in _col_label(grid, hrs, c) for c in range(ncol)):
        return True
    ent = sum(1 for i in range(len(grid)) if i not in hrs and "종속회사" in " ".join(grid[i]))
    return ent >= 2


def _parse_susu_table(table, unit: str) -> Optional[float]:
    """수주상황 표에서 수주잔고를 추출·검산하고 억원으로 정규화. 실패 시 None.

    가드: 외화(비KRW) / 다중엔티티(회사컬럼·종속회사) / 빈셀 / 검산불일치(상대1%) / 모호(무합계 다중행).
    """
    if not _is_krw(unit):
        return None
    if _is_multi_entity(table):
        return None
    grid = _expand_grid(table)
    if not grid:
        return None
    hrs = _header_rows(grid)
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
    """표 직전의 '(단위 ... )' 캡션에서 KRW 통화 단위만 추출.

    캡션이 있으나 KRW 토큰이 없으면(USD천·백만달러·줄바꿈 분리 등) '기타'(비KRW)를
    반환해 자동추출을 막는다 — 'wrong < missing'. 수량 단위(천배럴/톤)는 무시한다."""
    node = table.find_previous(string=re.compile("단위"))
    if node:
        m = re.search(r"단위[^)]*?(조원|억원|백만원|천원|원)", str(node))
        return m.group(1) if m else "기타"
    return _DEFAULT_UNIT


def _auto_backlog(html: str) -> Optional[float]:
    """문서에서 수주상황 표를 골라 수주잔고(억원)를 자동 추출. 실패 시 None.

    문서 내 어떤 수주상황 표든 다중엔티티(회사컬럼·종속회사)면 그 문서 전체를
    pending 처리한다 — 한화처럼 한 문서에 다중엔티티 합계표(68조)와 단일처럼 보이는
    표가 공존해 엉뚱한 표가 채택되는 것을 막는다."""
    if not html:
        return None
    soup = BeautifulSoup(html, "html.parser")
    susu = [t for t in soup.find_all("table") if _classify_table(t) == "susu"]
    if not susu:
        return None
    if any(_is_multi_entity(t) for t in susu):
        return None
    for t in susu:
        amt = _parse_susu_table(t, _table_unit(t))
        if amt is not None:
            return amt
    return None


def _segments_from_susu(table, unit: str) -> "Optional[tuple[float, list[dict]]]":
    """다중엔티티 수주상황 요약표 → (연결 합계 억원, segments[{sector,entity,amount}]).

    Σ(부문·법인 행) == 합계 행(상대 1%) 검산을 통과할 때만 반환. 비-KRW/회사컬럼 없음/
    무합계/Σ≠합계면 None. 금액은 억원 정규화, sector 'IT서비스 등'→'IT서비스' 정규화."""
    if not _is_krw(unit):
        return None
    grid = _expand_grid(table)
    if not grid:
        return None
    hrs = _header_rows(grid)
    ecol = _find_col(grid, hrs, "회사")
    scol = _find_col(grid, hrs, "사업")
    bcol = _find_col(grid, hrs, "기말수주잔고") or _find_col(grid, hrs, "수주잔고")
    if ecol is None or bcol is None:
        return None
    total: Optional[float] = None
    segs: list[dict] = []
    for i in range(len(grid)):
        if i in hrs:
            continue
        amt = _num(grid[i][bcol]) if bcol < len(grid[i]) else None
        if _TOTAL_ROW_RE.search(" ".join(grid[i])):
            if amt is not None:
                total = amt
            continue
        if amt is None:
            continue
        entity = re.sub(r"\s+", " ", grid[i][ecol]).strip() if ecol < len(grid[i]) else ""
        sector = (re.sub(r"\s+", " ", grid[i][scol]).strip()
                  if (scol is not None and scol < len(grid[i])) else "")
        sector = re.sub(r"\s*등$", "", sector).strip()
        segs.append({"sector": sector, "entity": entity,
                     "amount": round(_to_eok(amt, unit), 2)})
    if total is None or not segs:
        return None
    total_eok = _to_eok(total, unit)
    seg_sum = sum(s["amount"] for s in segs)
    if abs(seg_sum - total_eok) > _RECONCILE_TOL * max(abs(total_eok), abs(seg_sum), 1.0):
        return None
    return round(total_eok, 2), segs


def _auto_backlog_multi(html: str) -> "Optional[tuple[float, list[dict]]]":
    """다중엔티티 연결 요약표에서 (합계 억원, segments) 자동추출. 실패 시 None.

    susu 표 중 다중엔티티(회사 컬럼)이고 Σ==합계 검산을 통과하는 표 중 합계 최대
    (= 연결 요약표; 품목 상세표·부분표 회피)를 채택."""
    if not html:
        return None
    soup = BeautifulSoup(html, "html.parser")
    best: Optional[tuple[float, list[dict]]] = None
    for t in soup.find_all("table"):
        if _classify_table(t) != "susu" or not _is_multi_entity(t):
            continue
        res = _segments_from_susu(t, _table_unit(t))
        if res is not None and (best is None or res[0] > best[0]):
            best = res
    return best


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

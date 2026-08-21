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


# 단위 미확정 센티널. 비KRW이므로 `_is_krw`가 False → 자동추출이 차단되고 pending
# (Cowork가 채움)으로 흐른다. **'억원' 같은 기본값을 쓰지 말 것** — 실제가 천원/원
# 단위였을 때 ×100~×100,000 오저장이 된다('wrong < missing').
_UNKNOWN_UNIT = "기타"
# `_table_unit`이 표 직전에서 캡션을 찾을 때 훑는 **비공백 문자열 노드** 수 상한.
# 근거는 `_table_unit` docstring(probe327 라이브 실측 — 관측 최대 거리 3, 여유 0)에 있다.
# **양방향 load-bearing**: 줄이면 실문서가 pending으로 강하하고, 늘리면 무관 섹션
# 캡션을 주워 ×100~×10000 오저장이 된다. 바꾸려면 probe327을 다시 돌릴 것.
_UNIT_CAPTION_LOOKBACK = 3
# 캡션에서 **한글 통화 낱말 전체**를 잡는다(공백 제거 후 `_EOK_FACTOR` exact 매칭).
# 옛 `단위[^)]*?(조원|억원|백만원|천원|원)`은 lazy 확장이라 **복합 단위의 접미사**에
# 매칭됐다 — `십억원`→`억원`(×1/10) · `만원`/`천만원`→`원`(×1/10,000,000) ·
# `백억원`→`억원`(×1/100). `_is_krw`가 True라 자동추출이 그대로 진행돼 미확정이 아니라
# **자신 있게 틀린 단위**가 `source='dart'`(최고 신뢰)로 저장됐다.
# `[가-힣]*원`은 (lazy 바깥 + greedy 안쪽) **최좌측에서 시작하는 최장 한글 런**을 잡으므로
# `십억원`·`만원`·`원화백만원`을 통째로 얻고, 화이트리스트 밖이면 미확정으로 떨어진다.
_UNIT_CAPTION_RE = re.compile(r"단위[^)]*?([가-힣]*원)")
# 상한 밖 '단위' 캡션의 **존재 여부**만 보는 탐색용(값은 쓰지 않는다).
_UNIT_NODE_RE = re.compile("단위")
# 본문 산문에서 통화 낱말을 줍는 **약한** 폴백(캡션 부재 시에만 쓴다). 부분문자열 검사는
# `"억원" in "십억원"`이 True라 같은 접미사 함정을 가지므로 앞 글자가 한글이면 거부한다
# (`3,500억원`=채택 / `35십억원`=거부). 캡션과 달리 산문은 권위가 없으므로 복합 단위를
# 새로 인정하지 않고 미확정으로 둔다 — pending → Cowork.
_UNIT_KEYWORDS = ("백만원", "조원", "억원")
_UNIT_KEYWORD_RES = tuple((kw, re.compile(r"(?<![가-힣])" + kw)) for kw in _UNIT_KEYWORDS)
# 백로그 지표 정탐 키워드. 바 "수주" 매칭은 수주추진비(비용)·수주산업전문가(감사)·
# 수주계약/수주현황 등 노이즈까지 잡으므로, 실제 잔고/총액 용어로만 좁힌다.
_BACKLOG_KEYWORDS = ("수주잔고", "수주총액", "수주잔량", "수주잔액")
_RAW_TEXT_CAP = 8000

# 모든 금액을 억원으로 정규화(프론트 BacklogChart는 amount를 억원으로 가정).
# 십억원(=10^9원)은 실 DART 정기보고서에 29건 실재한다(probe327: `십억원` 25 + `십억 원` 4).
# 옛 정규식이 이것을 `억원`으로 접어 ×1/10 오값을 확정 저장했으므로, 미확정으로 떨어뜨리는
# 대신 **정확한 factor로 화이트리스트에 넣어** 커버리지와 정확성을 함께 지킨다.
_EOK_FACTOR = {"조원": 10000.0, "십억원": 10.0, "억원": 1.0,
               "백만원": 0.01, "천원": 1e-5, "원": 1e-8}
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


def _parse_susu_table(table, unit: Optional[str]) -> Optional[float]:
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


def _table_unit(table) -> Optional[str]:
    """표 **직전 근거리**의 '(단위 ... )' 캡션에서 KRW 통화 단위만 추출. 3-상태 반환.

    - `"억원"`/`"백만원"`/`"십억원"`/… : 근거리 캡션에서 KRW 통화 단위를 확정했다.
      화이트리스트는 `_EOK_FACTOR`가 **단일 정본**이고 공백 제거 후 exact 매칭이다
      (부분·접미사 매칭 금지 — `십억원`을 `억원`으로 읽으면 ×1/10 오저장이 된다).
    - `"기타"`(`_UNKNOWN_UNIT`) : **캡션은 있으나 KRW 단위를 확정하지 못했다.** 두 경우다 —
      ⓐ 근거리 캡션에 KRW 토큰이 없다(USD천·백만달러·화이트리스트 밖 복합단위
      `만원`·`천만원`·`백억원`·줄바꿈으로 분리된 `(단위 :` 등)
      ⓑ 근거리엔 없지만 문서 앞쪽 **어딘가에** '단위' 캡션이 있다(= 원거리라 못 믿는다).
      두 경우 모두 호출측은 이것을 **본문 텍스트 키워드로 덮어쓰지 말 것** — 문서가
      단위를 말하고 있는데 우리가 그 값을 확정하지 못한 상태이므로, 산문의 무관한
      통화 낱말을 채택하면 *미확정*이 아니라 **틀린 확정**이 된다(옛 코드가 정확한
      단위를 냈던 입력에서 ×100 오라벨을 Cowork로 흘리는 경로였다).
    - `None` : 표 앞쪽에 '단위' 캡션이 **아예 없다**. 이때만 호출측이 더 약한 소스
      (본문 통화 키워드)를 시도해도 되고, 그것도 없으면 `_UNKNOWN_UNIT`으로 둔다.

    어느 경우에도 '억원'을 **가정하지 않는다** — 단위 오라벨은 ×100~×100,000 대형
    오저장이 되므로 미확정으로 두고 pending(Cowork)으로 흘린다('wrong < missing').
    수량 단위(천배럴/톤/M/T/척)는 무시한다.

    거리 상한의 근거 — **probe327 라이브 실측**(실 DART document.xml 최근 정기보고서
    **123건 / 16종목**, 수주상황 표 **159개**). 단위는 **비공백 문자열 노드**(= 이 함수가
    세는 단위):
      - 올바른 캡션까지의 거리 분포 = **{1: 158, 3: 1}** → **min=1, max=3**.
      - 그 앞 무관 섹션의 다음 '단위' 캡션까지 = **14~132**(n=142).
    ⚠️ **상한 3은 관측 최대값과 *같다* — 위쪽 여유는 0이다.** (probe326이 최신 보고서
    1건/종목만 봐서 `max=1`·"여유 3배"로 적혀 있었는데, 분기별로 확장하니 거리 3이
    나왔다. 005380 분기보고서형: 표 직전 비공백 노드가 `')'`→`'백만원'`→`'(단위 :'`로
    캡션이 줄바꿈 분리된 형태.) 따라서 이 상수는 **줄이면 실문서가 즉시 깨지고**
    늘리면 원거리 오채택 위험이 커지는 양방향 load-bearing 값이다 —
    `tests/test_table_unit_no_default_fallback.py`가 양쪽을 핀으로 못박는다.
    ⚠️ 같은 문서를 *공백 포함* raw hop으로 재면 각각 5와 80~377이 되는데, 이 함수의
    상한은 **비공백 기준**이므로 그 숫자와 직접 비교하지 말 것(단위가 다르다).

    거리를 비공백 노드로 세는 이유: 실문서의 캡션은
    `<table><tr><td>(단위 : 백만원)</td></tr></table>` 1셀 표로 감싸여 수주표 바로
    위에 온다(실측 158/159). 그래서 '직전 형제 N개'나 '표 경계를 만나면 중단' 같은
    규칙은 **실문서를 하나도 못 잡는다**(캡션이 *다른 표 안*에 있다). 공백 노드는
    렌더러가 만드는 레이아웃 산물이라 세지 않는다(raw hop은 이 문서군에서 5로
    일정했지만 pretty-print 여부에 좌우돼 이식성이 없다).

    상한을 틀렸을 때의 비대칭: 너무 좁으면 unit 미확정 → pending(Cowork가 채움)이고,
    너무 넓으면 무관 섹션 단위를 확신해 ×100~×10000 오저장이 된다. 그래서 의심스러울
    때는 좁은 쪽으로 틀리는 것이 맞다('wrong < missing') — **단 관측 최대값(3)까지는
    좁힐 수 없다**(그 아래로 내리면 실문서가 pending으로 강하한다).
    """
    node = table
    seen = 0
    while seen < _UNIT_CAPTION_LOOKBACK:
        node = node.find_previous(string=True)
        if node is None:
            break
        text = str(node).strip()
        if not text:
            continue  # 공백 노드는 거리로 세지 않는다
        seen += 1
        if "단위" in text:
            # 공백 제거 후 매칭 — `(단위 : 십억 원)`처럼 낱말이 공백으로 갈린 실캡션이
            # 있고, 공백을 남기면 `[가-힣]*원`이 `원`만 잡아 ×1/10^9 오값이 된다.
            m = _UNIT_CAPTION_RE.search(re.sub(r"\s+", "", text))
            tok = m.group(1) if m else None
            # 화이트리스트(`_EOK_FACTOR`)가 단위 인식의 단일 정본이다. 밖이면 미확정.
            return tok if tok in _EOK_FACTOR else _UNKNOWN_UNIT
    # 근거리엔 없다. 문서 앞쪽 **어딘가에** 캡션이 있으면 그것은 '모른다'이지
    # '산문을 믿어라'가 아니다 → `_UNKNOWN_UNIT`으로 호출측의 텍스트 폴백을 막는다.
    # (막지 않으면 옛 코드가 *정확한* 단위를 냈던 입력에서 새 코드가 본문 산문의 무관한
    #  통화 낱말을 채택해 ×100 오라벨을 Cowork로 흘린다 — B62가 막으려던 그 클래스다.)
    return _UNKNOWN_UNIT if table.find_previous(string=_UNIT_NODE_RE) else None


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


def _segments_from_susu(table, unit: Optional[str]) -> "Optional[tuple[float, list[dict]]]":
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

    단위 결정은 **3단**이다: ① 수주상황 표 근거리 캡션(`_table_unit`) — 캡션이 있으면
    KRW 여부 불문 그 값을 확정으로 채택한다(비KRW '기타'를 아래 ②로 덮으면 USD 문서가
    억원으로 오라벨된다) → ② **문서에 '단위' 캡션이 아예 없을 때만** raw_text의 통화
    키워드(`_UNIT_KEYWORDS`, 앞 글자가 한글이면 거부 — `"억원" in "십억원"`이 True다)
    → ③ 둘 다 없으면 **미확정(`_UNKNOWN_UNIT`)**.
    ⚠️ ②의 게이트가 `_table_unit`의 **`None` vs `"기타"` 구별**이다: 캡션이 원거리에
    존재하면 `_table_unit`이 `"기타"`를 반환해 ②를 막는다. 그러지 않으면 옛 코드가
    *정확한* 단위를 냈던 입력에서 본문 산문의 무관한 통화 낱말이 채택돼 ×100 오라벨이
    Cowork로 전달된다(B62가 막으려던 클래스가 pending 라벨 경로로 재도입된다).
    ③에 '억원' 기본값을 쓰지 않는 이유:
    이 unit은 `backlog._save_pending`을 통해 "이 문서의 단위"로 Cowork에 전달되므로
    오라벨이 곧 ×100~×100,000 오저장이다('wrong < missing').

    수주 블록이 없으면 ('', 미확정)을 반환해 저장하지 않음을 알린다(호출측
    `backlog.fetch_and_save_backlog`가 `if raw_text:`로 게이트하므로 이때 unit은
    소비되지 않는다 — 단위 가정이 아니라 자리채움이다)."""
    if not html:
        return "", _UNKNOWN_UNIT
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
            # 근거리 캡션이 있으면 KRW 여부 불문 채택('기타'=확정된 비KRW). 캡션이
            # 없으면 None이 유지돼 아래 텍스트 키워드 폴백으로 넘어간다.
            unit = _table_unit(table)
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
        return "", _UNKNOWN_UNIT
    if unit is None:
        for kw, rx in _UNIT_KEYWORD_RES:
            if rx.search(raw_text):
                unit = kw
                break
    return raw_text, unit or _UNKNOWN_UNIT

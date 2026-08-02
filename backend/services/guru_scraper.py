import logging
import re
import requests
from bs4 import BeautifulSoup
from typing import Optional
import time

logger = logging.getLogger(__name__)

_BASE = "https://www.dataroma.com/m"
_NAVER_US_BASE = "https://api.stock.naver.com/stock"
_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/120.0.0.0 Safari/537.36"
    ),
    "Referer": "https://m.stock.naver.com/",
    "Accept": "application/json, text/plain, */*",
}


def get_name_kr(ticker: str) -> str:
    """Naver Finance US 주식 API로 한글명 조회. 실패 시 빈 문자열.

    NYSE 종목은 suffix 없이, NASDAQ 종목은 .O suffix로 조회.
    """
    for code in [ticker, f"{ticker}.O"]:
        try:
            r = requests.get(
                f"{_NAVER_US_BASE}/{code}/basic",
                headers=_HEADERS,
                timeout=5,
            )
            if r.status_code == 200:
                return r.json().get("stockName") or ""
        except Exception:
            pass
    return ""


def _parse_portfolio_value(text: str) -> int:
    """'$12.3B', '$500M' 형태의 문자열을 정수로 변환."""
    text = text.strip().replace("$", "").replace(",", "")
    for suffix, mult in [("T", 1_000_000_000_000), ("B", 1_000_000_000), ("M", 1_000_000), ("K", 1_000)]:
        if text.upper().endswith(suffix):
            try:
                return int(float(text[:-1]) * mult)
            except ValueError:
                return 0
    try:
        return int(float(text))
    except ValueError:
        return 0


_ACTIVITY_RE = re.compile(r"^(Add|Reduce|Sell)\s+([\d.,]+)\s*%$")
# dataroma 활동 동사 → 저장 enum. locale-독립 저장값이고 한글 라벨은 프론트가 붙인다
# (InsiderBadge/SupplyBadge 규약과 동일).
_ACTIVITY_KINDS = {"Add": "add", "Reduce": "reduce", "Sell": "sold_out"}


def _parse_activity(text: str) -> Optional[dict]:
    """dataroma 활동 표기 → {kind, share_pct}. 변동없음(빈칸)은 None.

    라이브 전수 실측(83명)에서 나타나는 패턴은 정확히 4종이다:
      'Add N%'(추가매수) · 'Reduce N%'(축소) · 'Buy'(신규매수) · 'Sell N%'(전량매도)
    'Buy'는 직전 분기 보유가 0이라 증감률이 없어 share_pct=None.
    'Sell'은 296건이 전부 100.00%라 전량매도로 확정(부분매도는 'Reduce'로 온다).
    반환이 None이면 호출측은 activity 키를 아예 만들지 않는다 — 변동없는 행이
    표본의 18%라 빈 dict를 채우면 저장과 프론트 분기가 둘 다 지저분해진다.
    """
    text = (text or "").strip()
    if not text:
        return None
    if text.lower().startswith("buy"):
        return {"kind": "buy", "share_pct": None}
    m = _ACTIVITY_RE.match(text)
    if not m:
        logger.warning(f"[Guru] 알 수 없는 활동 표기: {text!r}")
        return None
    try:
        return {"kind": _ACTIVITY_KINDS[m.group(1)], "share_pct": float(m.group(2).replace(",", ""))}
    except ValueError:
        return None


_PERIOD_RE = re.compile(r"Period:\s*(Q[1-4])\s*(\d{4})")
_PDATE_RE = re.compile(r"Portfolio date:\s*(\d{1,2})\s+([A-Za-z]{3})[a-z]*\s+(\d{4})")
# strptime %b 는 locale 의존이라 명시 맵을 쓴다(컨테이너 locale 가정 금지).
_MONTHS = {"jan": 1, "feb": 2, "mar": 3, "apr": 4, "may": 5, "jun": 6,
           "jul": 7, "aug": 8, "sep": 9, "oct": 10, "nov": 11, "dec": 12}


def _parse_period(text: str) -> tuple[Optional[str], Optional[str]]:
    """p#p2 텍스트에서 (period, portfolio_date) 추출. 예: ('Q1 2026', '2026-03-31').

    분기는 매니저별로 갈린다(실측: Q1 2026 77명 · Q2 2026 4명 · Q4 2025 1명 · Q3 2025 1명)
    — 전역 상수로 박지 말고 매니저마다 저장할 것. 추출 실패는 None(wrong < missing).
    """
    period = None
    m = _PERIOD_RE.search(text)
    if m:
        period = f"{m.group(1)} {m.group(2)}"
    pdate = None
    m = _PDATE_RE.search(text)
    if m:
        month = _MONTHS.get(m.group(2).lower())
        if month:
            pdate = f"{int(m.group(3)):04d}-{month:02d}-{int(m.group(1)):02d}"
    return period, pdate


def scrape_manager_ids() -> list[dict]:
    """managers.php 에서 전체 매니저 ID + 이름 수집."""
    r = requests.get(f"{_BASE}/managers.php", headers=_HEADERS, timeout=15)
    r.raise_for_status()
    soup = BeautifulSoup(r.text, "html.parser")
    managers = []
    seen: set[str] = set()
    for a in soup.select("a[href*='holdings.php?m=']"):
        href = a.get("href", "")
        m_id = href.split("m=")[-1].split("&")[0].strip()
        name = a.get_text(strip=True)
        if m_id and name and m_id not in seen:
            seen.add(m_id)
            managers.append({"id": m_id, "name": name})
    return managers


def _parse_stock_row(cells) -> Optional[dict]:
    """grid 행(td 리스트)에서 ticker/name/weight_pct/activity 추출.

    cells[1] 형식: "AAPL- Apple Inc." — 헤더 행(Stock)은 대시가 없으므로 제외.
    ticker 없으면 None.
    """
    raw = cells[1].get_text(strip=True)
    if "-" not in raw:
        return None  # 헤더 행 스킵
    parts = raw.split("-", 1)
    ticker = parts[0].strip().upper()
    if not ticker:
        return None
    name = parts[1].strip() if len(parts) > 1 else ""
    try:
        weight_pct = float(cells[2].get_text(strip=True).replace("%", "").strip())
    except ValueError:
        weight_pct = 0.0
    row = {"ticker": ticker, "name": name, "weight_pct": weight_pct}
    # cells[3] = RecentActivity(직전 분기 대비 주식수 증감). 실제 페이지는 12칸이지만
    # 테스트 fixture는 3칸이라 있을 때만 읽는다. holdings.php는 페이지네이션이 없어
    # (VAN 133행 전부 확인) 이 층이 전 보유 종목 활동의 **정본**이다.
    if len(cells) > 3:
        activity = _parse_activity(cells[3].get_text(strip=True))
        if activity:
            row["activity"] = activity
    # cells[6] = Value(신고 금액, 예 '$57,843,261,000'). 이 값이 [[구루 자산 배분]]
    # 투자금의 정본이고, 없을 때만 소비측이 `비중 % × 포트폴리오 가치`로 추정한다.
    # 파싱 실패(0)는 키를 만들지 않는다 — 0원 보유로 읽히면 안 된다(wrong < missing).
    if len(cells) > 6:
        value = _parse_portfolio_value(cells[6].get_text(strip=True))
        if value:
            row["value"] = value
    return row


def scrape_holdings(manager_id: str) -> dict:
    """holdings.php?m={id} 에서 firm, portfolio_value, num_stocks, top10, holdings 추출.

    dataroma HTML 구조에 따라 CSS 선택자 조정이 필요할 수 있음.
    - 매니저 헤더: div#port_header
    - Portfolio value: span#portValue
    - Holdings 테이블: table#grid
    """
    r = requests.get(f"{_BASE}/holdings.php?m={manager_id}", headers=_HEADERS, timeout=15)
    r.raise_for_status()
    soup = BeautifulSoup(r.text, "html.parser")

    firm = ""
    firm_el = soup.select_one("div#f_name")
    if firm_el:
        firm = firm_el.get_text(strip=True)

    portfolio_value = 0
    period = None
    portfolio_date = None
    p2 = soup.select_one("p#p2")
    if p2:
        for span in p2.select("span"):
            text = span.get_text(strip=True)
            if text.startswith("$"):
                portfolio_value = _parse_portfolio_value(text)
                break
        # p2 형식: 'Period: Q1 2026 Portfolio date: 31 Mar 2026 No. of stocks: 133 ...'
        period, portfolio_date = _parse_period(p2.get_text(" ", strip=True))

    holdings = []
    table = soup.select_one("table#grid")
    if table:
        for row in table.select("tr"):
            cells = row.select("td")
            if len(cells) < 3:
                continue
            parsed = _parse_stock_row(cells)
            if parsed is None:
                continue
            holdings.append({"rank": len(holdings) + 1, **parsed})

    top10 = [{**h, "name_kr": ""} for h in holdings[:10]]

    return {
        "firm": firm,
        "portfolio_value": portfolio_value,
        "period": period,
        "portfolio_date": portfolio_date,
        "num_stocks": len(holdings),
        "top10": top10,
        "holdings": holdings,
    }


_ACT_ROW_TDS = 5        # hist · stock · activity · share change · % change
# 최신 분기가 100행(페이지 크기)을 넘을 때만 이어 받는다. 전수 실측 최대는 FE의 430행 =
# 5페이지라 상한을 5로 두면 여유가 0이다 — 거래가 조금만 늘어도 잘리므로 2배로 잡는다.
_ACT_MAX_PAGES = 10


def _parse_activity_page(html: str) -> tuple[Optional[str], list[dict], bool]:
    """m_activity.php 한 페이지에서 (최신 분기, 그 분기 행들, 최신 분기 완결여부) 추출.

    ⚠️ 이 표의 데이터 행에는 `<tr>` **시작 태그가 없다**(닫는 `</tr>`만 있다). 그래서
    `table.select("tr")`로는 분기 헤더 19개만 잡히고 데이터가 **한 행도 안 잡힌다**.
    올바른 관용구는 `table#grid`의 td를 문서 순서로 훑으며
      · `colspan=5`  → 분기 헤더(구분자)
      · `class=hist` → 행 시작 앵커, 거기서 5칸이 한 행
    으로 묶는 것이다. lxml 없이 html.parser로 동작함을 라이브 확인했다.

    두 번째 분기 헤더가 나오면 최신 분기가 그 페이지에서 끝났다는 뜻(=완결). 안 나오면
    100행 절단이므로 호출측이 `&L=N`으로 이어 받는다.
    """
    soup = BeautifulSoup(html, "html.parser")
    table = soup.select_one("table#grid")
    if not table:
        return None, [], True

    tds = table.select("td")
    period: Optional[str] = None
    quarters_seen = 0
    rows: list[dict] = []
    i = 0
    while i < len(tds):
        td = tds[i]
        if td.get("colspan"):
            quarters_seen += 1
            if quarters_seen == 1:
                # 헤더 텍스트는 'Q1 2026' 형태(<b>Q1</b> &nbsp <b>2026</b>)
                m = re.search(r"(Q[1-4])\s*(\d{4})", td.get_text(" ", strip=True))
                if m:
                    period = f"{m.group(1)} {m.group(2)}"
            else:
                break       # 다음(더 오래된) 분기 시작 → 최신 분기 완결
            i += 1
            continue
        # 표 헤더 행(History/Stock/…)은 class=hist 가 없어 이 조건에서 자연히 걸러진다
        if "hist" not in (td.get("class") or []) or i + _ACT_ROW_TDS > len(tds):
            i += 1
            continue

        stock_td, act_td, pct_td = tds[i + 1], tds[i + 2], tds[i + 4]
        a = stock_td.select_one("a")
        href = a.get("href", "") if a else ""
        ticker = href.split("sym=")[-1].split("&")[0].strip().upper() if "sym=" in href else ""
        span = a.select_one("span") if a else None
        name = span.get_text(strip=True).lstrip("- ").strip() if span else ""
        activity = _parse_activity(act_td.get_text(strip=True))
        if ticker and activity:
            try:
                port_pct = float(pct_td.get_text(strip=True).replace(",", "").replace("%", ""))
            except ValueError:
                port_pct = None
            rows.append({
                "ticker": ticker,
                "name": name,
                "kind": activity["kind"],
                "share_pct": activity["share_pct"],
                # ⚠️ '% change to portfolio'는 **무부호**로 온다(Reduce 2.78% → 0.50).
                #    방향은 kind가 갖고, td class(buy|sell)는 그 교차검증용으로만 싣는다.
                "port_pct": port_pct,
                "direction": "sell" if "sell" in (act_td.get("class") or []) else "buy",
            })
        i += _ACT_ROW_TDS

    return period, rows, quarters_seen >= 2


def scrape_activity(manager_id: str) -> dict:
    """m_activity.php 에서 **최신 분기** 활동을 모은다 → {period, rows, truncated}.

    100행 페이지네이션(`&L=2`, `&L=3`…)이 있고 기본 정렬이 Activity 내림차순이라
    `Sell`(전량매도)이 정확히 잘리는 쪽에 몰린다 — 그래서 최신 분기가 완결될 때까지
    페이지를 이어 받는다. 실측상 78명은 1요청으로 끝나고 5명만 추가 요청이 필요하다.
    상한에 닿으면 무엇이 잘렸는지 로그로 남긴다(무음 절단 금지).
    """
    rows: list[dict] = []
    period: Optional[str] = None
    truncated = False
    for page in range(1, _ACT_MAX_PAGES + 1):
        url = f"{_BASE}/m_activity.php?m={manager_id}&typ=a"
        if page > 1:
            url += f"&L={page}"
        r = requests.get(url, headers=_HEADERS, timeout=15)
        r.raise_for_status()
        page_period, page_rows, complete = _parse_activity_page(r.text)
        if period is None:
            period = page_period
        elif page_period and page_period != period:
            break       # 이 페이지는 이미 더 오래된 분기 — 최신 분기는 앞 페이지에서 끝났다
        rows.extend(page_rows)
        if complete:
            break
        time.sleep(0.35)
    else:
        truncated = True
        logger.warning(
            f"[Guru] 활동 페이지 상한 도달 — 최신 분기가 잘렸을 수 있다 "
            f"({manager_id}, {_ACT_MAX_PAGES}페이지 {len(rows)}행)"
        )
    return {"period": period, "rows": rows, "truncated": truncated}


def _enrich_activity(manager_id: str, details: dict) -> list[dict]:
    """활동 페이지(B)로 `port_pct`를 보강하고 전량매도 목록을 돌려준다.

    **A(holdings.php)가 kind/share_pct의 정본이고 B는 보강 전용**이다 — B는 100행 절단이
    있고 언제든 막힐 수 있으므로, 여기서 실패해도 A가 만든 activity는 그대로 남아
    활동 표시가 죽지 않는다(실패를 조용히 삼키지 말고 로그로 남긴다).
    반환: sold_out 목록(실패 시 빈 목록).
    """
    try:
        act = scrape_activity(manager_id)
    except Exception as e:
        logger.warning(f"[Guru] 활동 페이지 실패 — 비중 증감·전량매도 생략 ({manager_id}): {e}")
        return []

    # ⚠️ 활동 페이지는 **변동이 있던 분기만** 나열하므로 최신 그룹이 보유 스냅샷보다
    # 오래될 수 있다(라이브 확인: aq = 보유 Q2 2026 / 활동 Q4 2025). 그걸 그대로 조인하면
    # 3분기 전 매도가 "이번 분기 전량매도"로 뜬다 → 분기가 확인·일치할 때만 보강한다.
    expected = details.get("period")
    if not (expected and act["period"] and act["period"] == expected):
        logger.warning(
            f"[Guru] 활동 분기 불일치/미확인 — 비중 증감·전량매도 생략 "
            f"({manager_id}: 보유 {expected!r} vs 활동 {act['period']!r})"
        )
        return []

    by_ticker = {r["ticker"]: r for r in act["rows"] if r["kind"] != "sold_out"}
    # top10은 holdings의 얕은 복사(`{**h}`)라 activity 중첩 dict를 공유하지만, 그 암묵적
    # 별칭에 기대지 않고 두 계층을 명시적으로 순회한다(대입은 멱등).
    for lst in (details["holdings"], details["top10"]):
        for h in lst:
            src = by_ticker.get(h["ticker"])
            if h.get("activity") and src and src.get("port_pct") is not None:
                h["activity"]["port_pct"] = src["port_pct"]

    return [
        {"ticker": r["ticker"], "name": r["name"], "port_pct": r["port_pct"]}
        for r in act["rows"] if r["kind"] == "sold_out"
    ]


def scrape_all_managers(on_progress=None) -> tuple[list[dict], list[dict]]:
    """전체 매니저 크롤링. on_progress(done, total, current_name) 콜백 선택.

    반환 = **(성공한 매니저, 명부)**. 명부를 함께 돌려주는 이유(BH7-H1): 성공분만 반환하면
    호출부가 빠진 매니저를 *실패해서* 빠진 건지 *명부에서 사라져서* 빠진 건지 구별할 수 없어
    백필도 드롭도 못 한다.

    ⚠️ **명부의 신뢰성은 조건부다**(B28, task#274 정정). `scrape_manager_ids()`가 실패하면 예외가
    전파되므로 *전량* 실패는 여기 못 내려온다 — 그러나 `raise_for_status`는 HTTP 오류만 잡으므로
    **HTTP 200 + 마크업 변경**이면 예외 없이 *짧은* 명부가 그대로 내려온다. 그 경우 생존
    매니저가 '은퇴'로 오분류되므로, 드롭 판정을 하는 `storage.save_guru_managers`가
    `_ROSTER_MIN_COVERAGE` 커버리지 가드로 그 회차의 드롭을 보류한다. 즉 백필을 안전하게
    만드는 전제는 "명부가 항상 옳다"가 아니라 "명부가 수상하면 드롭하지 않는다"이다.
    """
    manager_ids = scrape_manager_ids()
    total = len(manager_ids)
    result = []
    name_kr_cache: dict[str, str] = {}

    for i, m in enumerate(manager_ids):
        if on_progress:
            on_progress(i, total, m["name"])
        try:
            details = scrape_holdings(m["id"])
            for h in details["top10"]:
                ticker = h["ticker"]
                if ticker not in name_kr_cache:
                    name_kr_cache[ticker] = get_name_kr(ticker)
                    time.sleep(0.1)
                h["name_kr"] = name_kr_cache[ticker]
            result.append({
                "id": m["id"],
                "name": m["name"],
                "firm": details["firm"],
                "portfolio_value": details["portfolio_value"],
                "period": details["period"],
                "portfolio_date": details["portfolio_date"],
                "num_stocks": details["num_stocks"],
                "top10": details["top10"],
                "holdings": details["holdings"],
                "sold_out": _enrich_activity(m["id"], details),
            })
        except Exception as e:
            logger.warning(f"[Guru] Failed for {m['name']}: {e}")
        time.sleep(0.5)

    if on_progress:
        on_progress(total, total, "")
    # 수집 성공률 — 부분 실패(83명 중 일부만 성공) 관측용. 두 호출부(배치·수동)가 공유.
    logger.info(f"[Guru] 수집 {len(result)}/{total}")
    return result, manager_ids

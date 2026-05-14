import requests
from bs4 import BeautifulSoup
import time

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


def scrape_holdings(manager_id: str) -> dict:
    """holdings.php?m={id} 에서 firm, portfolio_value, num_stocks, top10 추출.

    dataroma HTML 구조에 따라 CSS 선택자 조정이 필요할 수 있음.
    - 매니저 헤더: div#port_header
    - Portfolio value: span#portValue
    - Holdings 테이블: table#grid
    """
    r = requests.get(f"{_BASE}/holdings.php?m={manager_id}", headers=_HEADERS, timeout=15)
    r.raise_for_status()
    soup = BeautifulSoup(r.text, "html.parser")

    firm = ""
    header = soup.select_one("div#port_header")
    if header:
        firm_el = header.select_one("span.man, h1, h2")
        if firm_el:
            firm = firm_el.get_text(strip=True)

    portfolio_value = 0
    val_el = soup.select_one("span#portValue, td#portValue")
    if val_el:
        portfolio_value = _parse_portfolio_value(val_el.get_text(strip=True))

    top10 = []
    num_stocks = 0
    table = soup.select_one("table#grid")
    if table:
        all_data_rows = [row for row in table.select("tr") if row.select("td")]
        num_stocks = len(all_data_rows)
        for row in all_data_rows[:10]:
            cells = row.select("td")
            if len(cells) < 3:
                continue
            # 컬럼: [0]=# [1]=Stock(ticker+name) [2]=%Port [3]=Shares [4]=Value ...
            stock_cell = cells[1]
            ticker_link = stock_cell.select_one("a")
            raw = (ticker_link or stock_cell).get_text(strip=True)
            ticker = raw.split()[0].upper() if raw else ""
            name = raw[len(ticker):].strip() if ticker and raw.startswith(ticker) else ""
            try:
                weight_pct = float(cells[2].get_text(strip=True).replace("%", "").strip())
            except ValueError:
                weight_pct = 0.0
            if ticker:
                top10.append({
                    "rank": len(top10) + 1,
                    "ticker": ticker,
                    "name": name,
                    "name_kr": "",
                    "weight_pct": weight_pct,
                })

    return {"firm": firm, "portfolio_value": portfolio_value, "num_stocks": num_stocks, "top10": top10}


def scrape_all_managers(on_progress=None) -> list[dict]:
    """전체 매니저 크롤링. on_progress(done, total, current_name) 콜백 선택."""
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
                "num_stocks": details["num_stocks"],
                "top10": details["top10"],
            })
        except Exception as e:
            print(f"[Guru] Failed for {m['name']}: {e}")
        time.sleep(0.5)

    if on_progress:
        on_progress(total, total, "")
    return result

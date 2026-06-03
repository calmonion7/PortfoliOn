import requests
from bs4 import BeautifulSoup
import yfinance as yf
from datetime import datetime

_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/120.0.0.0 Safari/537.36"
    )
}

def scrape_finviz_consensus(ticker: str) -> dict:
    try:
        url = f"https://finviz.com/quote.ashx?t={ticker}"
        resp = requests.get(url, headers=_HEADERS, timeout=10)
        resp.raise_for_status()
        soup = BeautifulSoup(resp.text, "html.parser")
        table = soup.find("table", {"class": "snapshot-table2"})
        if not table:
            return {}
        cells = table.find_all("td")
        data = {}
        for i, cell in enumerate(cells):
            text = cell.get_text(strip=True)
            if text == "Recom" and i + 1 < len(cells):
                try:
                    data["finviz_recom"] = float(cells[i + 1].get_text(strip=True))
                except ValueError:
                    pass
            elif text == "Target Price" and i + 1 < len(cells):
                try:
                    data["finviz_target"] = float(cells[i + 1].get_text(strip=True))
                except ValueError:
                    pass
        return data
    except Exception:
        return {}

def get_news_kr(ticker: str) -> list[dict]:
    try:
        r = requests.get(
            f"https://m.stock.naver.com/api/stock/{ticker}/news",
            headers={
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
                "Referer": "https://m.stock.naver.com/",
                "Accept": "application/json, text/plain, */*",
            },
            timeout=8,
        )
        r.raise_for_status()
        data = r.json()

        # 응답: [{total, items: [...]}, ...] 형태
        raw_items = []
        if isinstance(data, list):
            for group in data:
                if isinstance(group, dict):
                    raw_items.extend(group.get("items") or [])
                elif isinstance(group, list):
                    raw_items.extend(group)
        elif isinstance(data, dict):
            raw_items = data.get("items") or data.get("newsList") or data.get("list") or []

        result = []
        for item in raw_items[:5]:
            title      = item.get("title") or item.get("headline") or ""
            office_id  = item.get("officeId", "")
            article_id = item.get("articleId", "")
            link = (
                f"https://n.news.naver.com/mnews/article/{office_id}/{article_id}"
                if office_id and article_id
                else item.get("link") or item.get("url") or ""
            )
            publisher = item.get("officeName") or item.get("source") or item.get("publisher") or ""
            raw_dt = item.get("datetime") or item.get("wdate") or item.get("publishedAt") or item.get("date") or ""
            # datetime 형식: "202606030922" → "2026-06-03 09:22"
            if raw_dt and len(raw_dt) >= 12 and raw_dt.isdigit():
                pub_date = f"{raw_dt[:4]}-{raw_dt[4:6]}-{raw_dt[6:8]} {raw_dt[8:10]}:{raw_dt[10:12]}"
            else:
                pub_date = str(raw_dt)[:16]
            if title:
                result.append({
                    "title": title,
                    "link": link,
                    "publisher": publisher,
                    "published_at": pub_date,
                })
        return result
    except Exception:
        return []


def get_news(ticker: str, market: str = "US") -> list[dict]:
    if market == "KR":
        return get_news_kr(ticker)

    try:
        t = yf.Ticker(ticker)
        raw = t.news or []
        result = []
        for item in raw[:5]:
            content = item.get("content") or item
            title = content.get("title") or item.get("title", "")
            link = (
                (content.get("canonicalUrl") or {}).get("url")
                or (content.get("clickThroughUrl") or {}).get("url")
                or item.get("link", "")
            )
            publisher = (
                (content.get("provider") or {}).get("displayName")
                or item.get("publisher", "")
            )
            pub_date = content.get("pubDate") or content.get("displayTime")
            if pub_date:
                try:
                    published_at = datetime.fromisoformat(
                        pub_date.replace("Z", "+00:00")
                    ).strftime("%Y-%m-%d %H:%M")
                except ValueError:
                    published_at = pub_date[:16]
            else:
                ts = item.get("providerPublishTime", 0)
                published_at = datetime.fromtimestamp(ts).strftime("%Y-%m-%d %H:%M") if ts else ""
            if title:
                result.append({"title": title, "link": link, "publisher": publisher, "published_at": published_at})
        return result
    except Exception:
        return []

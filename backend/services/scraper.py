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
    """Scrape Finviz for analyst recommendation score and target price."""
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

def get_news(ticker: str) -> list[dict]:
    """Fetch recent news via yfinance (sourced from Yahoo Finance)."""
    try:
        t = yf.Ticker(ticker)
        raw = t.news or []
        return [
            {
                "title": item.get("title", ""),
                "link": item.get("link", ""),
                "publisher": item.get("publisher", ""),
                "published_at": datetime.fromtimestamp(
                    item.get("providerPublishTime", 0)
                ).strftime("%Y-%m-%d %H:%M"),
            }
            for item in raw[:5]
        ]
    except Exception:
        return []

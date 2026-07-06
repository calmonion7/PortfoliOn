import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent.parent))

from unittest.mock import patch, MagicMock

from services import scraper


# ── _dedup_sort_limit (공유 후처리: 링크 중복제거 + 최신순 정렬 + limit) ──────

def test_dedup_sort_limit_dedups_by_link():
    items = [
        {"title": "A", "link": "https://x/1", "published_at": "2026-07-01 09:00"},
        {"title": "B (dup link)", "link": "https://x/1", "published_at": "2026-07-02 09:00"},
        {"title": "C", "link": "https://x/2", "published_at": "2026-07-03 09:00"},
    ]
    result = scraper._dedup_sort_limit(items, 10)
    links = [r["link"] for r in result]
    assert links.count("https://x/1") == 1
    assert len(result) == 2


def test_dedup_sort_limit_sorts_by_published_at_desc():
    items = [
        {"title": "old", "link": "https://x/1", "published_at": "2026-07-01 09:00"},
        {"title": "newest", "link": "https://x/2", "published_at": "2026-07-05 09:00"},
        {"title": "mid", "link": "https://x/3", "published_at": "2026-07-03 09:00"},
    ]
    result = scraper._dedup_sort_limit(items, 10)
    assert [r["title"] for r in result] == ["newest", "mid", "old"]


def test_dedup_sort_limit_caps_at_limit():
    items = [
        {"title": f"n{i}", "link": f"https://x/{i}", "published_at": f"2026-07-{i:02d} 09:00"}
        for i in range(1, 16)  # 15건
    ]
    result = scraper._dedup_sort_limit(items, 10)
    assert len(result) == 10
    assert result[0]["title"] == "n15"  # 최신순 최상단


# ── get_news_kr (Naver 스크레이프 경로) ──────────────────────────────────────

def _naver_item(idx, date_str, article_id=None):
    return {
        "title": f"KR news {idx}",
        "officeId": "001",
        "articleId": article_id or str(idx),
        "officeName": "연합뉴스",
        "datetime": date_str,  # "YYYYMMDDHHMM"
    }


def test_get_news_kr_applies_dedup_sort_limit():
    raw_items = [_naver_item(i, f"202607{i:02d}0900") for i in range(1, 13)]  # 12건, 링크 전부 고유
    raw_items.append(_naver_item(1, "202607200900"))  # article_id="1" 재사용 → 링크 중복(item 1과 동일)

    mock_resp = MagicMock()
    mock_resp.json.return_value = [{"items": raw_items}]
    mock_resp.raise_for_status.return_value = None

    with patch("services.scraper.requests.get", return_value=mock_resp):
        result = scraper.get_news_kr("005930")

    assert len(result) == 10
    links = [r["link"] for r in result]
    assert len(links) == len(set(links))  # 중복 링크 없음
    dates = [r["published_at"] for r in result]
    assert dates == sorted(dates, reverse=True)  # 최신순


# ── get_news (yfinance 경로, market=US 기본) ─────────────────────────────────

def _yf_item(idx):
    return {
        "content": {
            "title": f"US news {idx}",
            "canonicalUrl": {"url": f"https://news/{idx}"},
            "provider": {"displayName": "Reuters"},
            "pubDate": f"2026-07-{idx:02d}T09:00:00Z",
        }
    }


def test_get_news_us_applies_dedup_sort_limit():
    raw = [_yf_item(i) for i in range(1, 13)]  # 12건
    raw.append(_yf_item(1))  # 링크 중복

    mock_ticker = MagicMock()
    mock_ticker.news = raw

    with patch("services.scraper.yf.Ticker", return_value=mock_ticker):
        result = scraper.get_news("AAPL")

    assert len(result) == 10
    links = [r["link"] for r in result]
    assert len(links) == len(set(links))
    dates = [r["published_at"] for r in result]
    assert dates == sorted(dates, reverse=True)


def test_get_news_dispatches_kr_market():
    with patch("services.scraper.get_news_kr", return_value=[{"title": "x"}]) as mock_kr:
        result = scraper.get_news("005930", market="KR")
    mock_kr.assert_called_once_with("005930", 10)
    assert result == [{"title": "x"}]

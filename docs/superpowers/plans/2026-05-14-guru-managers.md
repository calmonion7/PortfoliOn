# 구루 매니저 기능 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** dataroma.com에서 포트폴리오 매니저 데이터를 크롤링·저장하고, 설정 페이지에서 매니저 목록 및 종목 추천 통계 3종을 제공한다.

**Architecture:** 기존 JSON 파일 저장 패턴 유지. 크롤링은 FastAPI BackgroundTasks로 비동기 실행, 진행률은 모듈 레벨 `_progress` dict 폴링. 통계 3종(인기순/매니저탑3/가중치)은 저장된 JSON을 읽어 실시간 계산. 프론트엔드는 Settings.jsx 탭 분리 후 구루 서브탭 3개 추가.

**Tech Stack:** Python/FastAPI, BeautifulSoup4, requests, APScheduler, React 18, axios

---

## 파일 구조

| 상태 | 파일 | 역할 |
|------|------|------|
| Modify | `backend/services/storage.py` | guru 관련 함수 4개 추가 |
| Create | `backend/services/guru_stats.py` | 통계 3종 순수 함수 |
| Create | `backend/services/guru_scraper.py` | dataroma 크롤링 + Naver 한글명 |
| Create | `backend/routers/guru.py` | API 엔드포인트 8개 |
| Modify | `backend/scheduler.py` | guru 스케줄 잡 추가 |
| Modify | `backend/main.py` | guru router 등록 |
| Create | `backend/tests/test_guru_stats.py` | 통계 함수 테스트 |
| Create | `backend/tests/test_guru_router.py` | 라우터 테스트 |
| Modify | `backend/tests/test_storage.py` | guru 스토리지 테스트 추가 |
| Modify | `frontend/src/pages/Settings.jsx` | 탭 구조로 재작성 |
| Create | `frontend/src/pages/ReportSchedule.jsx` | 기존 Settings 내용 분리 |
| Create | `frontend/src/pages/GuruManagers.jsx` | 매니저 목록 테이블 |
| Create | `frontend/src/pages/GuruStats.jsx` | 통계 3종 |
| Create | `frontend/src/pages/GuruCrawlSettings.jsx` | 크롤링/스케줄 설정 |

---

### Task 1: Storage — guru 함수 추가

**Files:**
- Modify: `backend/services/storage.py`
- Modify: `backend/tests/test_storage.py`

- [ ] **Step 1: 실패 테스트 작성** — `backend/tests/test_storage.py` 하단에 추가

```python
def test_get_guru_managers_returns_default_when_file_missing():
    import services.storage as storage_mod
    original = storage_mod.DATA_DIR
    storage_mod.DATA_DIR = Path("/nonexistent_dir_that_does_not_exist")
    try:
        result = storage_mod.get_guru_managers()
    finally:
        storage_mod.DATA_DIR = original
    assert result == {"last_updated": None, "managers": []}


def test_save_and_load_guru_managers_roundtrip(tmp_path):
    import services.storage as storage_mod
    with patch("services.storage.DATA_DIR", tmp_path):
        data = {
            "last_updated": "2026-05-14T10:00:00",
            "managers": [
                {
                    "id": "brk",
                    "name": "Warren Buffett",
                    "firm": "Berkshire Hathaway",
                    "portfolio_value": 350_000_000_000,
                    "num_stocks": 45,
                    "top10": [{"rank": 1, "ticker": "AAPL", "name": "Apple Inc.", "name_kr": "애플", "weight_pct": 42.1}],
                }
            ],
        }
        storage_mod.save_guru_managers(data)
        loaded = storage_mod.get_guru_managers()
    assert loaded == data


def test_get_guru_schedule_returns_default_when_file_missing():
    import services.storage as storage_mod
    original = storage_mod.DATA_DIR
    storage_mod.DATA_DIR = Path("/nonexistent_dir_that_does_not_exist")
    try:
        result = storage_mod.get_guru_schedule()
    finally:
        storage_mod.DATA_DIR = original
    assert result == {"enabled": False, "day": "sun", "time": "03:00"}


def test_save_and_load_guru_schedule_roundtrip(tmp_path):
    import services.storage as storage_mod
    with patch("services.storage.DATA_DIR", tmp_path):
        schedule = {"enabled": True, "day": "mon", "time": "04:00"}
        storage_mod.save_guru_schedule(schedule)
        loaded = storage_mod.get_guru_schedule()
    assert loaded == schedule
```

- [ ] **Step 2: 테스트 실패 확인**

```
cd backend && pytest tests/test_storage.py::test_get_guru_managers_returns_default_when_file_missing -v
```

Expected: `FAILED` — `AttributeError: module 'services.storage' has no attribute 'get_guru_managers'`

- [ ] **Step 3: storage.py 하단에 함수 추가**

```python
def get_guru_managers() -> dict:
    data = _read_json("guru_managers.json")
    return data if data is not None else {"last_updated": None, "managers": []}


def save_guru_managers(data: dict) -> None:
    _write_json("guru_managers.json", data)


def get_guru_schedule() -> dict:
    data = _read_json("guru_schedule.json")
    return data if data is not None else {"enabled": False, "day": "sun", "time": "03:00"}


def save_guru_schedule(schedule: dict) -> None:
    _write_json("guru_schedule.json", schedule)
```

- [ ] **Step 4: 테스트 통과 확인**

```
cd backend && pytest tests/test_storage.py -k "guru" -v
```

Expected: 4개 PASSED

- [ ] **Step 5: 커밋**

```
git add backend/services/storage.py backend/tests/test_storage.py
git commit -m "feat: storage — guru_managers / guru_schedule 함수 추가"
```

---

### Task 2: 통계 함수 (guru_stats.py)

**Files:**
- Create: `backend/services/guru_stats.py`
- Create: `backend/tests/test_guru_stats.py`

- [ ] **Step 1: 테스트 파일 작성** — `backend/tests/test_guru_stats.py` 생성

```python
import pytest
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent.parent))

from services.guru_stats import compute_popularity, compute_manager_top3, compute_weighted

SAMPLE = [
    {
        "id": "mgr1", "name": "Manager A", "firm": "Firm A",
        "portfolio_value": 1_000_000_000, "num_stocks": 10,
        "top10": [
            {"rank": 1, "ticker": "AAPL", "name": "Apple Inc.", "name_kr": "애플",           "weight_pct": 40.0},
            {"rank": 2, "ticker": "MSFT", "name": "Microsoft",  "name_kr": "마이크로소프트", "weight_pct": 20.0},
            {"rank": 3, "ticker": "GOOG", "name": "Alphabet",   "name_kr": "",               "weight_pct": 10.0},
        ],
    },
    {
        "id": "mgr2", "name": "Manager B", "firm": "Firm B",
        "portfolio_value": 500_000_000, "num_stocks": 8,
        "top10": [
            {"rank": 1, "ticker": "AAPL", "name": "Apple Inc.", "name_kr": "애플", "weight_pct": 35.0},
            {"rank": 2, "ticker": "GOOG", "name": "Alphabet",   "name_kr": "",    "weight_pct": 25.0},
        ],
    },
]


def test_compute_popularity_counts_managers_per_ticker():
    result = compute_popularity(SAMPLE)
    by_ticker = {r["ticker"]: r for r in result}
    assert by_ticker["AAPL"]["count"] == 2
    assert by_ticker["MSFT"]["count"] == 1
    assert by_ticker["GOOG"]["count"] == 2


def test_compute_popularity_sorted_by_count_desc():
    result = compute_popularity(SAMPLE)
    counts = [r["count"] for r in result]
    assert counts == sorted(counts, reverse=True)


def test_compute_popularity_includes_name_fields():
    result = compute_popularity(SAMPLE)
    aapl = next(r for r in result if r["ticker"] == "AAPL")
    assert aapl["name"] == "Apple Inc."
    assert aapl["name_kr"] == "애플"


def test_compute_manager_top3_returns_top3_per_manager():
    result = compute_manager_top3(SAMPLE)
    assert len(result) == 2
    mgr_a = next(r for r in result if r["manager_name"] == "Manager A")
    assert len(mgr_a["top3"]) == 3
    assert mgr_a["top3"][0]["ticker"] == "AAPL"


def test_compute_manager_top3_includes_global_count():
    result = compute_manager_top3(SAMPLE)
    mgr_a = next(r for r in result if r["manager_name"] == "Manager A")
    aapl_entry = next(h for h in mgr_a["top3"] if h["ticker"] == "AAPL")
    assert aapl_entry["count"] == 2


def test_compute_weighted_inverse_rank():
    result = compute_weighted(SAMPLE)
    by_ticker = {r["ticker"]: r for r in result}
    # AAPL: rank1(1.0) + rank1(1.0) = 2.0
    assert by_ticker["AAPL"]["score"] == pytest.approx(2.0, abs=0.001)
    # MSFT: rank2(0.5) = 0.5
    assert by_ticker["MSFT"]["score"] == pytest.approx(0.5, abs=0.001)
    # GOOG: rank3(0.333) + rank2(0.5) = 0.833
    assert by_ticker["GOOG"]["score"] == pytest.approx(0.833, abs=0.001)


def test_compute_weighted_sorted_by_score_desc():
    result = compute_weighted(SAMPLE)
    scores = [r["score"] for r in result]
    assert scores == sorted(scores, reverse=True)
```

- [ ] **Step 2: 테스트 실패 확인**

```
cd backend && pytest tests/test_guru_stats.py -v
```

Expected: `ERROR` — `ModuleNotFoundError: No module named 'services.guru_stats'`

- [ ] **Step 3: guru_stats.py 작성** — `backend/services/guru_stats.py` 생성

```python
def compute_popularity(managers: list[dict]) -> list[dict]:
    counts: dict[str, dict] = {}
    for m in managers:
        for h in m.get("top10", []):
            ticker = h["ticker"]
            if ticker not in counts:
                counts[ticker] = {
                    "ticker": ticker,
                    "name": h.get("name", ""),
                    "name_kr": h.get("name_kr", ""),
                    "count": 0,
                }
            counts[ticker]["count"] += 1
    return sorted(counts.values(), key=lambda x: -x["count"])


def compute_manager_top3(managers: list[dict]) -> list[dict]:
    global_counts: dict[str, int] = {}
    for m in managers:
        for h in m.get("top10", []):
            ticker = h["ticker"]
            global_counts[ticker] = global_counts.get(ticker, 0) + 1

    result = []
    for m in managers:
        sorted_holdings = sorted(m.get("top10", []), key=lambda h: h["rank"])[:3]
        result.append({
            "manager_name": m["name"],
            "firm": m.get("firm", ""),
            "top3": [
                {
                    "rank": h["rank"],
                    "ticker": h["ticker"],
                    "name_kr": h.get("name_kr", ""),
                    "count": global_counts.get(h["ticker"], 1),
                }
                for h in sorted_holdings
            ],
        })
    return result


def compute_weighted(managers: list[dict]) -> list[dict]:
    scores: dict[str, dict] = {}
    for m in managers:
        for h in m.get("top10", []):
            ticker = h["ticker"]
            score = 1.0 / h["rank"]
            if ticker not in scores:
                scores[ticker] = {
                    "ticker": ticker,
                    "name": h.get("name", ""),
                    "name_kr": h.get("name_kr", ""),
                    "score": 0.0,
                }
            scores[ticker]["score"] += score
    for v in scores.values():
        v["score"] = round(v["score"], 3)
    return sorted(scores.values(), key=lambda x: -x["score"])
```

- [ ] **Step 4: 테스트 통과 확인**

```
cd backend && pytest tests/test_guru_stats.py -v
```

Expected: 7개 PASSED

- [ ] **Step 5: 커밋**

```
git add backend/services/guru_stats.py backend/tests/test_guru_stats.py
git commit -m "feat: guru_stats — 인기순/탑3/가중치 통계 순수 함수"
```

---

### Task 3: Guru 스크레이퍼 (guru_scraper.py)

**Files:**
- Create: `backend/services/guru_scraper.py`

HTTP 의존성으로 단위 테스트 없이 수동 검증.

- [ ] **Step 1: guru_scraper.py 작성** — `backend/services/guru_scraper.py` 생성

```python
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
    )
}


def get_name_kr(ticker: str) -> str:
    """Naver Finance US 주식 API로 한글명 조회. 실패 시 빈 문자열."""
    try:
        r = requests.get(
            f"{_NAVER_US_BASE}/{ticker}/basic",
            headers=_HEADERS,
            timeout=5,
        )
        r.raise_for_status()
        data = r.json()
        return data.get("stockName") or data.get("name") or ""
    except Exception:
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
```

- [ ] **Step 2: 수동 검증** — backend 디렉터리에서 Python 실행

```python
from services.guru_scraper import scrape_manager_ids
ids = scrape_manager_ids()
print(len(ids), ids[:3])
```

Expected: 매니저 목록 출력. CSS 선택자가 맞지 않으면 `div#port_header`, `span#portValue`, `table#grid` 등을 실제 HTML에 맞게 조정.

- [ ] **Step 3: 커밋**

```
git add backend/services/guru_scraper.py
git commit -m "feat: guru_scraper — dataroma 크롤링 + Naver 한글명 조회"
```

---

### Task 4: Guru 라우터

**Files:**
- Create: `backend/routers/guru.py`
- Create: `backend/tests/test_guru_router.py`

- [ ] **Step 1: 테스트 파일 작성** — `backend/tests/test_guru_router.py` 생성

```python
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent.parent))

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from unittest.mock import patch, MagicMock

# guru router만 독립적으로 테스트하는 앱
from routers.guru import router
test_app = FastAPI()
test_app.include_router(router)
client = TestClient(test_app)

SAMPLE_DATA = {
    "last_updated": "2026-05-14T10:00:00",
    "managers": [
        {
            "id": "brk", "name": "Warren Buffett", "firm": "Berkshire Hathaway",
            "portfolio_value": 350_000_000_000, "num_stocks": 45,
            "top10": [
                {"rank": 1, "ticker": "AAPL", "name": "Apple Inc.", "name_kr": "애플", "weight_pct": 42.1},
                {"rank": 2, "ticker": "BAC",  "name": "Bank of America", "name_kr": "", "weight_pct": 10.3},
            ],
        }
    ],
}


def test_get_managers_returns_stored_data():
    with patch("routers.guru.storage.get_guru_managers", return_value=SAMPLE_DATA):
        r = client.get("/api/guru/managers")
    assert r.status_code == 200
    assert r.json()["managers"][0]["name"] == "Warren Buffett"


def test_get_managers_returns_empty_default():
    with patch("routers.guru.storage.get_guru_managers", return_value={"last_updated": None, "managers": []}):
        r = client.get("/api/guru/managers")
    assert r.status_code == 200
    assert r.json()["managers"] == []


def test_stats_popularity():
    with patch("routers.guru.storage.get_guru_managers", return_value=SAMPLE_DATA):
        r = client.get("/api/guru/stats/popularity")
    assert r.status_code == 200
    assert r.json()[0]["ticker"] == "AAPL"
    assert r.json()[0]["count"] == 1


def test_stats_manager_top3():
    with patch("routers.guru.storage.get_guru_managers", return_value=SAMPLE_DATA):
        r = client.get("/api/guru/stats/manager-top3")
    assert r.status_code == 200
    assert r.json()[0]["manager_name"] == "Warren Buffett"
    assert r.json()[0]["top3"][0]["ticker"] == "AAPL"


def test_stats_weighted():
    with patch("routers.guru.storage.get_guru_managers", return_value=SAMPLE_DATA):
        r = client.get("/api/guru/stats/weighted")
    assert r.status_code == 200
    assert r.json()[0]["ticker"] == "AAPL"
    assert r.json()[0]["score"] == pytest.approx(1.0, abs=0.001)


def test_crawl_progress_initial():
    r = client.get("/api/guru/crawl/progress")
    assert r.status_code == 200
    data = r.json()
    assert all(k in data for k in ("running", "done", "total", "current"))


def test_start_crawl_returns_202():
    with patch("routers.guru.scrape_all_managers", return_value=[]):
        with patch("routers.guru.storage.save_guru_managers"):
            r = client.post("/api/guru/crawl")
    assert r.status_code == 202


def test_get_guru_schedule():
    default = {"enabled": False, "day": "sun", "time": "03:00"}
    with patch("routers.guru.storage.get_guru_schedule", return_value=default):
        r = client.get("/api/guru/schedule")
    assert r.status_code == 200
    assert r.json()["day"] == "sun"


def test_update_guru_schedule_valid():
    with patch("routers.guru.storage.save_guru_schedule") as mock_save:
        with patch("routers.guru.sched.reload_guru"):
            r = client.put("/api/guru/schedule", json={"enabled": True, "day": "mon", "time": "04:00"})
    assert r.status_code == 200
    mock_save.assert_called_once()


def test_update_guru_schedule_missing_field():
    r = client.put("/api/guru/schedule", json={"enabled": True, "time": "04:00"})
    assert r.status_code == 400
```

- [ ] **Step 2: 테스트 실패 확인**

```
cd backend && pytest tests/test_guru_router.py -v
```

Expected: `ERROR` — `ImportError: cannot import name 'guru' from 'routers'`

- [ ] **Step 3: guru.py 라우터 작성** — `backend/routers/guru.py` 생성

```python
from fastapi import APIRouter, HTTPException, BackgroundTasks
from datetime import datetime
from services import storage
from services.guru_scraper import scrape_all_managers
from services.guru_stats import compute_popularity, compute_manager_top3, compute_weighted
import scheduler as sched

router = APIRouter(prefix="/api/guru", tags=["guru"])

_progress: dict = {"running": False, "done": 0, "total": 0, "current": ""}


@router.get("/managers")
def get_managers():
    return storage.get_guru_managers()


@router.get("/stats/popularity")
def stats_popularity():
    data = storage.get_guru_managers()
    return compute_popularity(data.get("managers", []))


@router.get("/stats/manager-top3")
def stats_manager_top3():
    data = storage.get_guru_managers()
    return compute_manager_top3(data.get("managers", []))


@router.get("/stats/weighted")
def stats_weighted():
    data = storage.get_guru_managers()
    return compute_weighted(data.get("managers", []))


@router.get("/crawl/progress")
def crawl_progress():
    return _progress


@router.post("/crawl", status_code=202)
def start_crawl(background_tasks: BackgroundTasks):
    if _progress["running"]:
        raise HTTPException(status_code=409, detail="Crawl already running")
    background_tasks.add_task(_run_crawl)
    return {"message": "Crawl started"}


def _run_crawl():
    def on_progress(done: int, total: int, current: str):
        _progress.update({"running": True, "done": done, "total": total, "current": current})

    _progress["running"] = True
    try:
        managers = scrape_all_managers(on_progress=on_progress)
        storage.save_guru_managers({
            "last_updated": datetime.now().isoformat(timespec="seconds"),
            "managers": managers,
        })
    except Exception as e:
        print(f"[Guru] Crawl failed: {e}")
    finally:
        _progress.update({"running": False, "current": ""})


@router.get("/schedule")
def get_schedule():
    return storage.get_guru_schedule()


@router.put("/schedule")
def update_schedule(schedule: dict):
    missing = {"enabled", "day", "time"} - schedule.keys()
    if missing:
        raise HTTPException(status_code=400, detail=f"Missing fields: {missing}")
    storage.save_guru_schedule(schedule)
    sched.reload_guru()
    return schedule
```

- [ ] **Step 4: 테스트 통과 확인**

```
cd backend && pytest tests/test_guru_router.py -v
```

Expected: 10개 PASSED

- [ ] **Step 5: 커밋**

```
git add backend/routers/guru.py backend/tests/test_guru_router.py
git commit -m "feat: guru router — managers / stats / crawl / schedule API"
```

---

### Task 5: main.py + scheduler.py 연결

**Files:**
- Modify: `backend/main.py`
- Modify: `backend/scheduler.py`

- [ ] **Step 1: main.py에 guru router 등록**

`from routers import portfolio, report, watchlist, stocks` 줄을 아래로 교체:

```python
from routers import portfolio, report, watchlist, stocks, guru
```

`app.include_router(stocks.router)` 다음 줄에 추가:

```python
app.include_router(guru.router)
```

- [ ] **Step 2: scheduler.py 수정** — 기존 `reload()` 함수 아래에 추가

```python
_GURU_JOB_ID = "guru_crawl"


def _run_guru_crawl():
    from services.guru_scraper import scrape_all_managers
    from datetime import datetime
    try:
        managers = scrape_all_managers()
        storage.save_guru_managers({
            "last_updated": datetime.now().isoformat(timespec="seconds"),
            "managers": managers,
        })
        print("[Scheduler] Guru crawl completed")
    except Exception as e:
        print(f"[Scheduler] Guru crawl failed: {e}")


def _reschedule_guru():
    cfg = storage.get_guru_schedule()
    if _scheduler.get_job(_GURU_JOB_ID):
        _scheduler.remove_job(_GURU_JOB_ID)
    if not cfg.get("enabled"):
        return
    time_parts = cfg["time"].split(":")
    hour, minute = int(time_parts[0]), int(time_parts[1])
    day = _DAY_MAP.get(cfg.get("day", "sun"), "sun")
    _scheduler.add_job(
        _run_guru_crawl,
        CronTrigger(day_of_week=day, hour=hour, minute=minute),
        id=_GURU_JOB_ID,
    )
    print(f"[Scheduler] Guru crawl scheduled at {cfg['time']} on {day}")


def reload_guru():
    _reschedule_guru()
```

`start()` 함수에 `_reschedule_guru()` 호출 추가:

```python
def start():
    _reschedule()
    _reschedule_guru()   # 추가
    _scheduler.start()
```

- [ ] **Step 3: 서버 기동 확인**

```
cd backend && python -m uvicorn main:app --reload --port 8000
```

브라우저에서 `http://localhost:8000/api/guru/managers` → `{"last_updated": null, "managers": []}` 확인

- [ ] **Step 4: 커밋**

```
git add backend/main.py backend/scheduler.py
git commit -m "feat: main + scheduler — guru router 등록 및 스케줄 잡 추가"
```

---

### Task 6: Settings.jsx 탭 분리 + ReportSchedule.jsx

**Files:**
- Modify: `frontend/src/pages/Settings.jsx`
- Create: `frontend/src/pages/ReportSchedule.jsx`

- [ ] **Step 1: ReportSchedule.jsx 생성** — 기존 Settings.jsx의 return 내용 전체를 그대로 옮기되 함수명만 변경

`frontend/src/pages/ReportSchedule.jsx` 생성:

```jsx
import { useState, useEffect, useRef } from 'react'
import axios from 'axios'

const DAYS = [
  { key: 'mon', label: '월' }, { key: 'tue', label: '화' },
  { key: 'wed', label: '수' }, { key: 'thu', label: '목' },
  { key: 'fri', label: '금' }, { key: 'sat', label: '토' },
  { key: 'sun', label: '일' },
]

export default function ReportSchedule() {
  const [schedule, setSchedule] = useState({ enabled: false, time: '08:00', days: ['mon', 'tue', 'wed', 'thu', 'fri'] })
  const [saved, setSaved] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [genMsg, setGenMsg] = useState('')
  const [progress, setProgress] = useState({ done: 0, total: 0, current: '' })
  const pollRef = useRef(null)

  useEffect(() => {
    axios.get('/api/schedule').then(({ data }) => setSchedule(data))
  }, [])

  const startPolling = () => {
    pollRef.current = setInterval(async () => {
      try {
        const { data } = await axios.get('/api/report/progress')
        setProgress({ done: data.done, total: data.total, current: data.current })
        if (!data.running && data.total > 0 && data.done >= data.total) {
          clearInterval(pollRef.current)
          setGenerating(false)
          setGenMsg(`완료: ${data.done}/${data.total} 종목 생성됨`)
        }
      } catch {}
    }, 1500)
  }

  const toggleDay = (day) => {
    setSchedule(s => ({
      ...s,
      days: s.days.includes(day) ? s.days.filter(d => d !== day) : [...s.days, day],
    }))
  }

  const handleSave = async () => {
    await axios.put('/api/schedule', schedule)
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  const handleGenerateNow = async () => {
    setGenerating(true)
    setGenMsg('')
    setProgress({ done: 0, total: 0, current: '' })
    try {
      await axios.post('/api/report/generate')
      startPolling()
    } catch (err) {
      setGenMsg(err.response?.data?.detail || '생성 실패')
      setGenerating(false)
    }
  }

  useEffect(() => () => clearInterval(pollRef.current), [])

  const pct = progress.total > 0 ? Math.round(progress.done / progress.total * 100) : 0

  return (
    <div style={{ maxWidth: 480 }}>
      <section style={{ background: '#1e1e2e', padding: 20, borderRadius: 8, marginBottom: 24 }}>
        <h2 style={{ color: '#80cbc4', marginBottom: 16, fontSize: 14 }}>자동 리포트 스케줄</h2>
        <div className="form-field" style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <label style={{ marginBottom: 0, width: 'auto' }}>자동 생성</label>
          <input type="checkbox" checked={schedule.enabled}
            onChange={e => setSchedule(s => ({ ...s, enabled: e.target.checked }))}
            style={{ width: 'auto' }} />
        </div>
        <div className="form-field">
          <label>생성 시간</label>
          <input type="time" value={schedule.time}
            onChange={e => setSchedule(s => ({ ...s, time: e.target.value }))}
            disabled={!schedule.enabled} />
        </div>
        <div className="form-field">
          <label style={{ marginBottom: 8 }}>요일</label>
          <div style={{ display: 'flex', gap: 8 }}>
            {DAYS.map(({ key, label }) => (
              <button key={key} type="button" onClick={() => toggleDay(key)}
                disabled={!schedule.enabled}
                style={{
                  padding: '4px 8px', borderRadius: 4, border: 'none',
                  cursor: schedule.enabled ? 'pointer' : 'default',
                  background: schedule.days.includes(key) ? '#1565c0' : '#333',
                  color: schedule.days.includes(key) ? 'white' : '#888',
                  opacity: schedule.enabled ? 1 : 0.5, fontSize: 13,
                }}>
                {label}
              </button>
            ))}
          </div>
        </div>
        <button className="btn-primary" onClick={handleSave}>{saved ? '저장됨' : '저장'}</button>
      </section>

      <section style={{ background: '#1e1e2e', padding: 20, borderRadius: 8 }}>
        <h2 style={{ color: '#80cbc4', marginBottom: 12, fontSize: 14 }}>즉시 리포트 생성</h2>
        <p style={{ color: '#aaa', fontSize: 13, marginBottom: 12 }}>보유 및 관심 종목 전체에 대해 즉시 리포트를 생성합니다. 종목당 30초~1분 소요됩니다.</p>
        <button className="btn-primary" onClick={handleGenerateNow} disabled={generating}>
          {generating ? '생성 중...' : '지금 생성'}
        </button>
        {generating && progress.total > 0 && (
          <div style={{ marginTop: 14 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, color: '#aaa', marginBottom: 6 }}>
              <span>{progress.current ? `생성 중: ${progress.current}` : '준비 중...'}</span>
              <span style={{ color: '#4fc3f7', fontWeight: 600 }}>{progress.done} / {progress.total}</span>
            </div>
            <div style={{ background: '#2a2a3a', borderRadius: 4, height: 8, overflow: 'hidden' }}>
              <div style={{ width: `${pct}%`, height: '100%', background: '#4fc3f7', borderRadius: 4, transition: 'width 0.4s ease' }} />
            </div>
            <div style={{ fontSize: 11, color: '#555', marginTop: 4, textAlign: 'right' }}>{pct}%</div>
          </div>
        )}
        {genMsg && <p style={{ marginTop: 8, color: '#66bb6a', fontSize: 13 }}>{genMsg}</p>}
      </section>
    </div>
  )
}
```

- [ ] **Step 2: Settings.jsx 전체 교체**

`frontend/src/pages/Settings.jsx` 전체를 아래로 교체:

```jsx
import { useState } from 'react'
import ReportSchedule from './ReportSchedule'
import GuruManagers from './GuruManagers'
import GuruStats from './GuruStats'
import GuruCrawlSettings from './GuruCrawlSettings'

const TOP_TABS  = [{ key: 'report', label: '리포트 스케줄' }, { key: 'guru', label: '구루 매니저' }]
const GURU_TABS = [{ key: 'managers', label: '매니저 목록' }, { key: 'stats', label: '추천 통계' }, { key: 'crawl', label: '크롤링 설정' }]

export default function Settings() {
  const [tab, setTab]         = useState('report')
  const [guruTab, setGuruTab] = useState('managers')

  const topTabStyle = (active) => ({
    padding: '8px 16px', border: 'none',
    borderBottom: active ? '2px solid #4fc3f7' : '2px solid transparent',
    background: 'none', color: active ? '#4fc3f7' : '#888',
    cursor: 'pointer', fontWeight: active ? 600 : 400, fontSize: 14,
  })

  const subTabStyle = (active) => ({
    padding: '6px 14px', borderRadius: 16,
    border: `1px solid ${active ? '#4fc3f7' : '#444'}`,
    background: active ? '#1565c0' : 'transparent',
    color: active ? 'white' : '#888',
    cursor: 'pointer', fontSize: 13,
  })

  return (
    <div style={{ maxWidth: 800 }}>
      <h1 style={{ color: '#90caf9', marginBottom: 20 }}>설정</h1>

      <div style={{ display: 'flex', borderBottom: '1px solid #333', marginBottom: 24 }}>
        {TOP_TABS.map(t => (
          <button key={t.key} style={topTabStyle(tab === t.key)} onClick={() => setTab(t.key)}>
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'report' && <ReportSchedule />}

      {tab === 'guru' && (
        <div>
          <div style={{ display: 'flex', gap: 8, marginBottom: 20 }}>
            {GURU_TABS.map(t => (
              <button key={t.key} style={subTabStyle(guruTab === t.key)} onClick={() => setGuruTab(t.key)}>
                {t.label}
              </button>
            ))}
          </div>
          {guruTab === 'managers' && <GuruManagers />}
          {guruTab === 'stats'    && <GuruStats />}
          {guruTab === 'crawl'    && <GuruCrawlSettings />}
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 3: 브라우저 확인** — `http://localhost:5173/settings` 에서 탭 전환, 기존 리포트 스케줄 기능 동작 확인

- [ ] **Step 4: 커밋**

```
git add frontend/src/pages/Settings.jsx frontend/src/pages/ReportSchedule.jsx
git commit -m "refactor: Settings — 탭 구조 분리 (리포트 스케줄 / 구루 매니저)"
```

---

### Task 7: GuruManagers.jsx

**Files:**
- Create: `frontend/src/pages/GuruManagers.jsx`

- [ ] **Step 1: GuruManagers.jsx 생성**

```jsx
import { useState, useEffect } from 'react'
import axios from 'axios'

function formatValue(val) {
  if (!val) return '-'
  if (val >= 1e12) return `$${(val / 1e12).toFixed(1)}T`
  if (val >= 1e9)  return `$${(val / 1e9).toFixed(1)}B`
  if (val >= 1e6)  return `$${(val / 1e6).toFixed(1)}M`
  return `$${val.toLocaleString()}`
}

const thStyle = { padding: '8px 12px', textAlign: 'left', fontWeight: 600, fontSize: 12 }
const tdStyle = { padding: '8px 12px', color: '#e0e0e0' }

export default function GuruManagers() {
  const [data, setData]       = useState({ last_updated: null, managers: [] })
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    axios.get('/api/guru/managers')
      .then(({ data }) => setData(data))
      .finally(() => setLoading(false))
  }, [])

  if (loading) return <p style={{ color: '#aaa' }}>로딩 중...</p>
  if (!data.managers.length) return (
    <p style={{ color: '#888', fontSize: 14 }}>
      데이터 없음 — "크롤링 설정" 탭에서 데이터를 가져오세요.
    </p>
  )

  return (
    <div>
      {data.last_updated && (
        <p style={{ color: '#666', fontSize: 12, marginBottom: 12 }}>마지막 갱신: {data.last_updated}</p>
      )}
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ borderBottom: '1px solid #333', color: '#80cbc4' }}>
              {['#', 'Manager', 'Firm', 'Portfolio Value', 'Stocks', 'Top 10'].map(h => (
                <th key={h} style={thStyle}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.managers.map((m, i) => (
              <tr key={m.id} style={{ borderBottom: '1px solid #222' }}>
                <td style={tdStyle}>{i + 1}</td>
                <td style={tdStyle}>{m.name}</td>
                <td style={{ ...tdStyle, color: '#aaa' }}>{m.firm}</td>
                <td style={tdStyle}>{formatValue(m.portfolio_value)}</td>
                <td style={{ ...tdStyle, textAlign: 'right' }}>{m.num_stocks}</td>
                <td style={tdStyle}>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                    {(m.top10 || []).map(h => (
                      <span
                        key={h.rank}
                        title={`#${h.rank} ${h.name || h.ticker}${h.name_kr ? ` (${h.name_kr})` : ''} — ${h.weight_pct}%`}
                        style={{
                          background: '#1e3a5f', color: '#4fc3f7',
                          borderRadius: 3, padding: '2px 6px',
                          fontSize: 11, fontWeight: 600, cursor: 'default',
                        }}
                      >
                        {h.ticker}
                      </span>
                    ))}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: 브라우저 확인** — 크롤링 전 "데이터 없음" 메시지, 크롤링 후 테이블 표시 확인. 티커 배지에 마우스 올리면 tooltip으로 한글명 + 비중 확인.

- [ ] **Step 3: 커밋**

```
git add frontend/src/pages/GuruManagers.jsx
git commit -m "feat: GuruManagers — 매니저 목록 테이블 (dataroma 스타일)"
```

---

### Task 8: GuruStats.jsx

**Files:**
- Create: `frontend/src/pages/GuruStats.jsx`

- [ ] **Step 1: GuruStats.jsx 생성**

```jsx
import { useState, useEffect } from 'react'
import axios from 'axios'

const WEIGHT_LEGEND = [1,2,3,4,5,6,7,8,9,10].map(r => ({ rank: r, score: (1/r).toFixed(3) }))
const thStyle = { padding: '8px 12px', textAlign: 'left', fontWeight: 600, fontSize: 12 }
const tdStyle = { padding: '8px 12px', color: '#e0e0e0' }

export default function GuruStats() {
  const [popularity, setPopularity] = useState([])
  const [top3, setTop3]             = useState([])
  const [weighted, setWeighted]     = useState([])
  const [loading, setLoading]       = useState(true)

  useEffect(() => {
    Promise.all([
      axios.get('/api/guru/stats/popularity'),
      axios.get('/api/guru/stats/manager-top3'),
      axios.get('/api/guru/stats/weighted'),
    ]).then(([p, t, w]) => {
      setPopularity(p.data)
      setTop3(t.data)
      setWeighted(w.data)
    }).finally(() => setLoading(false))
  }, [])

  if (loading) return <p style={{ color: '#aaa' }}>로딩 중...</p>
  if (!popularity.length) return (
    <p style={{ color: '#888', fontSize: 14 }}>데이터 없음 — 크롤링을 먼저 실행하세요.</p>
  )

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 32 }}>

      {/* ① 전체 인기순 */}
      <section>
        <h3 style={{ color: '#80cbc4', fontSize: 14, marginBottom: 12 }}>① 전체 종목 인기순 (카운트)</h3>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ borderBottom: '1px solid #333', color: '#80cbc4' }}>
              <th style={thStyle}>#</th>
              <th style={thStyle}>티커</th>
              <th style={thStyle}>영문명</th>
              <th style={thStyle}>한글명</th>
              <th style={{ ...thStyle, textAlign: 'right' }}>매니저 수</th>
            </tr>
          </thead>
          <tbody>
            {popularity.map((row, i) => (
              <tr key={row.ticker} style={{ borderBottom: '1px solid #222' }}>
                <td style={tdStyle}>{i + 1}</td>
                <td style={{ ...tdStyle, fontWeight: 600, color: '#4fc3f7' }}>{row.ticker}</td>
                <td style={{ ...tdStyle, color: '#aaa' }}>{row.name}</td>
                <td style={tdStyle}>{row.name_kr || '-'}</td>
                <td style={{ ...tdStyle, textAlign: 'right' }}>{row.count}명</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {/* ② 매니저별 탑3 */}
      <section>
        <h3 style={{ color: '#80cbc4', fontSize: 14, marginBottom: 12 }}>② 매니저별 탑3 인기순</h3>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ borderBottom: '1px solid #333', color: '#80cbc4' }}>
              <th style={thStyle}>Manager</th>
              {[1, 2, 3].map(r => <th key={r} style={thStyle}>{r}위 (전체보유)</th>)}
            </tr>
          </thead>
          <tbody>
            {top3.map(m => (
              <tr key={m.manager_name} style={{ borderBottom: '1px solid #222' }}>
                <td style={tdStyle}>{m.manager_name}</td>
                {[0, 1, 2].map(i => {
                  const h = m.top3[i]
                  return (
                    <td key={i} style={tdStyle}>
                      {h ? (
                        <>
                          <span style={{ color: '#4fc3f7', fontWeight: 600 }}>{h.ticker}</span>
                          {h.name_kr && <span style={{ color: '#aaa', fontSize: 11 }}> {h.name_kr}</span>}
                          <span style={{ color: '#666', fontSize: 11 }}> ({h.count}명)</span>
                        </>
                      ) : '-'}
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {/* ③ 가중치 통계 */}
      <section>
        <h3 style={{ color: '#80cbc4', fontSize: 14, marginBottom: 8 }}>③ 전체 종목 가중치 통계 (역수 합산)</h3>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 12 }}>
          {WEIGHT_LEGEND.map(({ rank, score }) => (
            <span key={rank} style={{ fontSize: 11, color: '#666', background: '#1e1e2e', padding: '2px 6px', borderRadius: 3 }}>
              {rank}위={score}
            </span>
          ))}
        </div>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ borderBottom: '1px solid #333', color: '#80cbc4' }}>
              <th style={thStyle}>#</th>
              <th style={thStyle}>티커</th>
              <th style={thStyle}>한글명</th>
              <th style={{ ...thStyle, textAlign: 'right' }}>가중치 합계</th>
            </tr>
          </thead>
          <tbody>
            {weighted.map((row, i) => (
              <tr key={row.ticker} style={{ borderBottom: '1px solid #222' }}>
                <td style={tdStyle}>{i + 1}</td>
                <td style={{ ...tdStyle, fontWeight: 600, color: '#4fc3f7' }}>{row.ticker}</td>
                <td style={tdStyle}>{row.name_kr || row.name || '-'}</td>
                <td style={{ ...tdStyle, textAlign: 'right', fontWeight: 600 }}>{row.score.toFixed(3)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

    </div>
  )
}
```

- [ ] **Step 2: 브라우저 확인** — 3개 섹션 정상 렌더링, 가중치 범례 표시 확인

- [ ] **Step 3: 커밋**

```
git add frontend/src/pages/GuruStats.jsx
git commit -m "feat: GuruStats — 인기순 / 매니저탑3 / 가중치 통계 화면"
```

---

### Task 9: GuruCrawlSettings.jsx

**Files:**
- Create: `frontend/src/pages/GuruCrawlSettings.jsx`

- [ ] **Step 1: GuruCrawlSettings.jsx 생성**

```jsx
import { useState, useEffect, useRef } from 'react'
import axios from 'axios'

const DAYS = [
  { key: 'mon', label: '월' }, { key: 'tue', label: '화' },
  { key: 'wed', label: '수' }, { key: 'thu', label: '목' },
  { key: 'fri', label: '금' }, { key: 'sat', label: '토' },
  { key: 'sun', label: '일' },
]

export default function GuruCrawlSettings() {
  const [schedule, setSchedule]   = useState({ enabled: false, day: 'sun', time: '03:00' })
  const [saved, setSaved]         = useState(false)
  const [crawling, setCrawling]   = useState(false)
  const [crawlMsg, setCrawlMsg]   = useState('')
  const [progress, setProgress]   = useState({ done: 0, total: 0, current: '' })
  const [lastUpdated, setLastUpdated] = useState(null)
  const pollRef = useRef(null)

  useEffect(() => {
    axios.get('/api/guru/schedule').then(({ data }) => setSchedule(data))
    axios.get('/api/guru/managers').then(({ data }) => setLastUpdated(data.last_updated))
  }, [])

  const startPolling = () => {
    pollRef.current = setInterval(async () => {
      try {
        const { data } = await axios.get('/api/guru/crawl/progress')
        setProgress({ done: data.done, total: data.total, current: data.current })
        if (!data.running && data.total > 0 && data.done >= data.total) {
          clearInterval(pollRef.current)
          setCrawling(false)
          setCrawlMsg(`완료: ${data.done}명 매니저 데이터 수집됨`)
          axios.get('/api/guru/managers').then(({ data }) => setLastUpdated(data.last_updated))
        }
      } catch {}
    }, 2000)
  }

  const handleCrawlNow = async () => {
    setCrawling(true)
    setCrawlMsg('')
    setProgress({ done: 0, total: 0, current: '' })
    try {
      await axios.post('/api/guru/crawl')
      startPolling()
    } catch (err) {
      setCrawlMsg(err.response?.data?.detail || '크롤링 실패')
      setCrawling(false)
    }
  }

  const handleSave = async () => {
    await axios.put('/api/guru/schedule', schedule)
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  useEffect(() => () => clearInterval(pollRef.current), [])

  const pct = progress.total > 0 ? Math.round(progress.done / progress.total * 100) : 0

  return (
    <div style={{ maxWidth: 480 }}>

      {/* 즉시 크롤링 */}
      <section style={{ background: '#1e1e2e', padding: 20, borderRadius: 8, marginBottom: 20 }}>
        <h2 style={{ color: '#80cbc4', marginBottom: 8, fontSize: 14 }}>즉시 크롤링</h2>
        <p style={{ color: '#aaa', fontSize: 13, marginBottom: 12 }}>
          dataroma 전체 매니저 데이터를 지금 수집합니다. 수 분 소요됩니다.
        </p>
        {lastUpdated && (
          <p style={{ color: '#666', fontSize: 12, marginBottom: 10 }}>마지막 갱신: {lastUpdated}</p>
        )}
        <button className="btn-primary" onClick={handleCrawlNow} disabled={crawling}>
          {crawling ? '수집 중...' : '지금 갱신'}
        </button>
        {crawling && (
          <div style={{ marginTop: 14 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, color: '#aaa', marginBottom: 6 }}>
              <span>{progress.current ? `수집 중: ${progress.current}` : '준비 중...'}</span>
              <span style={{ color: '#4fc3f7', fontWeight: 600 }}>
                {progress.done} / {progress.total || '?'}
              </span>
            </div>
            <div style={{ background: '#2a2a3a', borderRadius: 4, height: 8, overflow: 'hidden' }}>
              <div style={{ width: `${pct}%`, height: '100%', background: '#4fc3f7', borderRadius: 4, transition: 'width 0.4s ease' }} />
            </div>
            <div style={{ fontSize: 11, color: '#555', marginTop: 4, textAlign: 'right' }}>{pct}%</div>
          </div>
        )}
        {crawlMsg && <p style={{ marginTop: 8, color: '#66bb6a', fontSize: 13 }}>{crawlMsg}</p>}
      </section>

      {/* 자동 스케줄 */}
      <section style={{ background: '#1e1e2e', padding: 20, borderRadius: 8 }}>
        <h2 style={{ color: '#80cbc4', marginBottom: 16, fontSize: 14 }}>자동 갱신 스케줄</h2>
        <div className="form-field" style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <label style={{ marginBottom: 0, width: 'auto' }}>자동 갱신</label>
          <input type="checkbox" checked={schedule.enabled}
            onChange={e => setSchedule(s => ({ ...s, enabled: e.target.checked }))}
            style={{ width: 'auto' }} />
        </div>
        <div className="form-field">
          <label style={{ marginBottom: 8 }}>요일 (주 1회)</label>
          <div style={{ display: 'flex', gap: 8 }}>
            {DAYS.map(({ key, label }) => (
              <button key={key} type="button"
                onClick={() => setSchedule(s => ({ ...s, day: key }))}
                disabled={!schedule.enabled}
                style={{
                  padding: '4px 8px', borderRadius: 4, border: 'none',
                  cursor: schedule.enabled ? 'pointer' : 'default',
                  background: schedule.day === key ? '#1565c0' : '#333',
                  color: schedule.day === key ? 'white' : '#888',
                  opacity: schedule.enabled ? 1 : 0.5, fontSize: 13,
                }}>
                {label}
              </button>
            ))}
          </div>
        </div>
        <div className="form-field">
          <label>실행 시간</label>
          <input type="time" value={schedule.time}
            onChange={e => setSchedule(s => ({ ...s, time: e.target.value }))}
            disabled={!schedule.enabled} />
        </div>
        <button className="btn-primary" onClick={handleSave}>{saved ? '저장됨' : '저장'}</button>
      </section>

    </div>
  )
}
```

- [ ] **Step 2: 브라우저 확인**
  - "지금 갱신" 클릭 → 진행률 바 표시 확인
  - 완료 후 "완료: N명 매니저 데이터 수집됨" 메시지 및 마지막 갱신 시각 업데이트 확인
  - 스케줄 설정 저장 확인

- [ ] **Step 3: 커밋**

```
git add frontend/src/pages/GuruCrawlSettings.jsx
git commit -m "feat: GuruCrawlSettings — 즉시 크롤링 + 자동 스케줄 설정"
```

---

## 전체 검증

- [ ] **백엔드 전체 테스트**

```
cd backend && pytest -v
```

Expected: 전체 PASSED (기존 테스트 포함)

- [ ] **E2E 시나리오**
  1. `start.bat` 실행 → 서버 기동
  2. 설정 → 구루 매니저 → 크롤링 설정 → "지금 갱신" 클릭
  3. 진행률 표시 확인
  4. 완료 후 "매니저 목록" 탭에서 데이터 표시 확인
  5. "추천 통계" 탭에서 3개 섹션 데이터 확인

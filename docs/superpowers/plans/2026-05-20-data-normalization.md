# Data Normalization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 분산된 3개 JSON 파일을 통합하고, 마크다운 리포트를 JSON API로 교체하며, 프론트엔드를 섹션 컴포넌트 렌더링으로 전환한다.

**Architecture:** `backend/data/stocks.json`에 holdings/watchlist 통합, `backend/snapshots/`에 JSON 스냅샷 저장(마크다운 제거), in-memory 캐시로 읽기 성능 개선. 프론트엔드는 `MarkdownViewer` 대신 5개 섹션 컴포넌트로 렌더링.

**Tech Stack:** Python/FastAPI, React 18, `collections.OrderedDict` (LRU), `time.time()` (TTL)

---

## File Map

| 파일 | 변경 | 역할 |
|---|---|---|
| `backend/data/stocks.json` | 교체 | holdings+watchlist+analyst 통합 |
| `backend/data/holdings.json` | 삭제 | 통합 후 제거 |
| `backend/data/watchlist.json` | 삭제 | 통합 후 제거 |
| `backend/migrate_data.py` | 신규 | 일회성 마이그레이션 스크립트 |
| `backend/services/storage.py` | 수정 | 통합 파일 read/write |
| `backend/services/cache.py` | 신규 | LRU+TTL in-memory 캐시 |
| `backend/services/report_generator.py` | 수정 | JSON 전용, 새 필드, snapshots/ 경로 |
| `backend/routers/report.py` | 수정 | snapshots/ 경로, content 제거, 캐시 적용 |
| `backend/main.py` | 수정 | reports static 제거, snapshots/ 디렉토리 생성 |
| `backend/tests/test_storage.py` | 수정 | 통합 파일 기반 테스트 |
| `backend/tests/test_cache.py` | 신규 | 캐시 동작 테스트 |
| `backend/tests/test_report_generator.py` | 수정 | JSON-only, 새 필드 테스트 |
| `backend/tests/test_report_router.py` | 수정 | snapshots/ 경로, content 없음 테스트 |
| `frontend/src/pages/Reports.jsx` | 수정 | 섹션 컴포넌트, content 제거 |
| `frontend/src/components/MarkdownViewer.jsx` | 삭제 | 더 이상 사용 안 함 |

---

## Task 1: 데이터 마이그레이션 스크립트

**Files:**
- Create: `backend/migrate_data.py`

- [ ] **Step 1: 스크립트 작성**

`backend/migrate_data.py`:
```python
"""One-shot migration: merge holdings.json + watchlist.json + stocks.json → unified stocks.json"""
import json
from pathlib import Path

DATA_DIR = Path(__file__).parent / "data"


def _read(name):
    p = DATA_DIR / name
    return json.loads(p.read_text(encoding="utf-8")) if p.exists() else {}


holdings = _read("holdings.json").get("holdings", [])
watchlist = _read("watchlist.json").get("watchlist", [])
stocks_meta = {s["ticker"]: s for s in _read("stocks.json").get("stocks", [])}

unified = []
holding_tickers = set()

for h in holdings:
    t = h["ticker"].upper()
    holding_tickers.add(t)
    meta = stocks_meta.get(t, {})
    unified.append({
        "ticker": t,
        "name": meta.get("name", t),
        "market": h.get("market", meta.get("market", "US")),
        "exchange": h.get("exchange", meta.get("exchange", "")),
        "type": "holding",
        "quantity": h["quantity"],
        "avg_cost": h["avg_cost"],
        "competitors": meta.get("competitors", []),
        "moat": meta.get("moat", ""),
        "growth_plan": meta.get("growth_plan", ""),
        "recent_disclosures": meta.get("recent_disclosures", ""),
        "risks": meta.get("risks", ""),
    })

for ticker_str in watchlist:
    t = ticker_str.upper()
    if t in holding_tickers:
        continue
    meta = stocks_meta.get(t, {})
    unified.append({
        "ticker": t,
        "name": meta.get("name", t),
        "market": meta.get("market", "US"),
        "exchange": meta.get("exchange", ""),
        "type": "watchlist",
        "quantity": None,
        "avg_cost": None,
        "competitors": meta.get("competitors", []),
        "moat": meta.get("moat", ""),
        "growth_plan": meta.get("growth_plan", ""),
        "recent_disclosures": meta.get("recent_disclosures", ""),
        "risks": meta.get("risks", ""),
    })

# stocks.json에만 있고 holdings/watchlist에 없는 항목
covered = holding_tickers | {t.upper() for t in watchlist}
for t, meta in stocks_meta.items():
    if t.upper() not in covered:
        unified.append({
            "ticker": t.upper(),
            "name": meta.get("name", t),
            "market": meta.get("market", "US"),
            "exchange": meta.get("exchange", ""),
            "type": "watchlist",
            "quantity": None,
            "avg_cost": None,
            "competitors": meta.get("competitors", []),
            "moat": meta.get("moat", ""),
            "growth_plan": meta.get("growth_plan", ""),
            "recent_disclosures": meta.get("recent_disclosures", ""),
            "risks": meta.get("risks", ""),
        })

(DATA_DIR / "stocks.json").write_text(
    json.dumps({"stocks": unified}, ensure_ascii=False, indent=2),
    encoding="utf-8"
)
print(f"Migrated {len(unified)} stocks ({len(holding_tickers)} holdings, {len(unified) - len(holding_tickers)} watchlist)")

for f in ["holdings.json", "watchlist.json"]:
    p = DATA_DIR / f
    if p.exists():
        p.unlink()
        print(f"Deleted {f}")
```

- [ ] **Step 2: 스크립트 실행**

```bash
cd /path/to/project/backend && source .venv/bin/activate && python migrate_data.py
```

Expected output:
```
Migrated N stocks (M holdings, K watchlist)
Deleted holdings.json
Deleted watchlist.json
```

- [ ] **Step 3: 결과 확인**

```bash
python3 -c "
import json; from pathlib import Path
d = json.loads((Path('data/stocks.json')).read_text())
stocks = d['stocks']
holdings = [s for s in stocks if s['type'] == 'holding']
watchlist = [s for s in stocks if s['type'] == 'watchlist']
print(f'Holdings: {len(holdings)}, Watchlist: {len(watchlist)}')
print('First holding:', json.dumps(stocks[0], ensure_ascii=False, indent=2)[:300])
"
```

Expected: `type`, `quantity`, `avg_cost`, `moat` 필드가 하나의 항목에 모두 있음.

- [ ] **Step 4: 커밋**

```bash
git add backend/migrate_data.py backend/data/stocks.json
git commit -m "feat: merge holdings/watchlist/stocks into unified stocks.json"
```

---

## Task 2: `storage.py` — 통합 파일 read/write

**Files:**
- Modify: `backend/services/storage.py`
- Modify: `backend/tests/test_storage.py`

- [ ] **Step 1: 실패 테스트 작성**

`backend/tests/test_storage.py`를 아래로 교체:

```python
import pytest
from pathlib import Path
from unittest.mock import patch


def test_get_holdings_from_unified(tmp_path):
    import services.storage as s
    with patch("services.storage.DATA_DIR", tmp_path):
        s._save_unified([
            {"ticker": "LLY", "type": "holding", "quantity": 3.0, "avg_cost": 886.6,
             "name": "일라이 릴리", "market": "US", "exchange": "",
             "competitors": [], "moat": "", "growth_plan": "", "risks": "", "recent_disclosures": ""},
            {"ticker": "TSLA", "type": "watchlist", "quantity": None, "avg_cost": None,
             "name": "테슬라", "market": "US", "exchange": "",
             "competitors": [], "moat": "", "growth_plan": "", "risks": "", "recent_disclosures": ""},
        ])
        holdings = s.get_holdings()
    assert len(holdings) == 1
    assert holdings[0]["ticker"] == "LLY"
    assert holdings[0]["quantity"] == 3.0
    assert "moat" not in holdings[0]


def test_get_watchlist_tickers_from_unified(tmp_path):
    import services.storage as s
    with patch("services.storage.DATA_DIR", tmp_path):
        s._save_unified([
            {"ticker": "LLY", "type": "holding", "quantity": 3.0, "avg_cost": 886.6,
             "name": "LLY", "market": "US", "exchange": "",
             "competitors": [], "moat": "", "growth_plan": "", "risks": "", "recent_disclosures": ""},
            {"ticker": "TSLA", "type": "watchlist", "quantity": None, "avg_cost": None,
             "name": "TSLA", "market": "US", "exchange": "",
             "competitors": [], "moat": "", "growth_plan": "", "risks": "", "recent_disclosures": ""},
        ])
        tickers = s.get_watchlist_tickers()
    assert tickers == ["TSLA"]


def test_save_holdings_updates_unified(tmp_path):
    import services.storage as s
    with patch("services.storage.DATA_DIR", tmp_path):
        s._save_unified([
            {"ticker": "LLY", "type": "holding", "quantity": 3.0, "avg_cost": 886.6,
             "name": "LLY", "market": "US", "exchange": "",
             "competitors": [], "moat": "Strong", "growth_plan": "", "risks": "", "recent_disclosures": ""},
        ])
        s.save_holdings([{"ticker": "LLY", "quantity": 5.0, "avg_cost": 900.0, "market": "US", "exchange": ""}])
        unified = s._get_unified()
    lly = next(x for x in unified if x["ticker"] == "LLY")
    assert lly["quantity"] == 5.0
    assert lly["avg_cost"] == 900.0
    assert lly["moat"] == "Strong"  # analyst fields preserved


def test_save_holdings_demotes_removed_to_watchlist(tmp_path):
    import services.storage as s
    with patch("services.storage.DATA_DIR", tmp_path):
        s._save_unified([
            {"ticker": "LLY", "type": "holding", "quantity": 3.0, "avg_cost": 886.6,
             "name": "LLY", "market": "US", "exchange": "",
             "competitors": [], "moat": "", "growth_plan": "", "risks": "", "recent_disclosures": ""},
            {"ticker": "PLTR", "type": "holding", "quantity": 10.0, "avg_cost": 50.0,
             "name": "PLTR", "market": "US", "exchange": "",
             "competitors": [], "moat": "", "growth_plan": "", "risks": "", "recent_disclosures": ""},
        ])
        # Save holdings with LLY removed
        s.save_holdings([{"ticker": "PLTR", "quantity": 10.0, "avg_cost": 50.0, "market": "US", "exchange": ""}])
        unified = s._get_unified()
    lly = next((x for x in unified if x["ticker"] == "LLY"), None)
    assert lly is not None
    assert lly["type"] == "watchlist"
    assert lly["quantity"] is None


def test_save_watchlist_tickers_adds_to_unified(tmp_path):
    import services.storage as s
    with patch("services.storage.DATA_DIR", tmp_path):
        s._save_unified([])
        s.save_watchlist_tickers(["AAPL", "GOOG"])
        unified = s._get_unified()
    tickers = {x["ticker"] for x in unified}
    assert "AAPL" in tickers
    assert "GOOG" in tickers
    assert all(x["type"] == "watchlist" for x in unified)


def test_save_watchlist_does_not_demote_holdings(tmp_path):
    import services.storage as s
    with patch("services.storage.DATA_DIR", tmp_path):
        s._save_unified([
            {"ticker": "LLY", "type": "holding", "quantity": 3.0, "avg_cost": 886.6,
             "name": "LLY", "market": "US", "exchange": "",
             "competitors": [], "moat": "", "growth_plan": "", "risks": "", "recent_disclosures": ""},
        ])
        # LLY is not in the watchlist list
        s.save_watchlist_tickers(["TSLA"])
        unified = s._get_unified()
    lly = next(x for x in unified if x["ticker"] == "LLY")
    assert lly["type"] == "holding"  # not demoted


def test_save_stocks_updates_analyst_fields(tmp_path):
    import services.storage as s
    with patch("services.storage.DATA_DIR", tmp_path):
        s._save_unified([
            {"ticker": "LLY", "type": "holding", "quantity": 3.0, "avg_cost": 886.6,
             "name": "Old Name", "market": "US", "exchange": "",
             "competitors": [], "moat": "", "growth_plan": "", "risks": "", "recent_disclosures": ""},
        ])
        s.save_stocks([{"ticker": "LLY", "name": "New Name", "competitors": ["NVO"],
                        "moat": "Strong", "growth_plan": "GLP1", "market": "US", "exchange": ""}])
        unified = s._get_unified()
    lly = next(x for x in unified if x["ticker"] == "LLY")
    assert lly["name"] == "New Name"
    assert lly["moat"] == "Strong"
    assert lly["type"] == "holding"  # type preserved
    assert lly["quantity"] == 3.0   # position preserved


def test_save_stocks_removes_non_holdings_not_in_list(tmp_path):
    import services.storage as s
    with patch("services.storage.DATA_DIR", tmp_path):
        s._save_unified([
            {"ticker": "LLY", "type": "holding", "quantity": 3.0, "avg_cost": 886.6,
             "name": "LLY", "market": "US", "exchange": "",
             "competitors": [], "moat": "", "growth_plan": "", "risks": "", "recent_disclosures": ""},
            {"ticker": "TSLA", "type": "watchlist", "quantity": None, "avg_cost": None,
             "name": "TSLA", "market": "US", "exchange": "",
             "competitors": [], "moat": "", "growth_plan": "", "risks": "", "recent_disclosures": ""},
        ])
        # Save stocks without TSLA (deletion pattern from delete_watchlist_stock)
        s.save_stocks([{"ticker": "LLY", "name": "LLY", "competitors": [],
                        "moat": "", "growth_plan": "", "market": "US", "exchange": ""}])
        unified = s._get_unified()
    tickers = {x["ticker"] for x in unified}
    assert "LLY" in tickers   # holding stays
    assert "TSLA" not in tickers  # watchlist removed


def test_get_full_portfolio_splits_by_type(tmp_path):
    import services.storage as s
    with patch("services.storage.DATA_DIR", tmp_path):
        s._save_unified([
            {"ticker": "LLY", "type": "holding", "quantity": 3.0, "avg_cost": 886.6,
             "name": "일라이 릴리", "market": "US", "exchange": "",
             "competitors": ["NVO"], "moat": "Brand", "growth_plan": "GLP1",
             "risks": "", "recent_disclosures": ""},
            {"ticker": "TSLA", "type": "watchlist", "quantity": None, "avg_cost": None,
             "name": "테슬라", "market": "US", "exchange": "",
             "competitors": [], "moat": "", "growth_plan": "", "risks": "", "recent_disclosures": ""},
        ])
        result = s.get_full_portfolio()
    assert len(result["stocks"]) == 1
    assert result["stocks"][0]["ticker"] == "LLY"
    assert len(result["watchlist"]) == 1
    assert result["watchlist"][0]["ticker"] == "TSLA"


def test_get_holdings_returns_empty_when_file_missing():
    import services.storage as s
    original = s.DATA_DIR
    s.DATA_DIR = Path("/nonexistent_dir_xyz")
    try:
        result = s.get_holdings()
    finally:
        s.DATA_DIR = original
    assert result == []


def test_enrich_stock_updates_in_unified(tmp_path):
    import services.storage as s
    with patch("services.storage.DATA_DIR", tmp_path):
        s._save_unified([
            {"ticker": "LLY", "type": "holding", "quantity": 3.0, "avg_cost": 886.6,
             "name": "LLY", "market": "US", "exchange": "",
             "competitors": [], "moat": "", "growth_plan": "", "risks": "", "recent_disclosures": ""},
        ])
        result = s.enrich_stock("LLY", {"moat": "Strong brand"})
        assert result is True
        unified = s._get_unified()
    lly = next(x for x in unified if x["ticker"] == "LLY")
    assert lly["moat"] == "Strong brand"
    assert lly["type"] == "holding"  # preserved


def test_enrich_stock_returns_false_for_unknown_ticker(tmp_path):
    import services.storage as s
    with patch("services.storage.DATA_DIR", tmp_path):
        s._save_unified([])
        result = s.enrich_stock("UNKNOWN", {"moat": "test"})
    assert result is False
```

- [ ] **Step 2: 테스트 실행 (실패 확인)**

```bash
cd backend && source .venv/bin/activate && pytest tests/test_storage.py -v 2>&1 | tail -20
```

Expected: `AttributeError: module 'services.storage' has no attribute '_save_unified'` 등 실패

- [ ] **Step 3: `storage.py` 구현**

`backend/services/storage.py` 전체 교체:

```python
import json
from pathlib import Path
from typing import Any

DATA_DIR = Path(__file__).parent.parent / "data"

_ANALYST_KEYS = frozenset({"name", "competitors", "moat", "growth_plan", "risks", "recent_disclosures"})


def _read_json(filename: str) -> Any:
    path = DATA_DIR / filename
    if not path.exists():
        return None
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


def _write_json(filename: str, data: Any) -> None:
    path = DATA_DIR / filename
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)


def _get_unified() -> list[dict]:
    data = _read_json("stocks.json")
    return data.get("stocks", []) if data else []


def _save_unified(stocks: list[dict]) -> None:
    _write_json("stocks.json", {"stocks": stocks})


def get_stocks() -> list[dict]:
    return [
        {k: s[k] for k in (*_ANALYST_KEYS, "ticker", "market", "exchange") if k in s}
        for s in _get_unified()
    ]


def save_stocks(stocks: list[dict]) -> None:
    by_ticker = {s["ticker"]: s for s in _get_unified()}
    incoming = {s["ticker"].upper(): s for s in stocks}
    # Remove non-holdings not in new list
    for t in list(by_ticker):
        if t not in incoming and by_ticker[t].get("type") != "holding":
            del by_ticker[t]
    # Update / insert analyst fields
    for t, s in incoming.items():
        if t in by_ticker:
            by_ticker[t].update({k: v for k, v in s.items() if k in _ANALYST_KEYS})
        else:
            by_ticker[t] = {
                "ticker": t, "type": "watchlist", "quantity": None, "avg_cost": None,
                "market": s.get("market", "US"), "exchange": s.get("exchange", ""),
                **{k: s.get(k, "") for k in _ANALYST_KEYS},
            }
    _save_unified(list(by_ticker.values()))


def get_holdings() -> list[dict]:
    return [
        {"ticker": s["ticker"], "quantity": s["quantity"], "avg_cost": s["avg_cost"],
         "market": s.get("market", "US"), "exchange": s.get("exchange", "")}
        for s in _get_unified() if s.get("type") == "holding"
    ]


def save_holdings(holdings: list[dict]) -> None:
    by_ticker = {s["ticker"]: s for s in _get_unified()}
    holding_tickers = {h["ticker"].upper() for h in holdings}
    # Demote removed holdings to watchlist
    for s in by_ticker.values():
        if s.get("type") == "holding" and s["ticker"] not in holding_tickers:
            s["type"] = "watchlist"
            s["quantity"] = None
            s["avg_cost"] = None
    # Update / insert
    for h in holdings:
        t = h["ticker"].upper()
        if t in by_ticker:
            by_ticker[t]["type"] = "holding"
            by_ticker[t]["quantity"] = h["quantity"]
            by_ticker[t]["avg_cost"] = h["avg_cost"]
            by_ticker[t]["market"] = h.get("market", by_ticker[t].get("market", "US"))
            by_ticker[t]["exchange"] = h.get("exchange", by_ticker[t].get("exchange", ""))
        else:
            by_ticker[t] = {
                "ticker": t, "type": "holding", "name": t, "quantity": h["quantity"],
                "avg_cost": h["avg_cost"], "market": h.get("market", "US"),
                "exchange": h.get("exchange", ""), "competitors": [], "moat": "",
                "growth_plan": "", "risks": "", "recent_disclosures": "",
            }
    _save_unified(list(by_ticker.values()))


def get_watchlist_tickers() -> list[str]:
    return [s["ticker"] for s in _get_unified() if s.get("type") == "watchlist"]


def save_watchlist_tickers(tickers: list[str]) -> None:
    by_ticker = {s["ticker"]: s for s in _get_unified()}
    for t in [t.upper() for t in tickers]:
        if t in by_ticker:
            if by_ticker[t].get("type") != "holding":
                by_ticker[t]["type"] = "watchlist"
        else:
            by_ticker[t] = {
                "ticker": t, "type": "watchlist", "name": t, "quantity": None,
                "avg_cost": None, "market": "US", "exchange": "",
                "competitors": [], "moat": "", "growth_plan": "",
                "risks": "", "recent_disclosures": "",
            }
    _save_unified(list(by_ticker.values()))


def get_full_portfolio() -> dict:
    unified = _get_unified()
    return {
        "stocks": [s for s in unified if s.get("type") == "holding"],
        "watchlist": [s for s in unified if s.get("type") == "watchlist"],
    }


def get_schedule() -> dict:
    data = _read_json("schedule.json")
    return data if data is not None else {
        "enabled": False, "time": "08:00",
        "days": ["mon", "tue", "wed", "thu", "fri"],
    }


def save_schedule(schedule: dict) -> None:
    _write_json("schedule.json", schedule)


def enrich_stock(ticker: str, fields: dict) -> bool:
    upper = ticker.upper()
    unified = _get_unified()
    by_ticker = {s["ticker"]: s for s in unified}
    if upper not in by_ticker:
        return False
    for k, v in fields.items():
        by_ticker[upper][k] = v
    _save_unified(list(by_ticker.values()))
    return True


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

- [ ] **Step 4: 테스트 실행 (통과 확인)**

```bash
pytest tests/test_storage.py -v 2>&1 | tail -20
```

Expected: `12 passed`

- [ ] **Step 5: 전체 테스트 확인**

```bash
pytest --tb=short -q 2>&1 | tail -10
```

Expected: `test_storage.py` 포함 기존 통과 테스트들 유지.

- [ ] **Step 6: 커밋**

```bash
git add backend/services/storage.py backend/tests/test_storage.py
git commit -m "refactor: reimplement storage on unified stocks.json"
```

---

## Task 3: `cache.py` — LRU+TTL 캐시

**Files:**
- Create: `backend/services/cache.py`
- Create: `backend/tests/test_cache.py`

- [ ] **Step 1: 실패 테스트 작성**

`backend/tests/test_cache.py`:

```python
import time
import pytest


def _clear():
    import services.cache as c
    c._snapshots.clear()
    c._list_cache["data"] = None
    c._list_cache["ts"] = 0.0


def test_get_snapshot_calls_loader_once():
    import services.cache as c
    _clear()
    calls = []
    def loader():
        calls.append(1)
        return {"ticker": "AAPL"}
    r1 = c.get_snapshot("AAPL", "2026-05-20", loader)
    r2 = c.get_snapshot("AAPL", "2026-05-20", loader)
    assert len(calls) == 1
    assert r1 == r2 == {"ticker": "AAPL"}


def test_get_snapshot_different_dates_separate():
    import services.cache as c
    _clear()
    c.get_snapshot("AAPL", "2026-05-19", lambda: {"date": "19"})
    calls = []
    c.get_snapshot("AAPL", "2026-05-20", lambda: (calls.append(1), {"date": "20"})[1])
    assert len(calls) == 1


def test_invalidate_clears_ticker_entries():
    import services.cache as c
    _clear()
    c.get_snapshot("AAPL", "2026-05-20", lambda: {"v": 1})
    c.get_snapshot("AAPL", "2026-05-19", lambda: {"v": 2})
    c.get_snapshot("TSLA", "2026-05-20", lambda: {"v": 3})
    c.invalidate("AAPL")
    calls = []
    c.get_snapshot("AAPL", "2026-05-20", lambda: (calls.append(1), {"v": 99})[1])
    assert len(calls) == 1  # AAPL was evicted
    tsla_calls = []
    c.get_snapshot("TSLA", "2026-05-20", lambda: (tsla_calls.append(1), {})[1])
    assert len(tsla_calls) == 0  # TSLA cache intact


def test_lru_evicts_oldest_when_full():
    import services.cache as c
    _clear()
    original_max = c._MAX
    c._MAX = 3
    try:
        c.get_snapshot("A", "d1", lambda: {"v": "A"})
        c.get_snapshot("B", "d1", lambda: {"v": "B"})
        c.get_snapshot("C", "d1", lambda: {"v": "C"})
        c.get_snapshot("D", "d1", lambda: {"v": "D"})  # evicts A
        assert "A/d1" not in c._snapshots
        assert "D/d1" in c._snapshots
    finally:
        c._MAX = original_max


def test_get_list_caches_within_ttl():
    import services.cache as c
    _clear()
    calls = []
    def loader():
        calls.append(1)
        return {"data": "list"}
    c.get_list(loader)
    c.get_list(loader)
    assert len(calls) == 1


def test_get_list_refreshes_after_ttl(monkeypatch):
    import services.cache as c
    _clear()
    calls = []
    def loader():
        calls.append(1)
        return {"data": "list"}
    c.get_list(loader)
    monkeypatch.setattr(c, "_list_cache", {"data": {"data": "list"}, "ts": time.time() - c._LIST_TTL - 1})
    c.get_list(loader)
    assert len(calls) == 2


def test_invalidate_list_resets_cache():
    import services.cache as c
    _clear()
    calls = []
    c.get_list(lambda: (calls.append(1), {})[1])
    c.invalidate_list()
    c.get_list(lambda: (calls.append(1), {})[1])
    assert len(calls) == 2


def test_get_snapshot_none_loader_not_cached():
    import services.cache as c
    _clear()
    calls = []
    def loader():
        calls.append(1)
        return None
    r1 = c.get_snapshot("MISS", "2026-05-20", loader)
    r2 = c.get_snapshot("MISS", "2026-05-20", loader)
    assert r1 is None
    assert len(calls) == 2  # None is not cached
```

- [ ] **Step 2: 테스트 실행 (실패 확인)**

```bash
pytest tests/test_cache.py -v 2>&1 | tail -10
```

Expected: `ModuleNotFoundError: No module named 'services.cache'`

- [ ] **Step 3: `cache.py` 구현**

`backend/services/cache.py`:

```python
import time
from collections import OrderedDict

_snapshots: OrderedDict[str, dict] = OrderedDict()
_list_cache: dict = {"data": None, "ts": 0.0}
_MAX = 200
_LIST_TTL = 5.0


def get_snapshot(ticker: str, date: str, loader) -> dict | None:
    key = f"{ticker}/{date}"
    if key in _snapshots:
        _snapshots.move_to_end(key)
        return _snapshots[key]
    data = loader()
    if data is not None:
        if len(_snapshots) >= _MAX:
            _snapshots.popitem(last=False)
        _snapshots[key] = data
    return data


def invalidate(ticker: str) -> None:
    prefix = f"{ticker.upper()}/"
    for k in [k for k in _snapshots if k.startswith(prefix)]:
        del _snapshots[k]
    invalidate_list()


def invalidate_list() -> None:
    _list_cache["data"] = None
    _list_cache["ts"] = 0.0


def get_list(loader) -> dict:
    now = time.time()
    if _list_cache["data"] is not None and now - _list_cache["ts"] < _LIST_TTL:
        return _list_cache["data"]
    data = loader()
    _list_cache["data"] = data
    _list_cache["ts"] = now
    return data
```

- [ ] **Step 4: 테스트 실행 (통과 확인)**

```bash
pytest tests/test_cache.py -v 2>&1 | tail -15
```

Expected: `8 passed`

- [ ] **Step 5: 커밋**

```bash
git add backend/services/cache.py backend/tests/test_cache.py
git commit -m "feat: add LRU+TTL in-memory cache service"
```

---

## Task 4: `report_generator.py` — JSON 전용, 새 필드

**Files:**
- Modify: `backend/services/report_generator.py`
- Modify: `backend/tests/test_report_generator.py`

- [ ] **Step 1: 실패 테스트 작성**

`backend/tests/test_report_generator.py` 전체 교체:

```python
import json
import pytest
from pathlib import Path
from unittest.mock import patch, MagicMock
import contextlib
import pandas as pd

SAMPLE_STOCK = {
    "ticker": "TEST",
    "name": "Test Corp",
    "quantity": 10,
    "avg_cost": 100.0,
    "competitors": ["COMP1"],
    "moat": "Strong brand",
    "growth_plan": "Expand to Asia",
    "recent_disclosures": "Q1 실적 호조",
    "risks": "Competition risk",
}

SAMPLE_NEWS = [
    {"title": "Test news", "link": "https://example.com",
     "publisher": "Reuters", "published_at": "2026-05-04 09:00"}
]

def _mock_all():
    df = pd.DataFrame({
        "Close": [100.0 + i for i in range(50)],
        "High":  [101.0 + i for i in range(50)],
        "Low":   [99.0  + i for i in range(50)],
        "Volume": [1_000_000] * 50,
    })
    return {
        "services.report_generator.mkt.get_quote": MagicMock(return_value={
            "ticker": "TEST", "name": "Test Corp", "price": 120.0,
            "prev_close": 118.0, "daily_change": "+1.69%",
            "market_cap": 500_000_000_000, "ytd_return": 15.0,
        }),
        "services.report_generator.mkt.get_financials": MagicMock(return_value=[
            {"period": "2025-Q4", "revenue": 10_000_000_000, "operating_income": 2_000_000_000},
        ]),
        "services.report_generator.mkt.get_annual_financials": MagicMock(return_value=[]),
        "services.report_generator.mkt.get_analyst_data": MagicMock(return_value={
            "target_mean": 150.0, "target_high": 200.0, "target_low": 120.0,
            "buy": 15, "hold": 5, "sell": 2,
        }),
        "services.report_generator.indicators.get_timeframe_rsi": MagicMock(return_value={
            "daily": {"rsi": 55.0, "target_20": 80.0, "target_25": 85.0, "target_30": 90.0,
                      "target_70": 130.0, "target_75": 135.0, "target_80": 140.0},
            "weekly": {"rsi": 60.0, "target_20": 75.0, "target_25": 80.0, "target_30": 85.0,
                       "target_70": 140.0, "target_75": 145.0, "target_80": 150.0},
            "monthly": {"rsi": 50.0, "target_20": 70.0, "target_25": 75.0, "target_30": 80.0,
                        "target_70": 145.0, "target_75": 150.0, "target_80": 155.0},
        }),
        "services.report_generator.indicators.get_volume_profile": MagicMock(return_value={
            "poc": 115.0, "hvn": [95.0, 115.0, 135.0], "lvn": [105.0, 125.0],
        }),
        "services.report_generator.scraper.scrape_finviz_consensus": MagicMock(return_value={
            "finviz_recom": 1.8,
        }),
        "services.report_generator.scraper.get_news": MagicMock(return_value=SAMPLE_NEWS),
        "services.report_generator.yf.Ticker": MagicMock(
            return_value=MagicMock(
                history=MagicMock(return_value=df),
                info={"sector": "Technology", "industry": "Software"},
            )
        ),
    }


def test_generate_report_creates_json_not_markdown(tmp_path):
    with contextlib.ExitStack() as stack:
        for target, mock in _mock_all().items():
            stack.enter_context(patch(target, mock))
        from services import report_generator
        import importlib; importlib.reload(report_generator)
        json_path = report_generator.generate_report(SAMPLE_STOCK, tmp_path)
    assert json_path.endswith(".json")
    assert not Path(json_path).with_suffix(".md").exists()


def test_generate_report_json_has_core_fields(tmp_path):
    with contextlib.ExitStack() as stack:
        for target, mock in _mock_all().items():
            stack.enter_context(patch(target, mock))
        from services import report_generator
        import importlib; importlib.reload(report_generator)
        json_path = report_generator.generate_report(SAMPLE_STOCK, tmp_path)
    summary = json.loads(Path(json_path).read_text(encoding="utf-8"))
    assert summary["ticker"] == "TEST"
    assert summary["target_mean"] == 150.0
    assert summary["buy"] == 15
    assert summary["daily_rsi"]["rsi"] == 55.0
    assert summary["volume_profile"]["poc"] == 115.0
    assert summary["sector"] == "Technology"


def test_generate_report_json_has_analyst_text_fields(tmp_path):
    with contextlib.ExitStack() as stack:
        for target, mock in _mock_all().items():
            stack.enter_context(patch(target, mock))
        from services import report_generator
        import importlib; importlib.reload(report_generator)
        json_path = report_generator.generate_report(SAMPLE_STOCK, tmp_path)
    summary = json.loads(Path(json_path).read_text(encoding="utf-8"))
    assert summary["moat"] == "Strong brand"
    assert summary["growth_plan"] == "Expand to Asia"
    assert summary["recent_disclosures"] == "Q1 실적 호조"
    assert summary["risks"] == "Competition risk"


def test_generate_report_json_has_competitors_data(tmp_path):
    with contextlib.ExitStack() as stack:
        for target, mock in _mock_all().items():
            stack.enter_context(patch(target, mock))
        from services import report_generator
        import importlib; importlib.reload(report_generator)
        json_path = report_generator.generate_report(SAMPLE_STOCK, tmp_path)
    summary = json.loads(Path(json_path).read_text(encoding="utf-8"))
    assert "competitors_data" in summary
    assert isinstance(summary["competitors_data"], list)
    assert len(summary["competitors_data"]) >= 1


def test_generate_report_json_has_news(tmp_path):
    with contextlib.ExitStack() as stack:
        for target, mock in _mock_all().items():
            stack.enter_context(patch(target, mock))
        from services import report_generator
        import importlib; importlib.reload(report_generator)
        json_path = report_generator.generate_report(SAMPLE_STOCK, tmp_path)
    summary = json.loads(Path(json_path).read_text(encoding="utf-8"))
    assert "news" in summary
    assert summary["news"][0]["title"] == "Test news"
    assert summary["news"][0]["publisher"] == "Reuters"
```

- [ ] **Step 2: 테스트 실행 (실패 확인)**

```bash
pytest tests/test_report_generator.py -v 2>&1 | tail -15
```

Expected: 모두 실패 (기존 코드는 `.md` 반환, 새 필드 없음)

- [ ] **Step 3: `report_generator.py` 구현**

`backend/services/report_generator.py` 전체 교체:

```python
from pathlib import Path
from datetime import date
import json
import yfinance as yf

from services import market as mkt, indicators, scraper

SNAPSHOTS_DIR = Path(__file__).parent.parent / "snapshots"


def _yf_sym(ticker: str, market: str, exchange: str) -> str:
    return mkt._yf_sym(ticker, market, exchange)


def generate_report(stock: dict, output_base_dir: Path = SNAPSHOTS_DIR) -> str:
    ticker = stock["ticker"]
    market = stock.get("market", "US")
    exchange = stock.get("exchange", "")
    yf_sym = _yf_sym(ticker, market, exchange)
    today = date.today().strftime("%Y-%m-%d")
    output_dir = output_base_dir / ticker
    output_dir.mkdir(parents=True, exist_ok=True)

    quote = mkt.get_quote(ticker, market, exchange)
    financials = mkt.get_financials(ticker, market, exchange)
    financials_annual = mkt.get_annual_financials(ticker, market, exchange)
    analyst = mkt.get_analyst_data(ticker, market, exchange)
    competitor_quotes = [
        mkt.get_quote(c, market, exchange)
        for c in stock.get("competitors", [])
    ]
    timeframe_rsi = indicators.get_timeframe_rsi(yf_sym)
    t = yf.Ticker(yf_sym)
    daily_df = t.history(period="1y")
    vp = indicators.get_volume_profile(daily_df)

    high_20d = round(float(daily_df["High"].tail(20).max()), 2) if not daily_df.empty else None
    _cur = quote.get("price")
    drop_from_high_20d = round((_cur - high_20d) / high_20d * 100, 2) if high_20d and _cur else None

    if market == "KR":
        sector = quote.get("sector", "")
        industry = quote.get("industry", "")
        current_price = quote.get("price")
        actual_f = [f for f in financials if not f.get("is_consensus")]
        eps_list = [f["eps"] for f in actual_f if f.get("eps") is not None]
        trailing_eps = sum(eps_list[:4]) if len(eps_list) >= 2 else None
        trailing_per = round(current_price / trailing_eps, 1) if current_price and trailing_eps else None
        consensus_f = next((f for f in financials if f.get("is_consensus") and f.get("eps")), None)
        forward_per = round(current_price / (consensus_f["eps"] * 4), 1) if current_price and consensus_f else None
        actual_bps = next((f["bps"] for f in actual_f if f.get("bps") is not None), None)
        pbr = round(current_price / actual_bps, 2) if current_price and actual_bps else None
    else:
        try:
            _info = t.info
            sector = _info.get("sector", "")
            industry = _info.get("industry", "")
            trailing_per = _info.get("trailingPE")
            forward_per = _info.get("forwardPE")
            pbr = _info.get("priceToBook")
        except Exception:
            sector, industry = "", ""
            trailing_per = forward_per = pbr = None

    finviz = scraper.scrape_finviz_consensus(ticker) if market == "US" else {}
    news = scraper.get_news(ticker, market)

    summary = {
        "ticker": ticker,
        "name": stock.get("name", ticker),
        "date": today,
        "market": market,
        "price": quote.get("price"),
        "target_mean": analyst.get("target_mean") or finviz.get("finviz_target"),
        "target_high": analyst.get("target_high"),
        "target_low": analyst.get("target_low"),
        "buy": analyst.get("buy", 0),
        "hold": analyst.get("hold", 0),
        "sell": analyst.get("sell", 0),
        "finviz_recom": finviz.get("finviz_recom"),
        "daily_rsi": timeframe_rsi.get("daily", {}),
        "weekly_rsi": timeframe_rsi.get("weekly", {}),
        "monthly_rsi": timeframe_rsi.get("monthly", {}),
        "volume_profile": vp,
        "financials": financials,
        "financials_annual": financials_annual,
        "sector": sector,
        "industry": industry,
        "per": round(trailing_per, 2) if trailing_per else None,
        "forward_per": round(forward_per, 2) if forward_per else None,
        "pbr": round(pbr, 2) if pbr else None,
        "high_20d": high_20d,
        "drop_from_high_20d": drop_from_high_20d,
        "moat": stock.get("moat", ""),
        "growth_plan": stock.get("growth_plan", ""),
        "recent_disclosures": stock.get("recent_disclosures", ""),
        "risks": stock.get("risks", ""),
        "competitors_data": [
            {
                "ticker": q.get("ticker") or c,
                "name": q.get("name", ""),
                "price": q.get("price"),
                "market_cap": q.get("market_cap"),
                "ytd_return": q.get("ytd_return"),
            }
            for c, q in zip(
                [ticker] + list(stock.get("competitors", [])),
                [quote] + competitor_quotes,
            )
        ],
        "news": news,
    }

    json_path = output_dir / f"{today}.json"
    json_path.write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")
    return str(json_path)
```

- [ ] **Step 4: 테스트 실행 (통과 확인)**

```bash
pytest tests/test_report_generator.py -v 2>&1 | tail -15
```

Expected: `5 passed`

- [ ] **Step 5: 커밋**

```bash
git add backend/services/report_generator.py backend/tests/test_report_generator.py
git commit -m "refactor: report_generator outputs JSON only, adds analyst/competitor/news fields"
```

---

## Task 5: `routers/report.py` + `main.py`

**Files:**
- Modify: `backend/routers/report.py`
- Modify: `backend/main.py`
- Modify: `backend/tests/test_report_router.py`

- [ ] **Step 1: 실패 테스트 작성**

`backend/tests/test_report_router.py` 전체 교체:

```python
import json
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from unittest.mock import patch

from routers.report import router

app = FastAPI()
app.include_router(router)
client = TestClient(app)

FULL_PORTFOLIO = {
    "stocks": [{"ticker": "LLY", "quantity": 3.0, "avg_cost": 886.6,
                "name": "일라이 릴리", "competitors": [], "moat": "", "growth_plan": ""}],
    "watchlist": [],
}

SAMPLE_SUMMARY = {
    "ticker": "LLY", "name": "일라이 릴리", "date": "2026-05-05",
    "price": 890.0, "target_mean": 980.0, "buy": 15, "hold": 3, "sell": 1,
    "finviz_recom": 1.8, "moat": "Strong brand", "risks": "IRA risk",
    "growth_plan": "GLP1", "recent_disclosures": "Q1 호조",
    "competitors_data": [{"ticker": "LLY", "price": 890.0}],
    "news": [{"title": "News", "link": "http://x.com", "publisher": "Reuters", "published_at": "2026-05-05"}],
    "daily_rsi": {"rsi": 45.2, "target_20": 800.0},
}


def test_list_reports_detects_json_snapshots(tmp_path):
    ticker_dir = tmp_path / "LLY"
    ticker_dir.mkdir()
    (ticker_dir / "2026-05-05.json").write_text(json.dumps(SAMPLE_SUMMARY), encoding="utf-8")
    with patch("routers.report.SNAPSHOTS_DIR", tmp_path), \
         patch("routers.report.REPORTS_DIR", tmp_path / "legacy"), \
         patch("routers.report.storage.get_full_portfolio", return_value=FULL_PORTFOLIO):
        resp = client.get("/api/report/list")
    assert resp.status_code == 200
    data = resp.json()
    assert "LLY" in data
    assert data["LLY"]["summary"]["target_mean"] == 980.0
    assert "2026-05-05" in data["LLY"]["dates"]


def test_list_reports_no_markdown_in_dates(tmp_path):
    ticker_dir = tmp_path / "LLY"
    ticker_dir.mkdir()
    (ticker_dir / "2026-05-05.json").write_text(json.dumps(SAMPLE_SUMMARY), encoding="utf-8")
    with patch("routers.report.SNAPSHOTS_DIR", tmp_path), \
         patch("routers.report.REPORTS_DIR", tmp_path / "legacy"), \
         patch("routers.report.storage.get_full_portfolio", return_value=FULL_PORTFOLIO):
        resp = client.get("/api/report/list")
    dates = resp.json()["LLY"]["dates"]
    assert all(not d.endswith(".md") for d in dates)


def test_get_report_returns_summary_no_content(tmp_path):
    ticker_dir = tmp_path / "LLY"
    ticker_dir.mkdir()
    (ticker_dir / "2026-05-05.json").write_text(json.dumps(SAMPLE_SUMMARY), encoding="utf-8")
    with patch("routers.report.SNAPSHOTS_DIR", tmp_path), \
         patch("routers.report.REPORTS_DIR", tmp_path / "legacy"), \
         patch("routers.report.cache_svc._snapshots", {}), \
         patch("routers.report.cache_svc._list_cache", {"data": None, "ts": 0.0}):
        resp = client.get("/api/report/LLY/2026-05-05")
    assert resp.status_code == 200
    body = resp.json()
    assert "content" not in body
    assert body["summary"]["target_mean"] == 980.0
    assert body["summary"]["moat"] == "Strong brand"
    assert body["summary"]["risks"] == "IRA risk"


def test_get_report_fallback_to_reports_dir(tmp_path):
    legacy_dir = tmp_path / "legacy"
    legacy_ticker = legacy_dir / "LLY"
    legacy_ticker.mkdir(parents=True)
    (legacy_ticker / "2026-05-01.json").write_text(json.dumps(SAMPLE_SUMMARY), encoding="utf-8")
    snapshots_dir = tmp_path / "snapshots"
    snapshots_dir.mkdir()
    with patch("routers.report.SNAPSHOTS_DIR", snapshots_dir), \
         patch("routers.report.REPORTS_DIR", legacy_dir), \
         patch("routers.report.cache_svc._snapshots", {}), \
         patch("routers.report.cache_svc._list_cache", {"data": None, "ts": 0.0}):
        resp = client.get("/api/report/LLY/2026-05-01")
    assert resp.status_code == 200
    assert resp.json()["summary"]["target_mean"] == 980.0


def test_get_report_404_when_not_found(tmp_path):
    with patch("routers.report.SNAPSHOTS_DIR", tmp_path), \
         patch("routers.report.REPORTS_DIR", tmp_path / "legacy"), \
         patch("routers.report.cache_svc._snapshots", {}), \
         patch("routers.report.cache_svc._list_cache", {"data": None, "ts": 0.0}):
        resp = client.get("/api/report/LLY/2000-01-01")
    assert resp.status_code == 404
```

- [ ] **Step 2: 테스트 실행 (실패 확인)**

```bash
pytest tests/test_report_router.py -v 2>&1 | tail -10
```

Expected: `ImportError` 또는 assertion 실패

- [ ] **Step 3: `routers/report.py` 수정**

`backend/routers/report.py` 전체 교체:

```python
from __future__ import annotations
import json
from fastapi import APIRouter, HTTPException, BackgroundTasks
from pathlib import Path
from services import storage, report_generator
from services import consensus as consensus_svc
from services import cache as cache_svc

router = APIRouter(prefix="/api", tags=["report"])

SNAPSHOTS_DIR = Path(__file__).parent.parent / "snapshots"
REPORTS_DIR = Path(__file__).parent.parent / "reports"  # legacy fallback

_progress: dict = {"running": False, "done": 0, "total": 0, "current": ""}


@router.get("/report/progress")
def get_progress():
    return _progress


@router.post("/report/generate", status_code=202)
def generate_all(background_tasks: BackgroundTasks):
    portfolio = storage.get_full_portfolio()
    stocks = portfolio.get("stocks", []) + portfolio.get("watchlist", [])
    if not stocks:
        raise HTTPException(status_code=400, detail="No stocks in portfolio or watchlist")
    background_tasks.add_task(_run_generation, stocks)
    return {"message": f"Generating reports for {len(stocks)} stock(s)"}


@router.post("/report/generate/{ticker}", status_code=202)
def generate_one(ticker: str, background_tasks: BackgroundTasks):
    portfolio = storage.get_full_portfolio()
    stock = next(
        (s for s in portfolio["stocks"] if s["ticker"].upper() == ticker.upper()), None
    )
    if not stock:
        stock = next(
            (s for s in portfolio.get("watchlist", [])
             if s["ticker"].upper() == ticker.upper()), None
        )
    if not stock:
        raise HTTPException(status_code=404, detail=f"{ticker} not found in portfolio or watchlist")
    background_tasks.add_task(_run_generation, [stock])
    return {"message": f"Generating report for {ticker.upper()}"}


def _run_generation(stocks: list):
    _progress["running"] = True
    _progress["done"] = 0
    _progress["total"] = len(stocks)
    _progress["current"] = ""
    for stock in stocks:
        _progress["current"] = stock["ticker"]
        try:
            report_generator.generate_report(stock)
            cache_svc.invalidate(stock["ticker"])
        except Exception as e:
            print(f"[Report] Failed for {stock['ticker']}: {e}")
        _progress["done"] += 1
    _progress["running"] = False
    _progress["current"] = ""


def _read_snapshot(ticker: str, date_str: str) -> dict | None:
    # snapshots/ 우선, 없으면 reports/ fallback
    for base in (SNAPSHOTS_DIR, REPORTS_DIR):
        path = base / ticker / f"{date_str}.json"
        if path.exists():
            return json.loads(path.read_text(encoding="utf-8"))
    return None


@router.get("/report/list")
def list_reports():
    def _build():
        portfolio = storage.get_full_portfolio()
        portfolio_stocks = {s["ticker"].upper(): s for s in portfolio.get("stocks", [])}
        portfolio_watchlist = {s["ticker"].upper(): s for s in portfolio.get("watchlist", [])}
        holding_tickers = set(portfolio_stocks.keys())
        watchlist_tickers = set(portfolio_watchlist.keys())

        result = {}
        # Scan snapshots/ first
        for base in (SNAPSHOTS_DIR, REPORTS_DIR):
            if not base.exists():
                continue
            for ticker_dir in sorted(base.iterdir()):
                if not ticker_dir.is_dir():
                    continue
                ticker = ticker_dir.name.upper()
                if ticker in result:
                    continue  # already found in snapshots/
                dates = sorted([f.stem for f in ticker_dir.glob("*.json")], reverse=True)
                if not dates:
                    continue
                category = "holdings" if ticker in holding_tickers else \
                           "watchlist" if ticker in watchlist_tickers else "other"
                summary = _read_snapshot(ticker, dates[0])
                stock_info = portfolio_stocks.get(ticker) or portfolio_watchlist.get(ticker) or {}
                market = stock_info.get("market") or (summary or {}).get("market", "US")
                result[ticker] = {"dates": dates, "category": category, "summary": summary, "market": market}

        # Add portfolio stocks without reports
        for ticker, stock in portfolio_stocks.items():
            if ticker not in result:
                result[ticker] = {"dates": [], "category": "holdings", "summary": None,
                                  "market": stock.get("market", "US")}
        for ticker, stock in portfolio_watchlist.items():
            if ticker not in result:
                result[ticker] = {"dates": [], "category": "watchlist", "summary": None,
                                  "market": stock.get("market", "US")}
        return result

    return cache_svc.get_list(_build)


@router.get("/report/{ticker}/{date_str}")
def get_report(ticker: str, date_str: str):
    upper = ticker.upper()
    summary = cache_svc.get_snapshot(upper, date_str, lambda: _read_snapshot(upper, date_str))
    if summary is None:
        raise HTTPException(status_code=404, detail="Report not found")
    return {"ticker": upper, "date": date_str, "summary": summary}


@router.get("/consensus/{ticker}")
def get_consensus(ticker: str):
    return consensus_svc.get_history(ticker)


@router.post("/consensus/{ticker}")
def collect_consensus(ticker: str):
    entry = consensus_svc.collect(ticker)
    if entry is None:
        raise HTTPException(status_code=400, detail="리포트를 먼저 생성하세요")
    return entry


@router.post("/consensus/{ticker}/backfill")
def backfill_consensus(ticker: str):
    upper = ticker.upper()
    # Check both dirs for backfill
    ticker_dir = None
    for base in (SNAPSHOTS_DIR, REPORTS_DIR):
        d = base / upper
        if d.exists():
            ticker_dir = d
            break
    if not ticker_dir:
        raise HTTPException(status_code=400, detail="리포트를 먼저 생성하세요")
    json_files = sorted(ticker_dir.glob("*.json"), reverse=True)
    if not json_files:
        raise HTTPException(status_code=400, detail="리포트를 먼저 생성하세요")
    summary = json.loads(json_files[0].read_text(encoding="utf-8"))
    market = summary.get("market", "US")
    added = consensus_svc.backfill(upper, market)
    return {"added": len(added), "entries": added}


@router.get("/schedule")
def get_schedule():
    return storage.get_schedule()


@router.put("/schedule")
def update_schedule(schedule: dict):
    required = {"enabled", "time", "days"}
    if not required.issubset(schedule.keys()):
        raise HTTPException(
            status_code=400, detail=f"Missing fields: {required - schedule.keys()}"
        )
    storage.save_schedule(schedule)
    return schedule
```

- [ ] **Step 4: `main.py` 수정**

`backend/main.py`:
```python
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pathlib import Path
from contextlib import asynccontextmanager

import scheduler as sched
from routers import portfolio, report, watchlist, stocks, guru

SNAPSHOTS_DIR = Path(__file__).parent / "snapshots"
SNAPSHOTS_DIR.mkdir(exist_ok=True)


@asynccontextmanager
async def lifespan(app: FastAPI):
    sched.start()
    yield
    sched.stop()


app = FastAPI(title="Stock Portfolio Manager", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://localhost:5173"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(portfolio.router)
app.include_router(report.router)
app.include_router(watchlist.router)
app.include_router(stocks.router)
app.include_router(guru.router)


@app.get("/health")
def health():
    return {"status": "ok"}
```

- [ ] **Step 5: 테스트 실행 (통과 확인)**

```bash
pytest tests/test_report_router.py -v 2>&1 | tail -15
```

Expected: `5 passed`

- [ ] **Step 6: 전체 테스트 실행**

```bash
pytest --tb=short -q 2>&1 | tail -15
```

Expected: 이전 통과 수 이상 통과.

- [ ] **Step 7: 커밋**

```bash
git add backend/routers/report.py backend/main.py backend/tests/test_report_router.py
git commit -m "refactor: report router uses snapshots dir, removes markdown content, adds cache"
```

---

## Task 6: 프론트엔드 섹션 컴포넌트

**Files:**
- Modify: `frontend/src/pages/Reports.jsx`
- Delete: `frontend/src/components/MarkdownViewer.jsx`

- [ ] **Step 1: `MarkdownViewer.jsx` 삭제**

```bash
rm frontend/src/components/MarkdownViewer.jsx
```

- [ ] **Step 2: `Reports.jsx` — import 제거 및 state 변경**

`Reports.jsx` 상단에서:
```jsx
// 제거:
import MarkdownViewer from '../components/MarkdownViewer'
```

`detail` state 변경 (line ~851):
```jsx
// 변경 전:
const [detail, setDetail] = useState({ content: '', summary: null })

// 변경 후:
const [detail, setDetail] = useState({ summary: null })
```

fetch 콜백 변경 (line ~894):
```jsx
// 변경 전:
.then(({ data }) => setDetail({ content: data.content, summary: data.summary }))

// 변경 후:
.then(({ data }) => setDetail({ summary: data.summary }))
```

- [ ] **Step 3: 섹션 컴포넌트 추가**

`Reports.jsx` 내부 (컴포넌트 함수들 선언부 근처에 추가):

```jsx
function ReportSectionText({ title, text }) {
  if (!text) return null
  return (
    <div style={{ marginBottom: 20 }}>
      <div style={{ fontWeight: 600, fontSize: 13, color: 'var(--accent)', marginBottom: 8 }}>{title}</div>
      <p style={{ fontSize: 13, color: 'var(--text)', lineHeight: 1.8, margin: 0, whiteSpace: 'pre-wrap' }}>{text}</p>
    </div>
  )
}

function ReportSectionCompetitors({ competitors, market }) {
  if (!competitors?.length) return null
  const fmtMC = (mc) => {
    if (mc == null) return 'N/A'
    if (mc >= 1e12) return `${(mc / 1e12).toFixed(1)}T`
    if (mc >= 1e9) return `${(mc / 1e9).toFixed(1)}B`
    return `${(mc / 1e6).toFixed(0)}M`
  }
  return (
    <div style={{ marginBottom: 20 }}>
      <div style={{ fontWeight: 600, fontSize: 13, color: 'var(--accent)', marginBottom: 8 }}>1️⃣ 사업영역 & 시장순위</div>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
          <thead>
            <tr>
              {['종목', '티커', '현재가', '시가총액', 'YTD'].map(h => (
                <th key={h} style={{ ...TH }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {competitors.map((c, i) => (
              <tr key={i}>
                <td style={{ ...TD, textAlign: 'left' }}>{c.name || c.ticker}</td>
                <td style={TD}>{c.ticker}</td>
                <td style={TD}>{fmt(c.price, market)}</td>
                <td style={TD}>{c.market_cap ? (market === 'KR' ? `₩${fmtMC(c.market_cap)}` : `$${fmtMC(c.market_cap)}`) : 'N/A'}</td>
                <td style={{ ...TD, color: c.ytd_return >= 0 ? '#81c784' : '#ef9a9a' }}>
                  {c.ytd_return != null ? `${c.ytd_return >= 0 ? '+' : ''}${c.ytd_return.toFixed(1)}%` : 'N/A'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function ReportSectionNews({ disclosures, news }) {
  return (
    <div style={{ marginBottom: 20 }}>
      <div style={{ fontWeight: 600, fontSize: 13, color: 'var(--accent)', marginBottom: 8 }}>5️⃣ 최근 공시 & 뉴스</div>
      {disclosures && (
        <p style={{ fontSize: 13, color: 'var(--text)', lineHeight: 1.8, margin: '0 0 10px' }}>{disclosures}</p>
      )}
      {news?.length > 0 ? (
        <ul style={{ margin: 0, padding: '0 0 0 16px', fontSize: 12, lineHeight: 1.8 }}>
          {news.map((item, i) => (
            <li key={i}>
              <a href={item.link} target="_blank" rel="noreferrer"
                 style={{ color: 'var(--accent)', textDecoration: 'none' }}>{item.title}</a>
              <span style={{ color: 'var(--text-muted)', marginLeft: 6 }}>
                — {item.publisher} ({item.published_at})
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p style={{ color: 'var(--text-muted)', fontSize: 12 }}>_(뉴스 없음)_</p>
      )}
    </div>
  )
}
```

- [ ] **Step 4: report 탭 렌더링 교체**

`Reports.jsx`에서 (line ~1354) 아래 부분 찾아 교체:

```jsx
// 변경 전:
{!loading && activeDetailTab === 'report' && (
  detail.content
    ? <MarkdownViewer content={detail.content} ticker={selected.ticker} />
    : <p style={{ color: 'var(--text-muted)', fontSize: 13 }}>리포트 파일이 없습니다.</p>
)}

// 변경 후:
{!loading && activeDetailTab === 'report' && (
  detail.summary
    ? (
      <div style={{ padding: '0 4px' }}>
        <ReportSectionCompetitors
          competitors={detail.summary.competitors_data}
          market={detail.summary.market}
        />
        <ReportSectionText title="2️⃣ 리스크" text={detail.summary.risks} />
        <ReportSectionText title="3️⃣ 경제적 해자" text={detail.summary.moat} />
        <ReportSectionText title="4️⃣ 장기 성장 계획" text={detail.summary.growth_plan} />
        <ReportSectionNews
          disclosures={detail.summary.recent_disclosures}
          news={detail.summary.news}
        />
      </div>
    )
    : <p style={{ color: 'var(--text-muted)', fontSize: 13 }}>리포트 데이터가 없습니다.</p>
)}
```

- [ ] **Step 5: 프론트엔드 빌드 확인**

```bash
cd frontend && npm run build 2>&1 | tail -15
```

Expected: 빌드 성공, `MarkdownViewer` 관련 에러 없음.

- [ ] **Step 6: 개발 서버 실행 후 수동 확인**

```bash
cd frontend && npm run dev
```

확인 항목:
- [ ] Reports 페이지 로드됨
- [ ] 종목 선택 → 리포트 탭 → 섹션 컴포넌트 렌더링
- [ ] 경쟁사 테이블, 리스크/해자/성장계획 텍스트, 뉴스 목록 표시
- [ ] 기존 summary 탭(RSI, 재무) 정상 동작

- [ ] **Step 7: 커밋**

```bash
git add frontend/src/pages/Reports.jsx
git rm frontend/src/components/MarkdownViewer.jsx
git commit -m "feat: replace MarkdownViewer with section components in Reports"
```

---

## Task 7: CLAUDE.md 업데이트

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: CLAUDE.md 수정**

```markdown
# 변경사항 반영

Architecture 섹션:
- `backend/data/` 설명: "JSON file storage (stocks.json — unified holdings+watchlist+analyst data, schedule.json)"
- `backend/snapshots/` 추가: "generated JSON snapshots (per-ticker/date)"
- `backend/reports/` → "legacy report directory (read-only, JSON fallback)"
- `frontend/src/components/` → MarkdownViewer 제거

Gotchas 섹션 추가:
- "holdings.json and watchlist.json are merged into stocks.json (type: holding|watchlist field)"
- "New snapshots write to backend/snapshots/, old reports/ kept as read-only fallback"
```

- [ ] **Step 2: 커밋**

```bash
git add CLAUDE.md
git commit -m "docs: update CLAUDE.md for unified data structure and snapshots dir"
```

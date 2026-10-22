"""DRAMeXchange 메모리 현물가 홈 페이지 파서 (keyless HTML, html.parser)."""
import logging
import math
import re
import threading
import time
from datetime import date, timedelta
from typing import Optional

import requests
from bs4 import BeautifulSoup

from services.utils import today_kst
from .cache import _mc_load, _mc_load_strict, _mc_save, _merge_history

logger = logging.getLogger(__name__)

# 페이지 표 제목 -> (key, 한글 라벨). 페이지 순서 = 출력 순서.
_CATEGORIES = {
    "DRAM Spot Price": ("dram_spot", "DRAM 현물"),
    "Module Spot Price": ("module", "모듈"),
    "Flash Spot Price": ("flash", "Flash"),
    "GDDR Spot Price": ("gddr", "GDDR"),
    "Wafer Spot Price": ("wafer", "웨이퍼"),
    "Memory Card Price": ("memory_card", "메모리카드"),
}
_MONTHS = {m: i for i, m in enumerate(
    ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"], 1)}
_UPDATE_RE = re.compile(r"Last Update:\s*([A-Za-z]{3})[a-z]*\.?\s*(\d{1,2})(?:\s+(\d{4}))?")
_CHART_RE = re.compile(r"item=([^&'\"]+)(?:&amp;|&)type=(\d+)")


def _num(s: str) -> Optional[float]:
    try:
        v = float(s.replace(",", "").replace("%", "").strip())
    except (ValueError, AttributeError):
        return None
    return v if math.isfinite(v) else None


def _updated_at(text: str, ref: date) -> Optional[str]:
    m = _UPDATE_RE.search(text or "")
    mon = _MONTHS.get(m.group(1).lower()) if m else None
    if not mon:
        return None
    try:
        if m.group(3):
            return date(int(m.group(3)), mon, int(m.group(2))).isoformat()
        d = date(ref.year, mon, int(m.group(2)))
        if d > ref:  # 연도 없음: 미래면 전년도
            d = date(ref.year - 1, mon, int(m.group(2)))
        return d.isoformat()
    except ValueError:
        return None


def parse_dramexchange(html: Optional[str], ref_date: Optional[date] = None) -> dict:
    """홈 HTML -> {"categories": [...]}. 가격 없는 분류 제외, 깨진 입력은 빈 결과."""
    ref = ref_date or today_kst()
    out = []
    try:
        soup = BeautifulSoup(html or "", "html.parser")
        by_key = {}
        for box in soup.find_all("div", class_="left_tab"):
            title = box.find(class_="title_left")
            cat = _CATEGORIES.get(title.get_text(" ", strip=True)) if title else None
            if not cat:
                continue
            tab_time = box.find(class_="tab_time")
            updated = _updated_at(tab_time.get_text(" ", strip=True) if tab_time else "", ref)
            items = []
            for tr in box.find_all("tr"):
                tds = tr.find_all("td", recursive=False)
                chart = _CHART_RE.search(str(tds[7])) if len(tds) == 8 else None
                if not chart:
                    continue
                items.append({
                    "id": f"{chart.group(1)}:{chart.group(2)}",
                    "name": " ".join(tds[0].get_text(" ", strip=True).split()),
                    "avg": _num(tds[5].get_text(strip=True)),
                    "high": _num(tds[1].get_text(strip=True)),
                    "low": _num(tds[2].get_text(strip=True)),
                    "change_pct": _num(tds[6].get_text(strip=True)),
                })
            if items and updated:
                by_key[cat[0]] = {"key": cat[0], "label": cat[1], "updated_at": updated, "items": items}
        out = [by_key[k] for k, _ in _CATEGORIES.values() if k in by_key]
    except Exception as e:
        logger.warning(f"[Semiconductor] DRAMeXchange 파싱 실패: {e}")
        return {"categories": []}
    return {"categories": out}


_KEY = "memory_spot"
_HOME_URL = "https://www.dramexchange.com/"
# eco: 모듈 전역 락 하나 — 배치·수동·백필(S3)이 같은 load-merge-save 구간을 공유한다. 처리량이 문제면 키별 락.
_lock = threading.Lock()


def _fetch_home_html() -> str:
    r = requests.get(_HOME_URL, headers={"User-Agent": "Mozilla/5.0"}, timeout=15)
    r.raise_for_status()
    return r.text


def _merge_item(prev: Optional[dict], new: dict, day: str, newer: bool) -> dict:
    """품목 병합 — history는 날짜 키로 합치고, 현재값은 새 값이 더 최신이고 avg가 있을 때만 교체."""
    hist = (prev or {}).get("history", [])
    if new.get("avg") is not None:
        hist = _merge_history(hist, [{"date": day, "value": new["avg"]}])
    if prev and not (newer and new.get("avg") is not None):
        return {**prev, "history": hist}
    return {**new, "history": hist}


def _merge_category(prev: Optional[dict], new: dict) -> dict:
    newer = not prev or new["updated_at"] >= prev["updated_at"]
    prev_items = {i["id"]: i for i in (prev or {}).get("items", [])}
    # 현재 목록 = 가장 최신 페이로드의 품목. 거기서 빠진 품목(단종)·옛 스냅샷에만 있는 품목은
    # stale로 이력만 보존하고 현재 표(get_memory_spot)에선 숨긴다(task#403 — 백필이 1년 전 품목을 부활시켰다).
    items = {k: {**v, "stale": True} if newer else v for k, v in prev_items.items()}
    for it in new["items"]:
        m = _merge_item(prev_items.get(it["id"]), it, new["updated_at"], newer)
        stale = False if newer else prev_items.get(it["id"], {"stale": True}).get("stale", False)
        items[it["id"]] = {**m, "stale": stale}
    head = new if newer else prev
    return {"key": head["key"], "label": head["label"], "updated_at": head["updated_at"],
            "items": list(items.values())}


def merge_and_save_memory_spot(parsed: dict) -> dict:
    """파싱 결과를 저장값에 병합·저장(빠진 분류는 직전값 보존, 최신 목록에서 빠진 품목은 stale — 이력만 보존). S3 백필도 이 경로를 쓴다.

    `_mc_load_strict`라 조회 실패는 전파된다(저장값 위에 누적하므로 실패를 빈 이력으로 접으면 이력 파괴).
    반환: 병합된 {"categories": [...]} (저장된 dict와 별개 사본)."""
    with _lock:
        prev = {c["key"]: c for c in ((_mc_load_strict(_KEY) or {}).get("data") or {}).get("categories", [])}
        new = {c["key"]: c for c in parsed.get("categories", [])}
        merged = [_merge_category(prev.get(k), new[k]) if k in new else prev[k]
                  for k, _l in _CATEGORIES.values() if k in new or k in prev]
        _mc_save(_KEY, {"categories": merged})
    return {"categories": [dict(c) for c in merged]}


def fetch_and_save_memory_spot() -> dict:
    """홈 fetch→파싱→병합 저장. 분류 단위 직전값 보존(예외·빈응답·분류 누락 3클래스).

    반환의 `_status`: "success"(6분류 전부 갱신) / "partial"(일부 분류 누락, 직전값 유지) /
    "skipped"(예외·빈응답 — 저장 생략). 호출측이 job_runs 상태로 반영한다. 저장 뒤 새 dict라 캐시에 안 섞인다."""
    try:
        parsed = parse_dramexchange(_fetch_home_html())
    except Exception as e:
        logger.warning(f"[Semiconductor] DRAMeXchange fetch 실패, 직전값 유지: {e}")
        parsed = {"categories": []}
    if not parsed["categories"]:
        logger.warning("[Semiconductor] 갱신 가능한 분류 0건 — 저장 생략, 직전값 유지")
        stored = (_mc_load(_KEY) or {}).get("data") or {"categories": []}
        return {**stored, "_status": "skipped"}
    out = merge_and_save_memory_spot(parsed)
    if len(parsed["categories"]) < len(_CATEGORIES):
        missing = set(k for k, _ in _CATEGORIES.values()) - {c["key"] for c in parsed["categories"]}
        logger.warning(f"[Semiconductor] 분류 누락 {sorted(missing)} — 직전값 유지")
        return {**out, "_status": "partial"}
    return {**out, "_status": "success"}


def get_memory_spot() -> dict:
    """저장값만 읽는다(요청경로 외부 호출 0). 미저장이면 빈 목록.
    `_mc_load_strict`라 조회 실패는 전파된다(빈 목록=「없음」 판정에 graceful 헬퍼를 쓰면 실패가 없음으로 접힌다)."""
    stored = _mc_load_strict(_KEY)
    if not stored or not stored.get("data"):
        return {"categories": [], "fetched_at": None}
    cats = [{**c, "items": [{"history": [], **{k: v for k, v in it.items() if k != "stale"}}
                            for it in c["items"] if not it.get("stale")]}
            for c in stored["data"].get("categories", [])]
    fa = stored.get("fetched_at")
    return {"categories": cats, "fetched_at": fa.isoformat() if hasattr(fa, "isoformat") else fa}


# ── 아카이브 백필 (Wayback CDX → 일 단위 스냅샷 → 같은 병합 경로) ─────────────────
_CDX_URL = "https://web.archive.org/cdx/search/cdx"
_WAYBACK_URL = "https://web.archive.org/web/{ts}id_/https://www.dramexchange.com/"
_BACKFILL_DAYS = 365
# Wayback 레이트리밋(분당 ~15회) 아래로 — 1초 간격은 134건 중 116건이 Connection refused(task#403 실측)
_BACKFILL_GAP = 5.0  # 요청 간 최소 간격(초) — 분당 12회, 1년치 ~134건이면 ~11분
_BACKFILL_COOLDOWN = 60.0  # 연결 거부·HTTP 오류 시 쉬었다가 1회 재시도
_backfill_lock = threading.Lock()
_backfill_running = False


def try_start_backfill() -> bool:
    """단일 비행 플래그 선점. 이미 실행 중이면 False."""
    global _backfill_running
    with _backfill_lock:
        if _backfill_running:
            return False
        _backfill_running = True
        return True


def _set_backfill_idle() -> None:
    global _backfill_running
    with _backfill_lock:
        _backfill_running = False


def _list_snapshots(today: date) -> list:
    start = (today - timedelta(days=_BACKFILL_DAYS)).strftime("%Y%m%d")
    url = (f"{_CDX_URL}?url=dramexchange.com/&from={start}&collapse=timestamp:8"
           "&filter=statuscode:200&fl=timestamp&output=json")
    r = requests.get(url, headers={"User-Agent": "Mozilla/5.0"}, timeout=60)
    r.raise_for_status()
    rows = r.json() or []
    return sorted({row[0] for row in rows if row and row[0] != "timestamp"})


def _get_snapshot(ts: str) -> str:
    for attempt in (0, 1):
        try:
            r = requests.get(_WAYBACK_URL.format(ts=ts), headers={"User-Agent": "Mozilla/5.0"},
                             timeout=60, allow_redirects=True)
            r.raise_for_status()
            return r.text
        except requests.RequestException:
            if attempt:
                raise
            time.sleep(_BACKFILL_COOLDOWN)


def run_backfill() -> dict:
    """최근 1년 Wayback 스냅샷을 병합. 스냅샷 단위 실패는 건너뛰고 카운트.

    반환 status: success(전부 병합) / partial(일부 건너뜀) / failed(CDX 실패·스냅샷 0건·전부 실패).
    끝나면 단일 비행 플래그를 푼다(호출측이 try_start_backfill로 선점한 경우)."""
    merged = skipped = 0
    try:
        try:
            snaps = _list_snapshots(today_kst())
        except Exception as e:
            logger.warning(f"[Semiconductor] 백필 CDX 조회 실패: {e}")
            return {"status": "failed", "snapshots": 0, "skipped": 0, "error": f"CDX: {e}"}
        for i, ts in enumerate(snaps):
            if i:
                time.sleep(_BACKFILL_GAP)
            try:
                d = f"{ts[:4]}-{ts[4:6]}-{ts[6:8]}"
                parsed = parse_dramexchange(_get_snapshot(ts), ref_date=date.fromisoformat(d))
                if not parsed["categories"]:
                    raise ValueError("파싱 가능한 분류 0건")
                merge_and_save_memory_spot(parsed)
                merged += 1
            except Exception as e:
                skipped += 1
                logger.warning(f"[Semiconductor] 백필 스냅샷 건너뜀 ({ts}): {e}")
        status = "failed" if not merged else ("partial" if skipped else "success")
        out = {"status": status, "snapshots": merged, "skipped": skipped}
        if status == "failed":
            out["error"] = "백필 가능한 스냅샷 없음" if not snaps else "전 스냅샷 실패"
        return out
    finally:
        _set_backfill_idle()

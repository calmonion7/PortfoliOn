"""
기존 JSON 파일 → Supabase DB 1회성 마이그레이션 스크립트.

실행 전:
  1. SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, ADMIN_USER_ID 환경변수 설정
  2. backend/.env 파일 또는 shell export
  3. ADMIN_USER_ID = Supabase Auth에서 첫 로그인한 관리자의 user UUID

실행:
  cd backend && .venv/bin/python scripts/migrate_to_supabase.py
"""
import json
import math
import os
import sys
from pathlib import Path
from dotenv import load_dotenv


def _sanitize(obj):
    if isinstance(obj, float) and (math.isnan(obj) or math.isinf(obj)):
        return None
    if isinstance(obj, dict):
        return {k: _sanitize(v) for k, v in obj.items()}
    if isinstance(obj, list):
        return [_sanitize(v) for v in obj]
    return obj

load_dotenv()

from supabase import create_client

DATA_DIR = Path(__file__).parent.parent / "data"
SNAPSHOTS_DIR = Path(__file__).parent.parent / "snapshots"

supabase_client = create_client(
    os.environ["SUPABASE_URL"],
    os.environ["SUPABASE_SERVICE_ROLE_KEY"],
)

ADMIN_USER_ID = os.environ.get("ADMIN_USER_ID")
if not ADMIN_USER_ID:
    print("ERROR: ADMIN_USER_ID 환경변수가 필요합니다. Supabase Auth에서 첫 로그인 후 UUID를 확인하세요.")
    sys.exit(1)


def migrate_stocks():
    path = DATA_DIR / "stocks.json"
    if not path.exists():
        print("stocks.json 없음, 건너뜀")
        return
    data = json.loads(path.read_text())
    stocks = data.get("stocks", [])
    for s in stocks:
        ticker = s["ticker"].upper()
        supabase_client.table("tickers").upsert(
            {
                "ticker": ticker,
                "name": s.get("name") or ticker,
                "market": s.get("market") or "US",
                "exchange": s.get("exchange") or "",
                "competitors": s.get("competitors") or [],
                "moat": s.get("moat") or "",
                "growth_plan": s.get("growth_plan") or "",
                "risks": s.get("risks") or "",
                "recent_disclosures": s.get("recent_disclosures") or "",
            },
            on_conflict="ticker",
        ).execute()
        supabase_client.table("user_stocks").upsert(
            {
                "user_id": ADMIN_USER_ID,
                "ticker": ticker,
                "type": s.get("type") or "watchlist",
                "quantity": s.get("quantity"),
                "avg_cost": s.get("avg_cost"),
            },
            on_conflict="user_id,ticker",
        ).execute()
    print(f"stocks 마이그레이션 완료: {len(stocks)}개")


def migrate_snapshots():
    if not SNAPSHOTS_DIR.exists():
        print("snapshots 디렉토리 없음, 건너뜀")
        return
    count = 0
    for ticker_dir in SNAPSHOTS_DIR.iterdir():
        if not ticker_dir.is_dir():
            continue
        ticker = ticker_dir.name.upper()
        existing = supabase_client.table("tickers").select("ticker").eq("ticker", ticker).execute().data
        if not existing:
            supabase_client.table("tickers").insert({"ticker": ticker, "name": ticker}).execute()
        for snap_file in ticker_dir.glob("*.json"):
            date = snap_file.stem
            try:
                snap_data = json.loads(snap_file.read_text())
            except Exception:
                continue
            supabase_client.table("snapshots").upsert(
                {"ticker": ticker, "date": date, "data": _sanitize(snap_data)},
                on_conflict="ticker,date",
            ).execute()
            count += 1
    print(f"snapshots 마이그레이션 완료: {count}개")


def migrate_schedule():
    path = DATA_DIR / "schedule.json"
    if not path.exists():
        print("schedule.json 없음, 건너뜀")
        return
    data = json.loads(path.read_text())
    supabase_client.table("schedules").update({"data": data}).eq("id", 1).execute()
    print("schedule 마이그레이션 완료")


def migrate_guru():
    path = DATA_DIR / "guru_managers.json"
    if not path.exists():
        print("guru_managers.json 없음, 건너뜀")
        return
    data = json.loads(path.read_text())
    supabase_client.table("guru_managers").update({"data": data}).eq("id", 1).execute()
    print("guru_managers 마이그레이션 완료")

    path2 = DATA_DIR / "guru_schedule.json"
    if path2.exists():
        data2 = json.loads(path2.read_text())
        supabase_client.table("guru_schedules").update({"data": data2}).eq("id", 1).execute()
        print("guru_schedule 마이그레이션 완료")


if __name__ == "__main__":
    migrate_stocks()
    migrate_snapshots()
    migrate_schedule()
    migrate_guru()
    print("전체 마이그레이션 완료. 기존 JSON 파일은 보관됨.")

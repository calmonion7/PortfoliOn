from dotenv import load_dotenv
load_dotenv()

import os
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pathlib import Path
from contextlib import asynccontextmanager
from datetime import date
import threading

import scheduler as sched
from routers import portfolio, report, watchlist, stocks, guru, calendar, digest, analytics
from routers.market_indicators import router as market_indicators_router
from routers.analysis import router as analysis_router

SNAPSHOTS_DIR = Path(__file__).parent / "snapshots"
SNAPSHOTS_DIR.mkdir(exist_ok=True)


def _warm_calendar_cache():
    today = date.today()
    months = [today.replace(day=1)]
    next_month = date(today.year + (today.month // 12), today.month % 12 + 1, 1)
    months.append(next_month)
    for m in months:
        month_str = m.strftime("%Y-%m")
        if not calendar._cache_path(month_str).exists():
            try:
                calendar._get_events(month_str)
            except Exception:
                pass


@asynccontextmanager
async def lifespan(app: FastAPI):
    sched.start()
    threading.Thread(target=_warm_calendar_cache, daemon=True).start()
    yield
    sched.stop()


app = FastAPI(title="Stock Portfolio Manager", lifespan=lifespan)

_frontend_url = os.getenv("FRONTEND_URL", "")
app.add_middleware(
    CORSMiddleware,
    allow_origins=[o for o in ["http://localhost:3000", "http://localhost:5173", _frontend_url] if o],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(portfolio.router)
app.include_router(report.router)
app.include_router(watchlist.router)
app.include_router(stocks.router)
app.include_router(guru.router)
app.include_router(calendar.router)
app.include_router(digest.router)
app.include_router(market_indicators_router)
app.include_router(analytics.router)
app.include_router(analysis_router)


@app.get("/health")
def health():
    return {"status": "ok"}

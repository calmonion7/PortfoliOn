from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pathlib import Path
from contextlib import asynccontextmanager
from datetime import date
import threading

import scheduler as sched
from routers import portfolio, report, watchlist, stocks, guru, calendar, digest

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
app.include_router(calendar.router)
app.include_router(digest.router)


@app.get("/health")
def health():
    return {"status": "ok"}

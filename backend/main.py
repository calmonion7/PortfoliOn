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

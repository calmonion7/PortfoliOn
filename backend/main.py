from dotenv import load_dotenv
load_dotenv()

import os
import logging
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from starlette.middleware.sessions import SessionMiddleware
from pathlib import Path
from contextlib import asynccontextmanager
import threading

logger = logging.getLogger(__name__)


def _configure_logging():
    """루트 로거 1회 배선 (로깅 방출 규약, task#162). config 부재 시 root lastResort가
    WARNING+만 내보내 logger.info가 docker logs에 미표시되던 문제를 해소한다.
    서드파티 노이즈 라이브러리는 WARNING으로 억제하고, uvicorn 로거는 propagate를 꺼
    root 핸들러와의 중복 emit(double-log)을 막는다. 레벨/포맷 규약은 CONVENTIONS.md 참조."""
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")
    for _noisy in ("urllib3", "yfinance", "apscheduler", "asyncio"):
        logging.getLogger(_noisy).setLevel(logging.WARNING)
    for _uv in ("uvicorn", "uvicorn.error", "uvicorn.access"):
        logging.getLogger(_uv).propagate = False


_configure_logging()

import scheduler as sched
from routers import portfolio, report, watchlist, stocks, guru, calendar, digest, analytics
from routers.market_indicators import router as market_indicators_router
from routers.analysis import router as analysis_router
from routers.auth import router as auth_router
from routers.admin import router as admin_router
from routers.events import router as events_router
from routers.rankings import router as rankings_router
from routers.investor import router as investor_router
from routers.short_sell import router as short_sell_router
from routers.batches import router as batches_router
from routers.recommendations import router as recommendations_router
from middleware.event_tracker import EventTrackerMiddleware

SNAPSHOTS_DIR = Path(__file__).parent / "snapshots"
SNAPSHOTS_DIR.mkdir(exist_ok=True)


def _warm_market_cache():
    try:
        from services.market_indicators import get_econ_indicators, get_kr_exports
        get_econ_indicators()
        get_kr_exports()
    except Exception:
        pass


def _migrate():
    """기동 시 idempotent 추가 마이그레이션 (배포가 자동 적용; DDL은 ADD COLUMN IF NOT EXISTS)."""
    try:
        from services.db import execute
        execute("ALTER TABLE backlog_history ADD COLUMN IF NOT EXISTS segments JSONB")
    except Exception as e:
        logger.warning(f"[Migrate] backlog_history.segments 추가 실패: {e}")
    try:
        from services.db import execute
        execute("CREATE TABLE IF NOT EXISTS batch_schedules (job_id text PRIMARY KEY, data jsonb NOT NULL)")
    except Exception as e:
        logger.warning(f"[Migrate] batch_schedules 생성 실패: {e}")
    try:
        from services.db import execute
        execute("""CREATE TABLE IF NOT EXISTS market_short_sell (
            ticker TEXT NOT NULL, base_date DATE NOT NULL,
            short_volume NUMERIC(20,0), short_value NUMERIC(20,0),
            short_ratio NUMERIC(6,2), short_balance NUMERIC(20,0), close_price NUMERIC,
            created_at TIMESTAMPTZ DEFAULT NOW(), PRIMARY KEY (ticker, base_date))""")
        execute("CREATE INDEX IF NOT EXISTS idx_short_sell_read ON market_short_sell(ticker, base_date DESC)")
    except Exception as e:
        logger.warning(f"[Migrate] market_short_sell 생성 실패: {e}")
    try:
        from services.db import execute
        execute("""CREATE TABLE IF NOT EXISTS stock_disclosures (
            rcept_no TEXT PRIMARY KEY,
            ticker TEXT NOT NULL, rcept_dt DATE, report_nm TEXT,
            pblntf_ty TEXT, corp_name TEXT,
            fetched_at TIMESTAMPTZ DEFAULT NOW())""")
        execute("CREATE INDEX IF NOT EXISTS idx_disclosures_read ON stock_disclosures(ticker, rcept_dt DESC)")
    except Exception as e:
        logger.warning(f"[Migrate] stock_disclosures 생성 실패: {e}")
    try:
        from services.db import execute
        execute("""CREATE TABLE IF NOT EXISTS stock_dividends (
            ticker TEXT PRIMARY KEY,
            annual_dividend_per_share NUMERIC,
            dividend_yield NUMERIC,
            currency TEXT,
            source TEXT,
            fetched_at TIMESTAMPTZ DEFAULT NOW())""")
    except Exception as e:
        logger.warning(f"[Migrate] stock_dividends 생성 실패: {e}")
    try:
        from services.db import execute
        execute("""CREATE TABLE IF NOT EXISTS stock_dividend_schedule (
            ticker TEXT NOT NULL,
            ex_date DATE NOT NULL,
            pay_date DATE,
            amount_per_share NUMERIC,
            currency TEXT,
            status TEXT NOT NULL,
            source TEXT,
            fetched_at TIMESTAMPTZ DEFAULT NOW(),
            PRIMARY KEY (ticker, ex_date))""")
        execute("CREATE INDEX IF NOT EXISTS idx_dividend_schedule_read ON stock_dividend_schedule(ticker, ex_date)")
    except Exception as e:
        logger.warning(f"[Migrate] stock_dividend_schedule 생성 실패: {e}")
    try:
        from services.db import execute
        execute("""CREATE TABLE IF NOT EXISTS stock_beta (
            ticker TEXT PRIMARY KEY,
            beta NUMERIC,
            source TEXT,
            fetched_at TIMESTAMPTZ DEFAULT NOW())""")
    except Exception as e:
        logger.warning(f"[Migrate] stock_beta 생성 실패: {e}")
    try:
        from services.db import execute
        execute("""CREATE TABLE IF NOT EXISTS stock_supply_score (
            ticker TEXT PRIMARY KEY,
            computed_date DATE NOT NULL,
            band TEXT NOT NULL,
            flags JSONB NOT NULL DEFAULT '[]'::jsonb,
            as_of JSONB,
            created_at TIMESTAMPTZ DEFAULT NOW())""")
    except Exception as e:
        logger.warning(f"[Migrate] stock_supply_score 생성 실패: {e}")
    try:
        from services.db import execute
        execute("""CREATE TABLE IF NOT EXISTS stock_insider_trades (
            row_hash TEXT PRIMARY KEY,
            ticker TEXT NOT NULL,
            report_kind TEXT NOT NULL,
            rcept_no TEXT NOT NULL,
            rcept_dt DATE,
            repror TEXT,
            rel TEXT,
            shares_change BIGINT,
            shares_after BIGINT,
            rate_after NUMERIC,
            fetched_at TIMESTAMPTZ DEFAULT NOW())""")
        execute("CREATE INDEX IF NOT EXISTS idx_insider_read ON stock_insider_trades(ticker, rcept_dt DESC)")
    except Exception as e:
        logger.warning(f"[Migrate] stock_insider_trades 생성 실패: {e}")
    try:
        from services.db import execute
        execute("ALTER TABLE stock_disclosures ADD COLUMN IF NOT EXISTS meeting_date DATE")
    except Exception as e:
        logger.warning(f"[Migrate] stock_disclosures.meeting_date 추가 실패: {e}")
    try:
        from services.db import execute
        execute("""CREATE TABLE IF NOT EXISTS stock_recommendations (
            ticker TEXT PRIMARY KEY,
            market TEXT NOT NULL,
            score NUMERIC NOT NULL,
            factors JSONB NOT NULL DEFAULT '{}'::jsonb,
            flags JSONB NOT NULL DEFAULT '[]'::jsonb,
            rank INTEGER,
            base_date DATE NOT NULL,
            low_liquidity BOOLEAN NOT NULL DEFAULT FALSE,
            exchange TEXT,
            updated_at TIMESTAMPTZ DEFAULT NOW())""")
        execute("ALTER TABLE stock_recommendations ADD COLUMN IF NOT EXISTS low_liquidity BOOLEAN NOT NULL DEFAULT FALSE")
        execute("ALTER TABLE stock_recommendations ADD COLUMN IF NOT EXISTS exchange TEXT")
        execute("ALTER TABLE stock_recommendations ADD COLUMN IF NOT EXISTS name TEXT")
        execute("CREATE INDEX IF NOT EXISTS idx_recommendations_read ON stock_recommendations(market, score DESC)")
    except Exception as e:
        logger.warning(f"[Migrate] stock_recommendations 생성 실패: {e}")
    try:
        from services.db import execute
        execute("""CREATE TABLE IF NOT EXISTS us_supply_snapshot (
            ticker                TEXT PRIMARY KEY,
            short_pct_float       NUMERIC,
            short_ratio           NUMERIC,
            shares_short          BIGINT,
            date_short_interest   DATE,
            institutional_holders JSONB DEFAULT '[]'::jsonb,
            fetched_at            TIMESTAMPTZ DEFAULT NOW())""")
        execute("ALTER TABLE us_supply_snapshot ADD COLUMN IF NOT EXISTS insider_transactions JSONB DEFAULT '[]'::jsonb")
        execute("ALTER TABLE us_supply_snapshot ADD COLUMN IF NOT EXISTS insider_net JSONB DEFAULT '{}'::jsonb")
    except Exception as e:
        logger.warning(f"[Migrate] us_supply_snapshot 생성 실패: {e}")
    try:
        from services.db import execute
        execute("ALTER TABLE user_stocks ADD COLUMN IF NOT EXISTS target_price numeric")
        execute("ALTER TABLE user_stocks ADD COLUMN IF NOT EXISTS stop_price numeric")
        execute("ALTER TABLE user_stocks ADD COLUMN IF NOT EXISTS target_weight numeric")
        execute("ALTER TABLE user_stocks ADD COLUMN IF NOT EXISTS pinned boolean NOT NULL DEFAULT false")
    except Exception as e:
        logger.warning(f"[Migrate] user_stocks 목표가/손절가 추가 실패: {e}")
    try:
        from services.db import execute
        execute("ALTER TABLE tickers ADD COLUMN IF NOT EXISTS key_resource text NOT NULL DEFAULT ''")
    except Exception as e:
        logger.warning(f"[Migrate] tickers.key_resource 추가 실패: {e}")
    try:
        from services.db import execute
        execute("ALTER TABLE tickers ADD COLUMN IF NOT EXISTS competitor_edge text NOT NULL DEFAULT ''")
    except Exception as e:
        logger.warning(f"[Migrate] tickers.competitor_edge 추가 실패: {e}")
    try:
        from services.db import execute
        execute("ALTER TABLE tickers ADD COLUMN IF NOT EXISTS market_outlook text NOT NULL DEFAULT ''")
    except Exception as e:
        logger.warning(f"[Migrate] tickers.market_outlook 추가 실패: {e}")


@asynccontextmanager
async def lifespan(app: FastAPI):
    _migrate()
    sched.start()
    threading.Thread(target=_warm_market_cache, daemon=True).start()
    yield
    sched.stop()


app = FastAPI(title="Stock Portfolio Manager", lifespan=lifespan)

app.add_middleware(SessionMiddleware, secret_key=os.environ["SESSION_SECRET"])
app.add_middleware(EventTrackerMiddleware)

_frontend_url = os.getenv("FRONTEND_URL", "")
app.add_middleware(
    CORSMiddleware,
    allow_origins=[o for o in ["http://localhost:3000", "http://localhost:5173", _frontend_url] if o],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth_router)
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
app.include_router(events_router)
app.include_router(rankings_router)
app.include_router(investor_router)
app.include_router(short_sell_router)
app.include_router(batches_router)
app.include_router(recommendations_router)
app.include_router(admin_router)


@app.api_route("/health", methods=["GET", "HEAD"])
def health():
    return {"status": "ok"}

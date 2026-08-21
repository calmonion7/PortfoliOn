from dotenv import load_dotenv
load_dotenv()

import os
import logging
from fastapi import FastAPI
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
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
from routers.analyst_reports import router as analyst_reports_router
from routers.tech_reports import router as tech_reports_router
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
    try:
        from services.db import execute
        execute("ALTER TABLE tickers ADD COLUMN IF NOT EXISTS analyst_target boolean NOT NULL DEFAULT false")
    except Exception as e:
        logger.warning(f"[Migrate] tickers.analyst_target 추가 실패: {e}")
    try:
        from services.db import execute
        execute("""CREATE TABLE IF NOT EXISTS analyst_reports (
            id               BIGSERIAL PRIMARY KEY,
            ticker           TEXT NOT NULL,
            published_date   DATE NOT NULL,
            rating           TEXT NOT NULL,
            title            TEXT NOT NULL,
            fair_value_low   NUMERIC,
            fair_value_high  NUMERIC,
            valuation_method TEXT NOT NULL DEFAULT '',
            points           JSONB NOT NULL DEFAULT '[]'::jsonb,
            risks            TEXT NOT NULL DEFAULT '',
            data             JSONB NOT NULL DEFAULT '{}'::jsonb,
            created_at       TIMESTAMPTZ DEFAULT NOW(),
            UNIQUE (ticker, published_date))""")
    except Exception as e:
        logger.warning(f"[Migrate] analyst_reports 생성 실패: {e}")
    try:
        from services.db import execute
        execute("""CREATE TABLE IF NOT EXISTS tech_reports (
            id               BIGSERIAL PRIMARY KEY,
            slug             TEXT NOT NULL,
            published_date   DATE NOT NULL,
            title            TEXT NOT NULL,
            description      TEXT NOT NULL DEFAULT '',
            difficulty       JSONB,
            players          JSONB DEFAULT '[]'::jsonb,
            challenges       JSONB DEFAULT '[]'::jsonb,
            related          JSONB DEFAULT '{}'::jsonb,
            market           JSONB DEFAULT '{}'::jsonb,
            sources          JSONB DEFAULT '[]'::jsonb,
            key_points       JSONB,
            milestones       JSONB,
            created_at       TIMESTAMPTZ DEFAULT NOW(),
            UNIQUE (slug, published_date))""")
    except Exception as e:
        logger.warning(f"[Migrate] tech_reports 생성 실패: {e}")
    try:
        # 라이브 DB는 이미 CREATE TABLE을 지났으므로 위 DDL이 아니라 이 ALTER만 탄다(ADR-0006).
        from services.db import execute
        execute("ALTER TABLE tech_reports ADD COLUMN IF NOT EXISTS key_points JSONB")
        execute("ALTER TABLE tech_reports ADD COLUMN IF NOT EXISTS milestones JSONB")
    except Exception as e:
        logger.warning(f"[Migrate] tech_reports 요약 레이어 컬럼 추가 실패: {e}")
    try:
        from services.db import execute
        execute("ALTER TABLE tech_reports ADD COLUMN IF NOT EXISTS variants JSONB")
        execute("ALTER TABLE tech_reports ADD COLUMN IF NOT EXISTS watch_items JSONB")
    except Exception as e:
        logger.warning(f"[Migrate] tech_reports 계보축·체크리스트 컬럼 추가 실패: {e}")
    try:
        # 기술 해부 3축(ADR-0042). app_schema.sql은 신규 설치용이라 라이브 DB는 이 ALTER만 탄다
        # — 한쪽만 고치면 배포 직후 composition을 쓰는 INSERT가 컬럼 부재로 깨진다(task#130).
        from services.db import execute
        execute("ALTER TABLE tech_reports ADD COLUMN IF NOT EXISTS composition JSONB")
    except Exception as e:
        logger.warning(f"[Migrate] tech_reports 기술 해부 컬럼 추가 실패: {e}")
    try:
        # 판 누적 폐기(ADR-0038): slug당 최신 1행만 남기고 과거 행 삭제 후 UNIQUE(slug)로 전환.
        # 이 인덱스가 없으면 라우터의 ON CONFLICT (slug)가 런타임 500이 되므로 결과를 loud하게 남긴다.
        from services.db import execute
        deleted = execute("""
            DELETE FROM tech_reports a USING tech_reports b
            WHERE a.slug = b.slug
              AND (a.published_date < b.published_date
                   OR (a.published_date = b.published_date AND a.id < b.id))
        """)
        execute("ALTER TABLE tech_reports DROP CONSTRAINT IF EXISTS tech_reports_slug_published_date_key")
        execute("CREATE UNIQUE INDEX IF NOT EXISTS tech_reports_slug_key ON tech_reports (slug)")
        logger.info(f"[Migrate] tech_reports 이력 폐기: 과거 행 {deleted}건 삭제, UNIQUE(slug) 인덱스 확보")
    except Exception as e:
        logger.warning(f"[Migrate] tech_reports 이력 폐기 실패: {e}")
    try:
        # 대상 개정(ADR-0039 결정 1): data-center 1종을 폐기하고 ai-datacenter-equipment·
        # ai-datacenter-ops 2종으로 대체. 반드시 이 slug만 지운다 — TECH_TOPICS 밖 전부 삭제 같은
        # 일반형은 나중에 누가 slug를 일시적으로 빼는 순간 그 발행물을 조용히 지워버린다.
        from services.db import execute
        deleted = execute("DELETE FROM tech_reports WHERE slug = 'data-center'")
        logger.info(f"[Migrate] tech_reports: 은퇴 slug data-center 행 {deleted}건 삭제")
    except Exception as e:
        logger.warning(f"[Migrate] tech_reports data-center 은퇴 실패: {e}")


@asynccontextmanager
async def lifespan(app: FastAPI):
    _migrate()
    sched.start()
    threading.Thread(target=_warm_market_cache, daemon=True).start()
    yield
    sched.stop()


app = FastAPI(title="Stock Portfolio Manager", lifespan=lifespan)


@app.exception_handler(RequestValidationError)
async def _validation_error_handler(request, exc):
    # 422 detail이 요청의 NaN/inf 입력을 echo하면 starlette allow_nan=False 직렬화에서
    # 500이 된다(예: analyst-reports 발행 body의 NaN) — sanitize로 비유한값을 null화(CONCERNS §3).
    from fastapi.encoders import jsonable_encoder
    from services.utils import sanitize
    return JSONResponse(status_code=422, content={"detail": sanitize(jsonable_encoder(exc.errors()))})


@app.exception_handler(Exception)
async def _unhandled_exception_handler(request, exc):
    """미포착 예외를 스택·내부 메시지 없는 구조화 JSON 500으로 바꾼다 (B72 부수, S3).

    핸들러가 없으면 starlette 기본 경로가 `text/plain` raw 500을 내고, 디버그 설정·프레임워크
    버전에 따라 내부 메시지나 스택 흔적이 응답으로 새어나갈 수 있다(클라이언트도 JSON을
    기대하는데 plain-text를 받아 파싱에 실패한다). 대신 고정 본문만 내보내고 원인은 서버
    로그에만 남긴다 — `wrong < missing`의 응답판: 클라이언트에겐 없는 정보가 위험한 정보보다 낫다.

    제약 3가지:
      ⓐ `HTTPException`을 삼키지 않는다 — starlette는 `Exception`/500 키의 핸들러만
        ServerErrorMiddleware로 보내고 HTTPException·RequestValidationError는
        ExceptionMiddleware에 남긴다(`build_middleware_stack`). 그래서 404·401·403의
        상태코드·본문 계약이 보존된다.
      ⓑ 본문은 `sanitize` 경유 — `JSONResponse`는 `allow_nan=False`라 본문에 NaN/inf가 섞이면
        **이 핸들러 자신이 500을 낸다**(핸들러가 핸들러를 필요로 하는 상태). 지금 본문은 정적
        문자열이라 sanitize는 no-op이지만, 나중에 예외 컨텍스트에서 온 값을 본문에 실을 때
        그 상태로 빠지는 것을 원리적으로 막는 래퍼다 — 이 래퍼를 빼지 말 것.
      ⓒ 위 `RequestValidationError` 핸들러(422, CONCERNS §3)는 별도 키라 우선순위가 겹치지
        않는다 — 422 경로는 이 핸들러에 도달하지 않는다.

    ServerErrorMiddleware는 이 핸들러 호출 *뒤에도* 예외를 재raise하므로(errors.py
    "We always continue to raise the exception") uvicorn의 스택 로그와 TestClient의 예외
    전파 동작은 그대로다. 검증: tests/test_global_exception_handler.py.
    """
    from services.utils import sanitize
    logger.error(
        f"[UnhandledError] {request.method} {request.url.path} 처리 중 미포착 예외 "
        f"{type(exc).__name__}: {exc}",
        exc_info=True,
    )
    return JSONResponse(status_code=500, content=sanitize({"detail": "Internal Server Error"}))


_session_secret = os.environ.get("SESSION_SECRET") or ""
if not _session_secret:
    # bare `os.environ[...]`는 키가 *부재*할 때만 KeyError를 내고 **빈 문자열은 통과시킨다**.
    # 그러면 컨테이너는 정상 기동하고 헬스체크도 통하는데(access/refresh는 JWT_SECRET이라
    # 무영향) `routers/auth.py::_hmac_secret`만 RuntimeError를 던져 **신규·재로그인만 전면
    # 불가**해진다 — 배포 스모크에 안 잡히는 무음 고장이다(시크릿 회전 중 `SESSION_SECRET=`가
    # 남는 것이 실제 도달 경로). 부재와 빈 값을 같은 기동 실패로 수렴시킨다.
    raise RuntimeError("SESSION_SECRET is not set (missing or empty) — refusing to start")
app.add_middleware(SessionMiddleware, secret_key=_session_secret)
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
app.include_router(analyst_reports_router)
app.include_router(tech_reports_router)
app.include_router(admin_router)


@app.api_route("/health", methods=["GET", "HEAD"])
def health():
    return {"status": "ok"}

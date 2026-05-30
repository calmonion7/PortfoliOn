# CLAUDE.md

Behavioral guidelines to reduce common LLM coding mistakes, followed by PortfoliOn project context.

**Tradeoff:** These guidelines bias toward caution over speed. For trivial tasks, use judgment.

---

## 1. Think Before Coding

**Don't assume. Don't hide confusion. Surface tradeoffs.**

Before implementing:

- State your assumptions explicitly. If uncertain, ask.
- If multiple interpretations exist, present them - don't pick silently.
- If a simpler approach exists, say so. Push back when warranted.
- If something is unclear, stop. Name what's confusing. Ask.

## 2. Simplicity First

**Minimum code that solves the problem. Nothing speculative.**

- No features beyond what was asked.
- No abstractions for single-use code.
- No "flexibility" or "configurability" that wasn't requested.
- No error handling for impossible scenarios.
- If you write 200 lines and it could be 50, rewrite it.

Ask yourself: "Would a senior engineer say this is overcomplicated?" If yes, simplify.

## 3. Surgical Changes

**Touch only what you must. Clean up only your own mess.**

When editing existing code:

- Don't "improve" adjacent code, comments, or formatting.
- Don't refactor things that aren't broken.
- Match existing style, even if you'd do it differently.
- If you notice unrelated dead code, mention it - don't delete it.

When your changes create orphans:

- Remove imports/variables/functions that YOUR changes made unused.
- Don't remove pre-existing dead code unless asked.

The test: Every changed line should trace directly to the user's request.

## 4. Goal-Driven Execution

**Define success criteria. Loop until verified.**

Transform tasks into verifiable goals:

- "Add validation" → "Write tests for invalid inputs, then make them pass"
- "Fix the bug" → "Write a test that reproduces it, then make it pass"
- "Refactor X" → "Ensure tests pass before and after"

For multi-step tasks, state a brief plan:

```
1. [Step] → verify: [check]
2. [Step] → verify: [check]
3. [Step] → verify: [check]
```

Strong success criteria let you loop independently. Weak criteria ("make it work") require constant clarification.

**These guidelines are working if:** fewer unnecessary changes in diffs, fewer rewrites due to overcomplication, and clarifying questions come before implementation rather than after mistakes.

---

# PortfoliOn — Project Context

## Commands

```bash
# Start both servers (Windows)
start.bat

# Start both servers (macOS/Linux)
./start.sh

# Backend only (from project root)
cd backend && python -m uvicorn main:app --reload --port 8000

# Frontend only
cd frontend && npm run dev

# Backend tests
cd backend && .venv/bin/python -m pytest
```

## Architecture

**Backend** — Python/FastAPI (port 8000)

- `backend/main.py` — app entry, mounts routers + scheduler
- `backend/routers/` — portfolio, watchlist, stocks, report, guru, calendar, digest, market_indicators, analytics, analysis, auth, admin
- `backend/services/` — storage, market (yfinance+Naver API), charts, indicators, report_generator, scraper, consensus, cache, guru_scraper, guru_stats, digest_service, market_indicators_service, analysis_service, auth_service, utils (NaN/Inf sanitize), db, errors, parallel, progress
- `backend/scheduler.py` — APScheduler 설정 (services 아님, 루트 레벨)
- `backend/data/` — 정적 참조 데이터만 (sp500_tickers.json, kospi_tickers.json); 런타임 데이터는 Supabase
- `backend/data/calendar/` — calendar file cache (YYYY-MM.json, gitignored, auto-invalidated on stock mutations)
- `backend/data/consensus/` — per-ticker 컨센서스 JSON 캐시 (gitignored, 로컬 파일 기반)
- `backend/snapshots/` — generated JSON snapshots (gitignored, per-ticker/date)
- `backend/reports/` — legacy report directory (read-only, JSON fallback for old snapshots)

**Frontend** — React 18 + Vite (port 5173), plain CSS (no TailwindCSS)

- `frontend/src/pages/` — Portfolio, Settings, Guru (+ GuruCrawlSettings, GuruManagers, GuruStats, ReportSchedule), ConsensusSettings, LoginPage, Showcase; 허브 3종: Research (리포트·캘린더·다이제스트), MarketHub (시장지표·분석), AnalysisHub (섹터·매크로); 탭 컴포넌트: SectorTab, MacroTab; 개별 페이지(허브 내 탭용): Reports, Calendar, Digest, Market, Analytics
- `frontend/src/components/` — StockModal, PromoteModal, PermissionManager, reports/ (ConsensusChart, DetailTab, FinancialsChart, HistoryTab, Sections), market/ (FxSection, VixSection, CommoditiesSection, TreasurySection, EconIndicatorsSection, M7EarningsSection, KrTop2Section, KrExportsSection, marketUtils.js), ui/ (Badge, Button, Card, Stat, DashboardCard, icons)

## Deployment

- **인프라**: Mac 로컬 Docker 4-컨테이너 (Render/Vercel/Supabase 제거)
- **nginx**: HTTP(80) 서빙, /api/* → backend:8000 프록시
- **backend**: FastAPI 컨테이너 (port 8000)
- **postgres**: PostgreSQL 16 컨테이너, pgdata 볼륨
- **Cloudflare Tunnel**: portfolion.taebro.com → localhost:80
- **launchd 자동실행**: cloudflared + docker compose
- **환경변수**: `backend/.env.docker` (POSTGRES_PASSWORD, JWT_SECRET, SESSION_SECRET, OAuth, FRED_API_KEY), `.env` (루트, docker-compose 보간용)

## Key Files

- `API_SPEC.md` — full REST API reference (source of truth for endpoints)
- `CLAUDE_COWORK_API.md` — external API for Claude AI to read/write stock analysis
- `backend/auth_schema.sql` — Docker PostgreSQL 인증 스키마 (users, refresh_tokens); 반드시 app_schema.sql보다 먼저 실행
- `backend/app_schema.sql` — Docker PostgreSQL 앱 스키마 (tickers, user_stocks, snapshots, schedules, guru_managers, guru_schedules, digests, consensus_history, calendar_cache, market_cache, user_menu_permissions)
- `backend/.venv/` — Python virtual environment (macOS: `backend/.venv/bin/python`, Windows: `backend/.venv/Scripts/python`)

## Data Model

Docker PostgreSQL이 기본 저장소. 로컬 JSON 파일은 런타임 캐시 용도.

스키마: `auth_schema.sql` → `app_schema.sql` 순서로 실행.

| 테이블 | 내용 |
|--------|------|
| `users` | 이메일/OAuth 계정, role (`user`\|`admin`) |
| `refresh_tokens` | JWT 리프레시 토큰 |
| `tickers` | 공유 종목 마스터 (ticker, name, market, moat 등) |
| `user_stocks` | user_id별 보유/관심 종목 (`type: "holding"\|"watchlist"`) |
| `snapshots` | per-ticker, per-date 리포트 JSON (공유) |
| `schedules` | 리포트 자동 생성 스케줄 (전역 단일 행) |
| `guru_schedules` | 구루 크롤링 스케줄 (전역 단일 행) |
| `guru_managers` | 구루 운용역 데이터 캐시 (전역 단일 행) |
| `digests` | user_id+date 기준 일일 다이제스트 |
| `consensus_history` | ticker+date 기준 컨센서스 히스토리 |
| `calendar_cache` | user_id+month 기준 캘린더 이벤트 캐시 |
| `market_cache` | 시장지표 영구 캐시 (fx/vix/commodities/treasury/econ/m7/krtop2/krexports) |
| `user_menu_permissions` | user_id+menu 기준 메뉴 접근 권한 |

로컬 파일 캐시 (gitignored):
- `backend/data/consensus/` — per-ticker 컨센서스 (Naver/yfinance, 로컬 파일 기반)
- `backend/data/calendar/` — 월별 캘린더 이벤트

## Gotchas

- **Supabase RLS**: 스키마 실행 후에도 RLS 활성화 상태일 수 있음 → SQL Editor에서 수동 `ALTER TABLE ... DISABLE ROW LEVEL SECURITY`
- **ES256 JWT**: 신규 Supabase는 HS256 아닌 ES256 → `auth.py`에서 `PyJWKClient`로 JWKS 검증
- `PUT /api/stocks/enrich/batch` must be registered **before** `PUT /api/stocks/{ticker}/enrich` in the router to avoid FastAPI routing `enrich` as a ticker value.
- Frontend CORS origins are hardcoded in `backend/main.py`: `localhost:3000` and `localhost:5173`. 배포 도메인(`portfoli-on.vercel.app`)도 추가되어 있음.
- `start.bat` runs both servers in hidden PowerShell windows; use `stop.bat` to kill them.
- `ANTHROPIC_API_KEY` must be set in the environment for report generation to work.
- Vite proxies `/api/*` to `http://localhost:8000` (로컬). 배포 환경에서는 `VITE_API_BASE_URL`로 Render 직접 호출.
- `backend/routers/calendar.py` uses file-based cache (`backend/data/calendar/YYYY-MM.json`). Cache is auto-cleared on stock add/remove/promote. To manually clear: use `DELETE /api/calendar/cache?month=YYYY-MM` or click ↺ in the UI. yfinance calls are parallelized (ThreadPoolExecutor, max 30).
- `backend/services/cache.py` — 인메모리 캐시 6종: snapshot (LRU 200), list (TTL 5s), dashboard (TTL 300s), correlation (TTL 300s), sector (TTL 300s), macro (TTL 300s). 종목 추가/수정/삭제 시 dashboard·correlation·sector·macro 캐시 자동 무효화. 수동 무효화: `DELETE /api/stocks/dashboard/cache`.
- `backend/routers/analytics.py` + `GET /api/analytics/correlation` — 보유 종목 간 90일 수익률 상관관계 계산. correlation 캐시에 저장, 종목 변경 시 자동 무효화.
- `backend/routers/digest.py` + `backend/services/digest_service.py` — 일일 다이제스트 생성/조회. 매일 08:00 KST 자동 생성 (`scheduler.py`).
- `backend/routers/market_indicators.py` + `backend/services/market_indicators_service.py` — 시장 지표: FX/VIX/원자재/국채 (yfinance incremental fetch + Supabase `market_cache` 영구 저장), 경제지표 (FRED API, `FRED_API_KEY` 필요), M7/KR Top2 earnings (주 1회 갱신), KR Exports (월 1회 갱신).
- `KITA_API_KEY` 환경변수는 실제로 **관세청(Korea Customs Service)** API 키임 (`apis.data.go.kr/1220000/Itemtrade`). 키 미설정 시 UN Comtrade 공개 API로 자동 폴백.
- `market_indicators_service.py` — `_mc_load`/`_mc_save`로 Supabase `market_cache` 읽기/쓰기. `_merge_history`/`_yf_close_history`로 yfinance incremental fetch (마지막 날짜 이후만 조회).
- `frontend/src/components/market/` 의 수익/수출 차트(`M7EarningsSection`, `KrTop2Section`, `KrExportsSection`)는 모두 dual Y-axis 구조: 좌측(`yAxisId="left"`) — 억/조 원 또는 십억달러, 우측(`yAxisId="right"`) — 비중 %. `krFmt` 헬퍼(`marketUtils.js`)는 억/조 단위 포매팅 (임계값: 10,000억 = 1조).
- **Admin 역할 설정**: `UPDATE users SET role = 'admin' WHERE email = '...'` (Docker postgres 직접). admin만 리포트 생성·Guru 크롤 가능.
- **user_menu_permissions**: 사용자별 메뉴 표시 제어. `PUT /api/admin/users/:id/permissions`로 관리. 프론트 `AuthContext`가 로그인 시 로드해 nav 필터링. 허용 메뉴 목록은 `admin.py`의 `ALL_MENUS`에 정의.
- `backend/routers/analysis.py` + `GET /api/analysis/sector` (섹터 모멘텀), `GET /api/analysis/macro-correlation` (보유 종목-매크로 상관관계). `analysis_service.py`에서 SECTOR_ETFs(XLK 등 11종), MACRO_TICKERS(TLT/UUP/USO/^VIX) 사용.

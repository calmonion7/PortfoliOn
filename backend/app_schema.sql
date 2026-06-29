-- backend/app_schema.sql
-- Application schema for Docker PostgreSQL
-- Depends on auth_schema.sql (users table must exist first)

-- 종목 마스터 (공유)
CREATE TABLE tickers (
  ticker              text PRIMARY KEY,
  name                text NOT NULL DEFAULT '',
  market              text NOT NULL DEFAULT 'US',
  exchange            text NOT NULL DEFAULT '',
  competitors         jsonb NOT NULL DEFAULT '[]',
  moat                text NOT NULL DEFAULT '',
  growth_plan         text NOT NULL DEFAULT '',
  risks               text NOT NULL DEFAULT '',
  recent_disclosures  text NOT NULL DEFAULT '',
  insights            text NOT NULL DEFAULT '',
  enriched_at         timestamptz,
  is_etf              boolean NOT NULL DEFAULT false
);

-- 스냅샷/리포트 (공유, 티커별)
CREATE TABLE snapshots (
  ticker  text REFERENCES tickers(ticker) ON DELETE CASCADE,
  date    date NOT NULL,
  data    jsonb NOT NULL,
  PRIMARY KEY (ticker, date)
);

-- 사용자 보유/관심종목
CREATE TABLE user_stocks (
  user_id   uuid REFERENCES users(id) ON DELETE CASCADE,
  ticker    text REFERENCES tickers(ticker) ON DELETE CASCADE,
  type      text NOT NULL CHECK (type IN ('holding', 'watchlist')),
  quantity  numeric,
  avg_cost  numeric,
  PRIMARY KEY (user_id, ticker)
);

-- 전역 리포트 스케줄 (단일 행)
CREATE TABLE schedules (
  id    integer PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  data  jsonb NOT NULL DEFAULT '{}'
);
INSERT INTO schedules (data)
VALUES ('{"enabled": false, "time": "08:00", "days": ["mon","tue","wed","thu","fri"]}');

-- Guru 운용역 데이터 (전역, 단일 행)
CREATE TABLE guru_managers (
  id    integer PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  data  jsonb NOT NULL DEFAULT '{}'
);
INSERT INTO guru_managers (data) VALUES ('{"last_updated": null, "managers": []}');

-- Guru 크롤 스케줄 (전역, 단일 행)
CREATE TABLE guru_schedules (
  id    integer PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  data  jsonb NOT NULL DEFAULT '{}'
);
INSERT INTO guru_schedules (data) VALUES ('{"enabled": false, "day": "sun", "time": "03:00"}');

-- 통합 배치 스케줄 (job_id별, 시드는 코드에서 idempotent)
CREATE TABLE IF NOT EXISTS batch_schedules (
  job_id  text PRIMARY KEY,
  data    jsonb NOT NULL
);

-- 일일 다이제스트 (사용자별)
CREATE TABLE digests (
  user_id  uuid REFERENCES users(id) ON DELETE CASCADE,
  date     date NOT NULL,
  data     jsonb NOT NULL,
  PRIMARY KEY (user_id, date)
);

-- 컨센서스 히스토리
CREATE TABLE consensus_history (
  ticker      text NOT NULL REFERENCES tickers(ticker) ON DELETE CASCADE,
  date        date NOT NULL,
  target_high numeric,
  target_mean numeric,
  target_low  numeric,
  buy         integer,
  hold        integer,
  sell        integer,
  PRIMARY KEY (ticker, date)
);

-- 캘린더 캐시 (사용자별, 월별)
CREATE TABLE calendar_cache (
  user_id  uuid REFERENCES users(id) ON DELETE CASCADE,
  month    text NOT NULL,
  events   jsonb NOT NULL DEFAULT '[]',
  PRIMARY KEY (user_id, month)
);

-- 시장지표 캐시 (전역)
CREATE TABLE market_cache (
  key        text PRIMARY KEY,
  data       jsonb NOT NULL,
  fetched_at timestamptz NOT NULL
);

-- 사용자별 메뉴 접근 권한
CREATE TABLE user_menu_permissions (
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    menu    TEXT NOT NULL,
    enabled BOOLEAN NOT NULL DEFAULT true,
    PRIMARY KEY (user_id, menu)
);

-- 신규 가입 사용자 기본 권한
CREATE TABLE default_menu_permissions (
    menu    TEXT PRIMARY KEY,
    enabled BOOLEAN NOT NULL DEFAULT false
);
INSERT INTO default_menu_permissions (menu, enabled) VALUES
  ('portfolio', false), ('research', false), ('market', false),
  ('guru', false), ('settings', false)
ON CONFLICT DO NOTHING;

-- 컨센서스 원본 리포트 (raw)
CREATE TABLE raw_reports (
  report_date    date          NOT NULL,
  ticker         text          NOT NULL REFERENCES tickers(ticker) ON DELETE CASCADE,
  brokerage_code varchar(100)  NOT NULL,
  target_price   numeric(12,2),
  raw_opinion    varchar(100),
  opinion_score  numeric(3,1)  NOT NULL DEFAULT 3.0,
  created_at     timestamptz   NOT NULL DEFAULT NOW(),
  PRIMARY KEY (report_date, ticker, brokerage_code)
);

-- 컨센서스 일별 집계 마트 (90일 롤링 윈도우)
CREATE TABLE daily_consensus_mart (
  base_date          date         NOT NULL,
  ticker             text         NOT NULL REFERENCES tickers(ticker) ON DELETE CASCADE,
  avg_target_price   numeric(12,2),
  avg_target_high    numeric(12,2),
  avg_target_low     numeric(12,2),
  avg_opinion_score  numeric(4,2),
  analyst_count      integer,
  buy_count          integer,
  hold_count         integer,
  sell_count         integer,
  updated_at         timestamptz  NOT NULL DEFAULT NOW(),
  PRIMARY KEY (base_date, ticker)
);

-- 사용자 행동 이벤트
CREATE TABLE user_events (
  id          bigserial PRIMARY KEY,
  user_id     uuid REFERENCES users(id) ON DELETE CASCADE,
  event_name  text NOT NULL,
  properties  jsonb NOT NULL DEFAULT '{}',
  created_at  timestamptz NOT NULL DEFAULT NOW()
);

-- 성능 인덱스
CREATE INDEX idx_user_stocks_ticker ON user_stocks(ticker);
CREATE INDEX idx_consensus_history_ticker ON consensus_history(ticker);
CREATE INDEX idx_raw_reports_ticker_date ON raw_reports (ticker, report_date DESC);
CREATE INDEX idx_mart_ticker_date ON daily_consensus_mart (ticker, base_date DESC);
CREATE INDEX idx_user_events_user_id    ON user_events(user_id);
CREATE INDEX idx_user_events_created_at ON user_events(created_at DESC);
CREATE INDEX idx_user_events_name       ON user_events(event_name);

-- 레버리지 지표 (신용잔고, 미수금, 고객예탁금)
CREATE TABLE market_leverage_indicators (
    base_date             DATE PRIMARY KEY,
    kospi_credit_balance  NUMERIC(20, 2),
    kosdaq_credit_balance NUMERIC(20, 2),
    kospi_market_cap      NUMERIC(20, 2),
    kosdaq_market_cap     NUMERIC(20, 2),
    total_misu_amt        NUMERIC(20, 2),
    liquidated_amt        NUMERIC(20, 2),
    liquidation_ratio     NUMERIC(5, 2),
    customer_deposit      NUMERIC(20, 2),
    created_at            TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_leverage_base_date ON market_leverage_indicators(base_date DESC);

CREATE TABLE IF NOT EXISTS market_lending_balance (
    base_date            DATE PRIMARY KEY,
    domestic_borrow_bal  BIGINT,
    foreign_borrow_bal   BIGINT,
    domestic_lend_bal    BIGINT,
    foreign_lend_bal     BIGINT,
    borrow_foreign_ratio NUMERIC(5, 2),
    lend_foreign_ratio   NUMERIC(5, 2),
    created_at           TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_lending_base_date ON market_lending_balance(base_date DESC);

CREATE TABLE IF NOT EXISTS backlog_history (
  ticker     TEXT NOT NULL,
  quarter    TEXT NOT NULL,
  amount     NUMERIC,
  unit       TEXT DEFAULT '억원',
  source     TEXT DEFAULT 'dart',
  raw_text   TEXT,
  segments   JSONB,                -- 사업부문>법인별 분해: [{sector, entity, amount(억원)}]
  fetched_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (ticker, quarter)
);

-- 거래대금/거래량 상위 랭킹 (KR/US, 10분 주기 스냅샷)
CREATE TABLE IF NOT EXISTS market_rankings (
    market         TEXT NOT NULL,            -- KR | US
    metric         TEXT NOT NULL,            -- value | volume
    rank           INT  NOT NULL,
    ticker         TEXT NOT NULL,
    name           TEXT,
    price          NUMERIC,
    change_pct     NUMERIC,
    trading_value  NUMERIC(20, 2),
    trading_volume NUMERIC(20, 0),
    market_cap     NUMERIC(20, 2),
    is_etf         BOOLEAN,
    exchange       TEXT,
    base_ts        TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (market, metric, rank)
);
CREATE INDEX IF NOT EXISTS idx_market_rankings_read ON market_rankings(market, metric, rank);

-- 투자자별 수급 (외국인/기관/개인 순매수 + 외국인 보유율, 일별 종목 단위, KR 전용)
CREATE TABLE IF NOT EXISTS market_investor_trend (
    ticker             TEXT NOT NULL,
    base_date          DATE NOT NULL,
    foreign_net        NUMERIC(20, 0),
    organ_net          NUMERIC(20, 0),
    individual_net     NUMERIC(20, 0),
    foreign_hold_ratio NUMERIC(6, 2),
    close_price        NUMERIC,
    created_at         TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (ticker, base_date)
);
CREATE INDEX IF NOT EXISTS idx_investor_trend_read ON market_investor_trend(ticker, base_date DESC);

-- 공매도 추이 (일별 공매도 거래량·거래대금·비중·잔량, 종목 단위, KR 전용 — 키움 ka10014)
CREATE TABLE IF NOT EXISTS market_short_sell (
    ticker        TEXT NOT NULL,
    base_date     DATE NOT NULL,
    short_volume  NUMERIC(20, 0),   -- 공매도 거래량(주) shrts_qty
    short_value   NUMERIC(20, 0),   -- 공매도 거래대금(원) = shrts_trde_prica(천원) × 1000
    short_ratio   NUMERIC(6, 2),    -- 공매도 비중(%) trde_wght
    short_balance NUMERIC(20, 0),   -- 공매도 잔량(주, 미상환 누적) ovr_shrts_qty
    close_price   NUMERIC,          -- 종가(원) close_pric
    created_at    TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (ticker, base_date)
);
CREATE INDEX IF NOT EXISTS idx_short_sell_read ON market_short_sell(ticker, base_date DESC);

-- 공시 피드 (보유·관심 KR 종목의 DART 원시 공시 목록, rcept_no 기준 dedup — KR 전용)
-- tickers.recent_disclosures(Cowork 애널리스트 코멘터리)와는 별도 store(.forge/CONTEXT '공시 피드').
CREATE TABLE IF NOT EXISTS stock_disclosures (
    rcept_no   TEXT PRIMARY KEY,             -- DART 접수번호(dedup 키)
    ticker     TEXT NOT NULL,
    rcept_dt   DATE,                          -- 접수일
    report_nm  TEXT,                          -- 보고서명
    pblntf_ty    TEXT,                         -- 공시 유형(A정기·B주요사항·C발행·D지분)
    corp_name    TEXT,
    meeting_date DATE,                          -- 주총 개최일 (주주총회 공시에서 추출)
    fetched_at   TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_disclosures_read ON stock_disclosures(ticker, rcept_dt DESC);

-- 배당 트래킹 (보유·관심 종목의 연 주당배당·배당수익률, ticker 단위 — US=yfinance/KR=DART)
-- income(연 예상배당·매수가 대비 수익률)은 대시보드가 보유의 quantity·avg_cost로 읽기 시 계산.
CREATE TABLE IF NOT EXISTS stock_dividends (
    ticker                    TEXT PRIMARY KEY,
    annual_dividend_per_share NUMERIC,        -- 연 주당배당(USD 또는 KRW)
    dividend_yield            NUMERIC,        -- 배당수익률(%)
    currency                  TEXT,           -- USD | KRW
    source                    TEXT,           -- yfinance | dart
    fetched_at                TIMESTAMPTZ DEFAULT NOW()
);

-- 수급 스코어 (per-종목 공매도+외인/기관 기반 우호/중립/경계 밴드, ticker 단위 — ADR-0014)
-- 사전계산 저장, 소비처(대시보드·리포트 상세)는 저장값만 읽음(요청경로 라이브 호출 0).
CREATE TABLE IF NOT EXISTS stock_supply_score (
    ticker         TEXT PRIMARY KEY,
    computed_date  DATE NOT NULL,                          -- 산출 기준일
    band           TEXT NOT NULL,                          -- favorable | neutral | caution
    flags          JSONB NOT NULL DEFAULT '[]'::jsonb,     -- 근거 플래그(한국어 문자열 리스트)
    as_of          JSONB,                                  -- 입력 데이터 기준일({short_sell, investor}, 결측은 null)
    created_at     TIMESTAMPTZ DEFAULT NOW()
);

-- 내부자·5% 지분공시 신호 (보유∪관심 KR 종목의 DART elestock/majorstock 보고 — KR 전용)
-- 한 rcept_no에 보고자 다중행이라 rcept_no 단독 PK 불가 → 결정적 행 해시 PK로 멱등.
CREATE TABLE IF NOT EXISTS stock_insider_trades (
    row_hash      TEXT PRIMARY KEY,                         -- md5(rcept_no|report_kind|repror|shares_change|shares_after|rate_after)
    ticker        TEXT NOT NULL,
    report_kind   TEXT NOT NULL,                            -- insider | major5
    rcept_no      TEXT NOT NULL,                            -- DART 접수번호
    rcept_dt      DATE,                                     -- 접수일
    repror        TEXT,                                     -- 보고자
    rel           TEXT,                                     -- 직위(insider) / 보고구분(major5)
    shares_change BIGINT,                                   -- 증감주식수 (+/−, 음수=순매도)
    shares_after  BIGINT,                                   -- 거래 후 보유 주식수
    rate_after    NUMERIC,                                  -- 거래 후 보유비율 %
    fetched_at    TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_insider_read ON stock_insider_trades(ticker, rcept_dt DESC);

-- 종목 추천 점수 (발굴 유니버스 멀티팩터 합성 점수 + 정량 플래그 — ADR-0015)
-- per-ticker 공유. recommendation_kr/us 배치가 시장 단위로 통째 교체, GET은 저장값만 읽음.
CREATE TABLE IF NOT EXISTS stock_recommendations (
    ticker      TEXT PRIMARY KEY,
    market      TEXT NOT NULL,                          -- KR | US
    score       NUMERIC NOT NULL,                       -- 0~100 합성 점수
    factors     JSONB NOT NULL DEFAULT '{}'::jsonb,     -- 점수 입력 팩터(value/momentum/smart_money)
    flags       JSONB NOT NULL DEFAULT '[]'::jsonb,     -- 정량 근거 플래그([{label, kind}])
    rank        INTEGER,                                -- 시장 내 점수 내림차순 순위(1-base)
    base_date   DATE NOT NULL,                          -- 산출 기준일
    low_liquidity BOOLEAN NOT NULL DEFAULT FALSE,        -- 저유동성(평균 거래대금 미달/미측정) — 발굴에서만 제외
    exchange    TEXT,                                   -- 거래소 코드(KR=KS|KQ, US='')
    updated_at  TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_recommendations_read ON stock_recommendations(market, score DESC);

-- 배치 실행로그 (job_id별 최근 20건만 보관)
-- 배포 주의: 이 파일은 빈 pgdata 최초 init 때만 자동 적용된다(docker-compose의 initdb 마운트).
--   기존 운영 DB는 pgdata가 이미 채워져 있으므로 git push 자동배포로는 아래 두 문장이 적용되지 않는다.
--   배포와 함께 라이브 DB에 수동 적용 필요(이전 additive 슬라이스와 동일):
--   psql -f app_schema.sql  또는 아래 CREATE TABLE/INDEX 두 문장만 직접 실행.
--   (테이블 부재 윈도우에도 job_runs.record()는 graceful degrade하여 배치 본문은 깨지지 않음)
CREATE TABLE IF NOT EXISTS job_runs (
    id          BIGSERIAL PRIMARY KEY,
    job_id      TEXT NOT NULL,                 -- daily_report | guru_crawl | ...
    trigger     TEXT NOT NULL,                 -- auto | manual
    status      TEXT NOT NULL,                 -- running | success | failed
    started_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    finished_at TIMESTAMPTZ,
    error       TEXT
);
CREATE INDEX IF NOT EXISTS idx_job_runs_read ON job_runs(job_id, started_at DESC);

-- US 공매도 비중 + 기관 보유 스냅샷 (보유·관심 US 종목, ticker 단위 — yfinance info + institutional_holders)
-- us_supply_fetch 배치(주 1회)가 채우고 GET /api/report/{ticker}/us-supply가 읽음.
CREATE TABLE IF NOT EXISTS us_supply_snapshot (
    ticker                TEXT PRIMARY KEY,
    short_pct_float       NUMERIC,               -- 유통주식 대비 공매도 비중 (e.g. 0.0098)
    short_ratio           NUMERIC,               -- 공매도 비율(days to cover)
    shares_short          BIGINT,                -- 공매도 잔량(주)
    date_short_interest   DATE,                  -- 공매도 잔량 기준일
    institutional_holders JSONB DEFAULT '[]'::jsonb, -- 상위 기관 [{holder, pct_held, shares, pct_change}]
    insider_transactions  JSONB DEFAULT '[]'::jsonb, -- 최근 내부자 거래 목록 (Form4)
    insider_net           JSONB DEFAULT '{}'::jsonb, -- 6개월 내부자 순매수 요약
    fetched_at            TIMESTAMPTZ DEFAULT NOW()
);

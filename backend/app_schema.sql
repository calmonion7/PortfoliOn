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
  enriched_at         timestamptz
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

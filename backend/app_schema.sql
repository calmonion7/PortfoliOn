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
  recent_disclosures  text NOT NULL DEFAULT ''
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
  target_mean numeric,
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

-- 성능 인덱스
CREATE INDEX idx_user_stocks_ticker ON user_stocks(ticker);
CREATE INDEX idx_consensus_history_ticker ON consensus_history(ticker);

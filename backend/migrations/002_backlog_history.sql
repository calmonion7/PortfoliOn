CREATE TABLE IF NOT EXISTS backlog_history (
  ticker    text NOT NULL,
  quarter   text NOT NULL,
  amount    numeric,
  unit      text DEFAULT '억원',
  source    text DEFAULT 'dart',
  raw_text  text,
  fetched_at timestamptz DEFAULT NOW(),
  PRIMARY KEY (ticker, quarter)
);

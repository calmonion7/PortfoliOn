"""DART 내부자·5% 지분공시 신호 — 보유∪관심 KR 종목의 소유상황보고 수집·저장·조회.

흐름(선례 services/disclosures.py와 동형):
1. backlog._get_corp_code_map() 재사용 → {stock_code: corp_code} 매핑
2. elestock.json(임원·주요주주 소유상황 → 'insider') + majorstock.json(5%룰 대량보유 → 'major5')
   각각 호출·파싱(다중 행, status 013 무데이터는 graceful 빈 리스트)
3. _num()으로 방어적 숫자 정규화(부호 보존, 파싱 실패 행 skip — wrong < missing)
4. 결정적 row_hash 생성 → stock_insider_trades에 ON CONFLICT(row_hash) 멱등 upsert

S3: compute_net_signal — 저장된 line item에서 SQL 집계로 순매수/순매도 방향 파생
(요청경로 라이브 DART 호출 0).

KR 전용·읽기전용·DART_API_KEY 필수.
"""
from __future__ import annotations

import hashlib
import logging
import os
from datetime import datetime, timedelta

import requests

from services.backlog import _get_corp_code_map
from services.db import execute, query

logger = logging.getLogger(__name__)

_DART_BASE = "https://opendart.fss.or.kr/api"
_DART_VIEWER = "https://dart.fss.or.kr/dsaf001/main.do?rcpNo={rcept_no}"

# S3 순매수 윈도(거래일이 아닌 달력일 기준 — rcept_dt 비교)
INSIDER_NET_WINDOW_DAYS = 90

# DART 보고 종류별 필드 매핑(공식 문서 기준).
#   endpoint     : DART API 경로
#   report_kind  : 저장 종류값
#   repror/rel/change/after/rate : 응답 필드명(서로 다른 스키마를 한 line item으로 정규화)
_REPORTS = (
    {
        "endpoint": "elestock.json",
        "report_kind": "insider",
        "repror": "repror",
        "rel": "isu_exctv_ofcps",          # 직위
        "change": "sp_stock_lmp_irds_cnt",  # 특정증권등 소유 증감수 (+/−)
        "after": "sp_stock_lmp_cnt",        # 특정증권등 소유수
        "rate": "sp_stock_lmp_rate",        # 소유비율 %
    },
    {
        "endpoint": "majorstock.json",
        "report_kind": "major5",
        "repror": "repror",
        "rel": "report_tp",                 # 보고구분
        "change": "stkqy_irds",             # 보유주식등 증감 (+/−)
        "after": "stkqy",                   # 보유주식등의 수
        "rate": "stkrt",                    # 보유비율 %
    },
)


def _dart_key() -> str:
    return os.environ.get("DART_API_KEY", "")


def _num(s, *, integer: bool = True):
    """DART 문자열("1,234" / "-500" / "-" / "") → int|float|None (부호 보존).

    쉼표·공백 제거 후 "" 또는 "-"는 None, 파싱 실패도 None(그 행 skip 신호).
    integer=True면 int(주식수), False면 float(비율)."""
    if s is None:
        return None
    cleaned = str(s).replace(",", "").strip()
    if cleaned in ("", "-"):
        return None
    try:
        return int(float(cleaned)) if integer else float(cleaned)
    except (TypeError, ValueError):
        return None


def _row_hash(rcept_no: str, report_kind: str, repror, shares_change, shares_after, rate_after) -> str:
    """결정적 행 해시 PK. 같은 보고의 같은 행은 항상 같은 해시(멱등 재적재)."""
    key = f"{rcept_no}|{report_kind}|{repror}|{shares_change}|{shares_after}|{rate_after}"
    return hashlib.md5(key.encode("utf-8")).hexdigest()


def _parse_items(items: list[dict], spec: dict) -> list[dict]:
    """한 보고 종류의 응답 항목들을 line item으로 정규화. 파싱 모호 행은 skip."""
    out: list[dict] = []
    for item in items:
        rcept_no = (item.get("rcept_no") or "").strip()
        if not rcept_no:
            continue
        shares_change = _num(item.get(spec["change"]))
        shares_after = _num(item.get(spec["after"]))
        rate_after = _num(item.get(spec["rate"]), integer=False)
        # 증감수가 파싱 불가면 신호로 무의미 → skip(기본값 폴백 금지: wrong < missing).
        if shares_change is None:
            continue
        repror = (item.get(spec["repror"]) or "").strip() or None
        rel = (item.get(spec["rel"]) or "").strip() or None
        out.append({
            "report_kind": spec["report_kind"],
            "rcept_no": rcept_no,
            "rcept_dt": (item.get("rcept_dt") or "").strip() or None,
            "repror": repror,
            "rel": rel,
            "shares_change": shares_change,
            "shares_after": shares_after,
            "rate_after": rate_after,
        })
    return out


def fetch_insider_trades(corp_code: str, days: int = 30) -> list[dict]:
    """corp_code의 최근 days일 내부자·5%지분 보고 line item 리스트. 실패는 빈 리스트(graceful).

    elestock.json + majorstock.json을 각각 호출해 정규화·결합한다.
    status != "000"(예: 013 무데이터)은 빈 결과로 graceful 처리."""
    bgn_de = (datetime.now() - timedelta(days=days)).strftime("%Y%m%d")
    end_de = datetime.now().strftime("%Y%m%d")
    out: list[dict] = []
    for spec in _REPORTS:
        try:
            resp = requests.get(
                f"{_DART_BASE}/{spec['endpoint']}",
                params={
                    "crtfc_key": _dart_key(),
                    "corp_code": corp_code,
                    "bgn_de": bgn_de,
                    "end_de": end_de,
                },
                timeout=15,
            )
            data = resp.json()
        except Exception as e:
            logger.warning(
                f"[Insider] {spec['endpoint']} 조회 실패 (corp={corp_code}): {e}")
            continue
        if data.get("status") != "000":
            continue
        out.extend(_parse_items(data.get("list", []), spec))
    return out


def upsert_insider_trades(ticker: str, rows: list[dict]) -> None:
    """line item을 stock_insider_trades에 row_hash 기준 멱등 upsert(재수집 시 중복 미증가)."""
    sql = """
        INSERT INTO stock_insider_trades
            (row_hash, ticker, report_kind, rcept_no, rcept_dt, repror, rel,
             shares_change, shares_after, rate_after, fetched_at)
        VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, NOW())
        ON CONFLICT (row_hash) DO UPDATE SET
            ticker        = EXCLUDED.ticker,
            report_kind   = EXCLUDED.report_kind,
            rcept_no      = EXCLUDED.rcept_no,
            rcept_dt      = EXCLUDED.rcept_dt,
            repror        = EXCLUDED.repror,
            rel           = EXCLUDED.rel,
            shares_change = EXCLUDED.shares_change,
            shares_after  = EXCLUDED.shares_after,
            rate_after    = EXCLUDED.rate_after,
            fetched_at    = NOW()
    """
    for row in rows:
        row_hash = _row_hash(
            row["rcept_no"], row["report_kind"], row.get("repror"),
            row.get("shares_change"), row.get("shares_after"), row.get("rate_after"),
        )
        execute(sql, (
            row_hash,
            ticker.upper(),
            row["report_kind"],
            row["rcept_no"],
            row.get("rcept_dt"),
            row.get("repror"),
            row.get("rel"),
            row.get("shares_change"),
            row.get("shares_after"),
            row.get("rate_after"),
        ))


def get_insider_trades(ticker: str, limit: int = 50) -> list[dict]:
    """종목의 저장된 내부자·5%지분 보고 line item(최신순 rcept_dt desc). dart_url 부여."""
    rows = query(
        "SELECT rcept_no, rcept_dt, report_kind, repror, rel, "
        "shares_change, shares_after, rate_after "
        "FROM stock_insider_trades WHERE ticker = %s "
        "ORDER BY rcept_dt DESC, rcept_no DESC LIMIT %s",
        (ticker.upper(), limit),
    )
    out = []
    for r in rows:
        d = dict(r)
        d["rcept_dt"] = str(d["rcept_dt"]) if d.get("rcept_dt") is not None else None
        d["dart_url"] = _DART_VIEWER.format(rcept_no=d["rcept_no"])
        out.append(d)
    return out


# corp_code 매핑은 backlog의 캐시를 재사용(중복 구현/다운로드 회피).
_get_corp_code_map = _get_corp_code_map


def _corp_code(ticker: str) -> "str | None":
    code = ticker.upper().replace(".KS", "").replace(".KQ", "")
    return _get_corp_code_map().get(code)


def fetch_and_save(ticker: str, days: int = 30) -> list[dict]:
    """한 종목의 내부자·5%지분 보고를 DART에서 수집해 저장 후 저장값 반환. corp_code 없으면 skip."""
    corp_code = _corp_code(ticker)
    if not corp_code:
        logger.info(f"[Insider] corp_code 없음: {ticker}")
        return get_insider_trades(ticker)
    rows = fetch_insider_trades(corp_code, days=days)
    if rows:
        upsert_insider_trades(ticker, rows)
    return get_insider_trades(ticker)


def fetch_all_insider_trades() -> dict:
    """user_stocks ∪ tickers의 KR 종목(보유+관심) 전체에 대해 직렬로 수집.

    계획서 S2의 "보유∩관심"은 한 종목이 둘 중 하나라 공허 → union으로 해석.
    US/비-KR은 쿼리에서 제외(graceful 스킵)."""
    tickers = [r["ticker"] for r in query(
        "SELECT DISTINCT us.ticker FROM user_stocks us "
        "JOIN tickers t ON us.ticker = t.ticker "
        "WHERE t.market = 'KR' AND us.type IN ('holding', 'watchlist')")]
    ok = 0
    failed = 0
    for t in tickers:
        try:
            fetch_and_save(t)
            ok += 1
        except Exception as e:
            failed += 1
            logger.warning(f"[Insider] fetch_all failed for {t}: {e}")
    logger.info(f"[Insider] fetch_all: {ok}/{len(tickers)} ok, {failed} failed")
    return {"total": len(tickers), "ok": ok, "failed": failed}


def compute_net_signal(ticker: str, window_days: int = INSIDER_NET_WINDOW_DAYS) -> dict:
    """저장 line item에서 윈도 내 순매수 방향을 SQL 집계(요청경로 라이브 DART 호출 0).

    net_shares = 윈도 내 shares_change 합, direction은 부호(>0 buy, <0 sell, ==0 neutral).
    저장 보고가 없으면 net 0·count 0·neutral."""
    rows = query(
        "SELECT COALESCE(SUM(shares_change), 0) AS net_shares, COUNT(*) AS cnt "
        "FROM stock_insider_trades "
        "WHERE ticker = %s AND rcept_dt >= (CURRENT_DATE - %s * INTERVAL '1 day')",
        (ticker.upper(), window_days),
    )
    row = rows[0] if rows else {"net_shares": 0, "cnt": 0}
    net_shares = int(row["net_shares"] or 0)
    count = int(row["cnt"] or 0)
    if net_shares > 0:
        direction = "buy"
    elif net_shares < 0:
        direction = "sell"
    else:
        direction = "neutral"
    return {
        "direction": direction,
        "net_shares": net_shares,
        "count": count,
        "window_days": window_days,
    }

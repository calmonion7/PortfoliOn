"""DART 공시 피드 — 보유·관심 KR 종목의 원시 공시 목록 수집·저장·조회.

[[공시 피드]](.forge/CONTEXT.md): DART list.json(corp_code별)로 핵심 유형 공시만 수집한
시계열. tickers.recent_disclosures(Cowork 애널리스트 코멘터리)와는 별도 store
(stock_disclosures 테이블). 이 모듈은 그 필드를 절대 건드리지 않는다.

흐름:
1. backlog._get_corp_code_map() 재사용 → corp_code 매핑
2. list.json을 핵심 유형(A·B·C·D) **각각** 호출(응답에 pblntf_ty가 없어 질의값으로 stamp)
3. 파싱 → {rcept_dt, report_nm, pblntf_ty, rcept_no, corp_name, dart_url}
4. stock_disclosures 테이블에 rcept_no dedup upsert

KR 전용·읽기전용·DART_API_KEY 필수. DART 에러/빈응답(status 013)은 graceful(빈 리스트).
"""
from __future__ import annotations

import logging
import os
from datetime import datetime, timedelta

import requests

from services.backlog import _get_corp_code_map
from services.db import execute, execute_many, query

logger = logging.getLogger(__name__)

_DART_BASE = "https://opendart.fss.or.kr/api"
_DART_VIEWER = "https://dart.fss.or.kr/dsaf001/main.do?rcpNo={rcept_no}"

# 핵심 유형만 수집(노이즈 E·F·I·J 제외): A정기 B주요사항 C발행 D지분.
# list.json 응답이 pblntf_ty를 echo하지 않으므로 유형별로 따로 호출해 질의값으로 stamp한다.
_CORE_TYPES = ("A", "B", "C", "D")


def _dart_key() -> str:
    return os.environ.get("DART_API_KEY", "")


def fetch_disclosures(corp_code: str, days: int = 30) -> list[dict]:
    """corp_code의 최근 days일 핵심유형 공시 목록. 실패/빈응답은 빈 리스트(graceful).

    유형별로 list.json을 호출하고 각 항목에 질의한 pblntf_ty를 stamp한다.
    반환: [{rcept_dt, report_nm, pblntf_ty, rcept_no, corp_name, dart_url}]
    """
    bgn_de = (datetime.now() - timedelta(days=days)).strftime("%Y%m%d")
    out: list[dict] = []
    for ty in _CORE_TYPES:
        try:
            resp = requests.get(
                f"{_DART_BASE}/list.json",
                params={
                    "crtfc_key": _dart_key(),
                    "corp_code": corp_code,
                    "pblntf_ty": ty,
                    "bgn_de": bgn_de,
                    "page_count": 100,
                },
                timeout=15,
            )
            data = resp.json()
        except Exception as e:
            logger.warning(f"[Disclosures] list.json 조회 실패 (corp={corp_code}, ty={ty}): {e}")
            continue
        # status 013 = 조회된 데이터 없음 (정상, 빈 결과). 000만 데이터 있음.
        if data.get("status") != "000":
            continue
        for item in data.get("list", []):
            rcept_no = (item.get("rcept_no") or "").strip()
            if not rcept_no:
                continue
            out.append({
                "rcept_dt": (item.get("rcept_dt") or "").strip(),
                "report_nm": (item.get("report_nm") or "").strip(),
                "pblntf_ty": ty,
                "rcept_no": rcept_no,
                "corp_name": (item.get("corp_name") or "").strip(),
                "dart_url": _DART_VIEWER.format(rcept_no=rcept_no),
            })
    return out


def upsert_disclosures(ticker: str, rows: list[dict]) -> None:
    """공시 목록을 stock_disclosures에 rcept_no 기준 멱등 upsert(재수집 시 중복 미증가)."""
    sql = """
        INSERT INTO stock_disclosures
            (ticker, rcept_no, rcept_dt, report_nm, pblntf_ty, corp_name, fetched_at)
        VALUES (%s, %s, %s, %s, %s, %s, NOW())
        ON CONFLICT (rcept_no) DO UPDATE SET
            ticker     = EXCLUDED.ticker,
            rcept_dt   = EXCLUDED.rcept_dt,
            report_nm  = EXCLUDED.report_nm,
            pblntf_ty  = EXCLUDED.pblntf_ty,
            corp_name  = EXCLUDED.corp_name,
            fetched_at = NOW()
    """
    params_list = [
        (
            ticker.upper(),
            row["rcept_no"],
            row.get("rcept_dt"),
            row.get("report_nm"),
            row.get("pblntf_ty"),
            row.get("corp_name"),
        )
        for row in rows
    ]
    execute_many(sql, params_list)


def get_disclosures_batch(tickers: list[str], limit_per_ticker: int = 20) -> list[dict]:
    """여러 종목의 저장된 공시를 단일 쿼리로 조회(rcept_dt 최신순). 뷰어 URL 부여.

    tickers가 비면 빈 리스트. per-ticker 상한은 Python에서 그룹핑 후 슬라이스."""
    if not tickers:
        return []
    upper = [t.upper() for t in tickers]
    rows = query(
        "SELECT ticker, rcept_no, rcept_dt, report_nm, pblntf_ty, corp_name "
        "FROM stock_disclosures WHERE ticker = ANY(%s) "
        "ORDER BY rcept_dt DESC, rcept_no DESC",
        (upper,),
    )
    # per-ticker 상한 적용 + dart_url 부여
    counts: dict[str, int] = {}
    out = []
    for r in rows:
        t = r["ticker"]
        if counts.get(t, 0) >= limit_per_ticker:
            continue
        counts[t] = counts.get(t, 0) + 1
        d = dict(r)
        d["rcept_dt"] = str(d["rcept_dt"]) if d.get("rcept_dt") is not None else None
        d["dart_url"] = _DART_VIEWER.format(rcept_no=d["rcept_no"])
        out.append(d)
    return out


def get_disclosures(ticker: str, limit: int = 20) -> list[dict]:
    """종목의 저장된 공시 목록(최신순 rcept_dt desc). 뷰어 URL을 매 행에 부여."""
    rows = query(
        "SELECT rcept_no, rcept_dt, report_nm, pblntf_ty, corp_name "
        "FROM stock_disclosures WHERE ticker = %s "
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
    """한 종목의 공시를 DART에서 수집해 저장 후 저장값 반환. corp_code 없으면 skip."""
    corp_code = _corp_code(ticker)
    if not corp_code:
        logger.info(f"[Disclosures] corp_code 없음: {ticker}")
        return get_disclosures(ticker)
    rows = fetch_disclosures(corp_code, days=days)
    if rows:
        upsert_disclosures(ticker, rows)
    return get_disclosures(ticker)


def fetch_all_disclosures() -> dict:
    """user_stocks ∩ tickers의 KR 종목(보유+관심) 전체에 대해 직렬로 공시 수집.

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
            logger.warning(f"[Disclosures] fetch_all failed for {t}: {e}")
    logger.info(f"[Disclosures] fetch_all: {ok}/{len(tickers)} ok, {failed} failed")
    return {"total": len(tickers), "ok": ok, "failed": failed}

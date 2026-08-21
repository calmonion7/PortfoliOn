"""`_MART_SQL` 집계가 raw_reports의 NaN을 마트로 전파하지 않는다 (적대 검토 F4).

`upsert_raw_reports`의 `math.isfinite` 초크포인트는 **이번 실행이 다시 INSERT하는 행**만
정규화한다(`run_daily`는 `days=7`). 그런데 `_MART_SQL`은 **90일 윈도우**를 AVG/MAX/MIN하고,
초크포인트는 2026-08-04(task#278) 도입이라 그 이전에 적재된 행이 지금도 윈도우 안에 있다.

라이브 실측(2026-08-22, 읽기전용 1콜):
  - `SELECT count(*) FROM raw_reports WHERE target_price='NaN'::numeric` → **0** (전체 9915행)
  - `daily_consensus_mart` NaN 행 → **0**
  → **현재 오염은 없다.** 이 파일은 관측된 파손의 복구가 아니라 잠재 가드다.

PostgreSQL 실측(같은 콜):
  - `AVG/MAX/MIN over {NaN,100,200}` → **(NaN, NaN, 100)** — AVG·MAX는 전파하고 MIN만
    무해하다(numeric NaN이 최대값으로 정렬되기 때문). 즉 「MIN은 괜찮으니 괜찮다」는
    추론은 성립하지 않고, 세 집계를 함께 감싸야 한다.
  - `AVG(NULLIF(v,'NaN'))` → **150** — 오염 행만 제외하고 정상 행으로 평균이 계산된다
    (행 전체를 버리지 않는다 — wrong < missing).

`backfill(force=True)`는 DELETE 후 윈도우 전 날짜를 재적재하므로, 오염이 한 번 들어오면
이 가드가 없는 한 증폭된다.
"""
import re

import services.consensus_pipeline as pipeline


def _target_price_agg_lines():
    """_MART_SQL에서 target_price를 집계하는 SELECT 줄만 뽑는다."""
    return [ln.strip() for ln in pipeline._MART_SQL.splitlines()
            if "target_price" in ln and re.search(r"ROUND\((AVG|MAX|MIN)\(", ln)]


def test_mart_aggregates_isolate_nan_target_price():
    """AVG·MAX·MIN이 모두 NaN을 격리한다 — 하나라도 raw면 마트 정본이 영구 오염된다."""
    lines = _target_price_agg_lines()
    fns = sorted(re.search(r"ROUND\((AVG|MAX|MIN)\(", ln).group(1) for ln in lines)
    assert fns == ["AVG", "MAX", "MIN"], f"target_price 집계 3종이 아니다: {lines}"
    for ln in lines:
        assert "NULLIF" in ln and "NaN" in ln, (
            f"{ln} — target_price가 NaN 격리 없이 집계된다. "
            f"PostgreSQL numeric은 NaN을 저장하고 AVG/MAX는 그것을 전파한다")


def test_mart_opinion_aggregate_untouched_control():
    """대조군 — opinion_score 집계는 손대지 않았다(처방이 필요 없는 곳으로 번지지 않았다)."""
    assert "ROUND(AVG(opinion_score),            2)" in pipeline._MART_SQL


def test_mart_sql_still_selects_all_columns_control():
    """대조군 — 컬럼 수·순서가 유지된다(SQL 편집이 열 매핑을 깨뜨리지 않았다)."""
    assert pipeline._MART_SQL.count("%s") == 5
    assert "COUNT(DISTINCT brokerage_code)" in pipeline._MART_SQL
    for col in ("avg_target_price", "avg_target_high", "avg_target_low",
                "avg_opinion_score", "analyst_count"):
        assert col in pipeline._MART_SQL

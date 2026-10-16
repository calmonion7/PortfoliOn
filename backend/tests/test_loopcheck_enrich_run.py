"""`scripts/loopcheck-enrich-run.py`(B1, task#390) — 회차 완료를 DB 데이터로 판정한다.

DB는 `query` 인자로 주입한 fake 로 대체한다(conftest `_block_real_db` 준수 — 실 DB 불접촉).
"""
import importlib.util
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest

SCRIPT = Path(__file__).resolve().parent.parent.parent / "scripts" / "loopcheck-enrich-run.py"
START = datetime(2026, 10, 16, 2, 0, tzinfo=timezone.utc)

pytestmark = pytest.mark.skipif(not SCRIPT.exists(), reason="스크립트 부재")


def _load():
    spec = importlib.util.spec_from_file_location("loopcheck_enrich_run", SCRIPT)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def _fake_query(tickers, enriched, started=START):
    def q(sql, params=None):
        if "FROM job_runs" in sql:
            return [{"id": 7, "started_at": started, "payload": {"tickers": tickers}}]
        return [{"ticker": t, "enriched_at": at} for t, at in enriched.items()]
    return q


def test_all_enriched_exits_0(capsys):
    q = _fake_query(["A", "B"], {"A": START + timedelta(minutes=5), "B": START + timedelta(hours=1)})
    assert _load().main([], query=q) == 0
    assert capsys.readouterr().out.startswith("2/2")


def test_partial_exits_1_and_lists_missing(capsys):
    q = _fake_query(["A", "B", "C"], {"A": START + timedelta(minutes=5), "B": None})  # C 는 행 자체가 없다
    assert _load().main([], query=q) == 1
    out = capsys.readouterr().out
    assert out.startswith("1/3")
    assert "B, C" in out


def test_enriched_before_started_at_counts_as_not_enriched(capsys):
    """거짓 통과 방지 — 어제 갱신된 종목은 이번 회차의 갱신이 아니다(경계: 정확히 started_at 은 갱신)."""
    q = _fake_query(["A", "B", "C"], {
        "A": START - timedelta(seconds=1),  # 직전 → 미갱신
        "B": START,                          # 경계 → 갱신
        "C": START + timedelta(seconds=1),
    })
    assert _load().main([], query=q) == 1
    out = capsys.readouterr().out
    assert out.startswith("2/3") and "미갱신 1종목: A" in out


def test_naive_enriched_at_is_not_silently_passed():
    """tz 정보가 없는 값은 비교 불가 — 갱신으로 통과시키지 않는다."""
    q = _fake_query(["A"], {"A": datetime(2026, 10, 17)})
    assert _load().main([], query=q) == 1


def test_db_failure_exits_2(capsys):
    def boom(*a, **k):
        raise RuntimeError("pool exhausted")
    assert _load().main([], query=boom) == 2
    assert "DB 조회 실패" in capsys.readouterr().err


def test_no_run_exits_2():
    assert _load().main([], query=lambda *a, **k: []) == 2

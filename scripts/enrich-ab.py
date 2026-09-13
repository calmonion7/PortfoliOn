#!/usr/bin/env python3
"""enrich A/B 하네스 — 같은 종목·같은 출발점에서 두 모델(또는 두 프롬프트 세대)의 산출물을 비교한다.

## 왜 이 하네스가 필요한가

`tickers`의 enrich 8필드는 UPDATE로 덮어써 **종목당 최신 1판만** 남았다. 그래서 야간 전량 갱신이
직전 판을 지우면 모델·프롬프트 세대를 대조할 방법이 없었다(task#345 계획 S1이 「런 전에 수동
스냅샷을 떠 두라」고 요구한 이유). 그 공백은 `enrich_history` 테이블로 메웠고 — 저장할 때마다
쓰기 직후 전체 판이 한 행으로 남는다 — 이 스크립트는 그 이력 위에서 A/B를 운전한다.
**덮어쓰기가 더 이상 파괴적이지 않으므로 A/B는 무엇도 잃지 않는다.**

## 왜 두 런 사이에 base를 복원하는가 (이게 없으면 A/B가 아니다)

루틴 프롬프트 §1 2단계는 `GET /api/report/{ticker}/{date}` 스냅샷을 읽는데, 그 스냅샷에는
**직전 enrich 7필드가 박제돼 있다**(`report_generator.py:455`). 그래서 A → B 순으로 그냥 돌리면
B가 A의 답을 보고 쓴다. 모델 비교가 아니라 「백지 작성 vs 남의 답 첨삭」 비교가 된다.
두 런 사이에 base를 되돌리면 양쪽이 똑같이 base를 본다 — 오염이 0은 아니지만 **대칭**이고,
A/B가 요구하는 것은 그것이다.

## 사용

    python3 scripts/enrich-ab.py seed    <ticker> [label]        # 현재 판을 이력에 base로 박제
    python3 scripts/enrich-ab.py list    <ticker>                # 이력 행 목록
    python3 scripts/enrich-ab.py fire    <ticker> <model> [label] # 발사 → 대기 → 새 이력에 라벨
    python3 scripts/enrich-ab.py restore <ticker> <id|label>     # 그 판으로 되돌리고 리포트 재생성
    python3 scripts/enrich-ab.py diff    <ticker> <A> <B>        # 두 판 나란히
    python3 scripts/enrich-ab.py ab      <ticker> [mA] [mB]      # 전 과정 (기본 sonnet·opus)
"""
from __future__ import annotations

import json
import subprocess
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime
from pathlib import Path

CONTAINER = "portfolion-postgres-1"
DB_USER = DB_NAME = "portfolion"
LISTENER = "http://127.0.0.1:8787/fire"
API_BASE = "http://127.0.0.1/api"

# 사업분석 탭 7필드 + insights(요약 탭). backend/services/storage/portfolio.py::_HISTORY_FIELDS와
# 같은 순서여야 이력 행끼리 키 순서가 맞는다.
FIELDS = [
    "moat", "growth_plan", "risks", "recent_disclosures",
    "insights", "key_resource", "competitor_edge", "market_outlook",
]
# 화면상 이름 — diff 출력에서 어느 섹션인지 바로 알 수 있게.
LABELS = {
    "market_outlook": "시장 전망 (구조 객체 — 구조 충실도 판정의 핵심)",
    "competitor_edge": "경쟁사 기술·경쟁력 비교",
    "moat": "경제적 해자",
    "key_resource": "핵심 자원",
    "growth_plan": "장기 성장 계획",
    "risks": "리스크",
    "recent_disclosures": "최근 공시 & 주가 영향",
    "insights": "권고 인사이트 (요약 탭)",
}

WAIT_TIMEOUT_SEC = 45 * 60   # 실측 15~19분의 2배 여유
POLL_SEC = 30


def _log(msg: str) -> None:
    print(f"[{datetime.now().strftime('%H:%M:%S')}] {msg}", flush=True)


def _psql(sql: str) -> str:
    r = subprocess.run(
        ["docker", "exec", "-i", CONTAINER, "psql", "-U", DB_USER, "-d", DB_NAME,
         "-t", "-A", "-v", "ON_ERROR_STOP=1", "-c", sql],
        capture_output=True, text=True,
    )
    if r.returncode != 0:
        raise RuntimeError(f"psql 실패: {r.stderr.strip()[:300]}")
    return r.stdout.strip()


def _psql_stdin(sql: str) -> None:
    """큰 본문용 — 인자 길이 제한을 피해 stdin으로 넘긴다."""
    r = subprocess.run(
        ["docker", "exec", "-i", CONTAINER, "psql", "-U", DB_USER, "-d", DB_NAME,
         "-v", "ON_ERROR_STOP=1"],
        input=sql, capture_output=True, text=True,
    )
    if r.returncode != 0:
        raise RuntimeError(f"psql 실패: {r.stderr.strip()[:300]}")


def _lit(v) -> str:
    """NULL 또는 달러 인용 문자열(본문과 충돌하지 않는 태그를 고른다)."""
    if v is None:
        return "NULL"
    s = v if isinstance(v, str) else json.dumps(v, ensure_ascii=False)
    tag = "ab"
    while f"${tag}$" in s:
        tag += "x"
    return f"${tag}${s}${tag}$"


def _env(key: str) -> str:
    p = Path(__file__).resolve().parent.parent / "backend" / ".env.docker"
    for line in p.read_text().splitlines():
        if line.strip().startswith(f"{key}="):
            return line.strip().split("=", 1)[1].strip().strip('"').strip("'")
    raise RuntimeError(f"{key}가 backend/.env.docker에 없다")


def _enriched_at(ticker: str) -> str:
    return _psql(f"SELECT COALESCE(enriched_at::text,'') FROM tickers WHERE ticker=upper({_lit(ticker)})")


def _resolve(ticker: str, ref: str) -> int:
    """id 숫자 또는 label 문자열을 이력 id로 해석(label이 여럿이면 최신)."""
    if ref.isdigit():
        return int(ref)
    got = _psql(
        f"SELECT id FROM enrich_history WHERE ticker=upper({_lit(ticker)}) "
        f"AND label={_lit(ref)} ORDER BY created_at DESC LIMIT 1"
    )
    if not got:
        raise RuntimeError(f"{ticker}: 라벨 '{ref}'인 이력 행이 없다")
    return int(got)


def _row(ticker: str, hid: int) -> dict:
    """이력 행 1개. **반드시 ticker로 한정한다** — id만으로 읽으면 다른 종목의 행을 조용히
    가져와 엉뚱한 두 종목을 비교하게 된다(실측: `diff 035420 1 2`의 2가 벌크 seed로 들어간
    타 종목 행이었고, 건드리지도 않은 필드가 달라 보였다). 틀린 비교는 없는 비교보다 나쁘다.
    """
    raw = _psql(
        "SELECT row_to_json(t) FROM (SELECT * FROM enrich_history "
        f"WHERE id={hid} AND ticker=upper({_lit(ticker)})) t"
    )
    if not raw:
        raise RuntimeError(f"{ticker.upper()}: 이력 id={hid} 없음 (다른 종목의 id일 수 있다 — `list`로 확인하라)")
    return json.loads(raw)


# ── 명령 ────────────────────────────────────────────────────────────────────

def seed(ticker: str, label: str = "base") -> int:
    """현재 tickers 상태를 이력 1행으로 박제한다.

    이력 테이블이 신설이라 **기존 판에는 이력 행이 없다** — A/B의 출발점을 만들려면 한 번 필요하다.
    이후의 판은 enrich 저장 경로가 자동으로 남기므로 다시 쓸 일이 없다.
    """
    cols = ", ".join(FIELDS)
    _psql_stdin(
        "INSERT INTO enrich_history (ticker, fields, changed, label) "
        f"SELECT ticker, row_to_json(t2)::jsonb, {_lit(['seed'])}::jsonb, {_lit(label)} "
        f"FROM tickers t1, LATERAL (SELECT {cols}) t2 WHERE t1.ticker=upper({_lit(ticker)});"
    )
    hid = int(_psql(f"SELECT id FROM enrich_history WHERE ticker=upper({_lit(ticker)}) ORDER BY id DESC LIMIT 1"))
    _log(f"seed {ticker} → 이력 id={hid} label={label}")
    return hid


def hlist(ticker: str) -> None:
    out = _psql(
        "SELECT id || ' | ' || to_char(created_at,'MM-DD HH24:MI') || ' | ' || "
        "rpad(COALESCE(label,'-'),10) || ' | ' || "
        "(SELECT sum(length(value::text)) FROM jsonb_each(fields)) || '자 | ' || changed::text "
        f"FROM enrich_history WHERE ticker=upper({_lit(ticker)}) ORDER BY id"
    )
    print(f"\n=== {ticker.upper()} enrich 이력 ===\nid | 시각 | 라벨 | 총 문자수 | 변경 필드")
    print(out or "(없음 — `seed`로 현재 판을 박제하라)")


def label_latest(ticker: str, label: str) -> int:
    hid = int(_psql(f"SELECT id FROM enrich_history WHERE ticker=upper({_lit(ticker)}) ORDER BY id DESC LIMIT 1"))
    _psql(f"UPDATE enrich_history SET label={_lit(label)} WHERE id={hid}")
    _log(f"라벨 부여 {ticker} id={hid} → '{label}'")
    return hid


def restore(ticker: str, ref: str) -> None:
    """그 이력 판으로 컬럼을 되돌리고 리포트를 재생성한다.

    재생성이 빠지면 복원이 무의미하다 — 루틴이 읽는 것은 컬럼이 아니라 **스냅샷**이다.
    enriched_at은 건드리지 않는다(이 하네스가 「완료」를 판정하는 신호라 되돌리면 다음 대기가 깨진다).
    """
    row = _row(ticker, _resolve(ticker, ref))
    f = row["fields"]
    sets = ", ".join(f"{k} = {_lit(f.get(k))}" for k in FIELDS)
    _psql_stdin(f"UPDATE tickers SET {sets} WHERE ticker = upper({_lit(ticker)});")
    _log(f"restore {ticker} ← 이력 id={row['id']} (label={row.get('label')})")
    _regenerate(ticker)


def _regenerate(ticker: str) -> None:
    req = urllib.request.Request(
        f"{API_BASE}/report/generate?tickers={ticker.upper()}",
        method="POST", headers={"X-API-Key": _env("COWORK_API_KEY"), "Content-Length": "0"},
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            _log(f"리포트 재생성 요청 {ticker}: HTTP {r.status}")
    except urllib.error.HTTPError as e:
        raise RuntimeError(f"리포트 재생성 실패 HTTP {e.code}: {e.read()[:200]!r}")
    _wait_snapshot(ticker)


def _wait_snapshot(ticker: str, timeout: int = 600) -> None:
    """최신 스냅샷의 moat가 현재 컬럼과 일치할 때까지 — 재생성은 202 비동기다."""
    deadline = time.time() + timeout
    want = _psql(f"SELECT COALESCE(md5(moat),'-') FROM tickers WHERE ticker=upper({_lit(ticker)})")
    while time.time() < deadline:
        got = _psql(
            "SELECT COALESCE(md5(data->>'moat'),'-') FROM snapshots "
            f"WHERE ticker=upper({_lit(ticker)}) ORDER BY date DESC LIMIT 1"
        )
        if got == want:
            _log(f"스냅샷 동기화 확인 {ticker}")
            return
        time.sleep(10)
    _log(f"⚠ {ticker}: 스냅샷이 {timeout}초 안에 컬럼과 일치하지 않았다 — 수동 확인 필요")


def fire(ticker: str, model: str, label: str = None) -> bool:
    """리스너에 단일 종목 전량 모드로 발사하고, 완료를 기다려 새 이력에 라벨을 단다."""
    before = _enriched_at(ticker)
    body = json.dumps({
        "text": "야간 전량 enrich 회차 — 트리거에 명시된 종목만 enrich·재생성하고 다른 정책은 수행하지 말라.",
        "tickers": [ticker.upper()], "model": model, "chunk": 1,
    }).encode()
    req = urllib.request.Request(
        LISTENER, data=body, method="POST",
        headers={"Authorization": f"Bearer {_env('COWORK_ROUTINE_FIRE_TOKEN')}",
                 "Content-Type": "application/json"},
    )
    with urllib.request.urlopen(req, timeout=30) as r:
        _log(f"fire {ticker} model={model}: HTTP {r.status} {r.read().decode()[:120]}")

    deadline = time.time() + WAIT_TIMEOUT_SEC
    _log(f"대기 시작 (before enriched_at={before or '없음'}) — 실측 15~19분")
    while time.time() < deadline:
        now = _enriched_at(ticker)
        if now and now != before:
            _log(f"완료 감지: enriched_at → {now}")
            label_latest(ticker, label or model)
            return True
        time.sleep(POLL_SEC)
    _log(f"⚠ 타임아웃 — {WAIT_TIMEOUT_SEC // 60}분 안에 enriched_at이 바뀌지 않았다")
    return False


def ab(ticker: str, model_a: str = "sonnet", model_b: str = "opus") -> None:
    base = _psql(
        f"SELECT id FROM enrich_history WHERE ticker=upper({_lit(ticker)}) "
        "AND label='base' ORDER BY id DESC LIMIT 1"
    )
    if not base:
        seed(ticker, "base")
    for model in (model_a, model_b):
        if not fire(ticker, model):
            _log(f"✗ {ticker}/{model} 미완료 — 중단(이력은 남아 있으므로 잃은 것은 없다)")
            return
        restore(ticker, "base")
    _log(f"✓ A/B 완료 — `diff {ticker} {model_a} {model_b}` · DB는 base로 복원됨")
    diff(ticker, model_a, model_b)


def diff(ticker: str, ref_a: str, ref_b: str) -> None:
    a, b = _row(ticker, _resolve(ticker, ref_a)), _row(ticker, _resolve(ticker, ref_b))
    na, nb = f"{ref_a}(#{a['id']})", f"{ref_b}(#{b['id']})"

    def size(v) -> int:
        return 0 if v is None else len(v if isinstance(v, str) else json.dumps(v, ensure_ascii=False))

    print(f"\n=== {ticker.upper()} A/B — 필드별 문자수 ===")
    w = max(len(na), len(nb), 12) + 2
    print("필드".ljust(24) + na.ljust(w) + nb)
    print("-" * (24 + w + len(nb)))
    for f in FIELDS:
        print(f.ljust(24) + str(size(a["fields"].get(f))).ljust(w) + str(size(b["fields"].get(f))))

    for f in FIELDS:
        print(f"\n\n{'=' * 74}\n## {f} — {LABELS[f]}\n{'=' * 74}")
        for nm, row in ((na, a), (nb, b)):
            v = row["fields"].get(f)
            print(f"\n--- [{nm}] ---")
            print(v or "(없음)" if isinstance(v, str) or v is None
                  else json.dumps(v, ensure_ascii=False, indent=2))


def main() -> int:
    if len(sys.argv) < 3:
        print(__doc__)
        return 64
    cmd, ticker, rest = sys.argv[1], sys.argv[2], sys.argv[3:]
    if cmd == "seed":
        seed(ticker, rest[0] if rest else "base")
    elif cmd == "list":
        hlist(ticker)
    elif cmd == "fire":
        if not rest:
            print("model이 필요하다: fire <ticker> <model> [label]")
            return 64
        fire(ticker, rest[0], rest[1] if len(rest) > 1 else None)
    elif cmd == "restore":
        restore(ticker, rest[0] if rest else "base")
    elif cmd == "diff":
        if len(rest) < 2:
            print("두 판이 필요하다: diff <ticker> <A> <B>")
            return 64
        diff(ticker, rest[0], rest[1])
    elif cmd == "ab":
        ab(ticker, *(rest[:2] or ["sonnet", "opus"]))
    else:
        print(f"알 수 없는 명령: {cmd}")
        return 64
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as e:  # noqa: BLE001 — CLI 최상단, 스택 대신 한 줄로
        print(f"✗ {e}", file=sys.stderr)
        sys.exit(1)

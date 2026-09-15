#!/usr/bin/env python3
"""발행 레인 A/B 하네스 (task#350) — opus · muse · H1(muse 초안 → opus 검수) 3팔 실측.

프로드에는 아무것도 쓰지 않는다. 그 보장은 「프롬프트로 부탁하고 나중에 카운트로 확인」이
아니라 **구조**다 — 서로 독립인 2겹:

  ① BASE URL 치환   : 루틴 프롬프트의 prod 주소를 로컬 프록시로 바꾼다.
                      치환이 **정확히 1건**이 아니면 발사하지 않는다(조용한 진행이 최악).
  ② 더미 키         : 자식 세션 env의 PORTFOLION_API_KEY는 가짜다. 진짜 키는 프록시만 쥔다
                      → 세션이 프롬프트를 무시하고 prod를 직접 때려도 401.

한 겹만 재면 나머지가 무력해도 초록이므로 둘을 **따로** 검증한다(`test_ab_publish.py`).

opus 팔은 **세션을 띄우지 않는다.** 현행 레인이 매일 만드는 산출물이 곧 기준선이라,
재실행보다 충실하고 opus 20세션이 통째로 빠진다. 대신 기준선의 **생성일**을 함께 싣고
muse 실행일과의 간격을 보고한다 — 간격을 감추면 그 사이의 주가·실적 변동이
「무료 모델이 틀렸다」로 잡힌다.

프로덕션 불간섭: 리스너(`cowork-fire-listener.py`)와 루틴 프롬프트 파일은 **읽기만** 한다.
세션은 리스너를 거치지 않고 여기서 직접 띄운다(`_runner_argv`만 재사용).
"""
import importlib.util
import json
import os
import subprocess
import time
from datetime import date, datetime
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
PROMPT_FILE = REPO / "scripts" / "cowork-routine-prompt.md"
ENV_FILE = REPO / "backend" / ".env.docker"
PROD_BASE = "https://portfolion.taebro.com"
SESSION_TIMEOUT = 2400  # 40분

# 레인 → 루틴 프롬프트의 절 번호. 트리거가 이것을 못박지 않으면 세션이 3절을 전부 돈다.
LANE_SECTION = {"enrich": 1, "analyst": 2, "tech": 3}
LANE_LABEL = {"enrich": "종목 리포트 사업분석(enrich)", "analyst": "심층(애널리스트 리포트)",
              "tech": "주요기술 리포트"}
# 레인 → 그 레인의 쓰기 경로 조각. 캡처가 여러 개일 때 **그 레인의 것**을 고르는 데 쓴다
# (루틴은 report/generate 같은 부수 쓰기도 하므로 첫 캡처를 집으면 엉뚱한 것을 산출로 삼는다).
LANE_PATH = {"enrich": "/enrich", "analyst": "/api/analyst-reports/", "tech": "/api/tech-reports/"}


def _load_proxy():
    spec = importlib.util.spec_from_file_location("ab_proxy", REPO / "scripts" / "ab-proxy.py")
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m


def _load_listener():
    """`_runner_argv`만 재사용한다 — 리스너 파일은 수정하지 않는다."""
    spec = importlib.util.spec_from_file_location("lst", REPO / "scripts" / "cowork-fire-listener.py")
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m


def env_value(key, path=None):
    for line in (path or ENV_FILE).read_text().splitlines():
        if line.startswith(f"{key}="):
            return line.split("=", 1)[1].strip()
    return ""


# ── 2겹 방어 ① : BASE URL 치환 ───────────────────────────────────────

def build_prompt(routine_text, proxy_url, lane, sample):
    """루틴 프롬프트의 BASE URL을 프록시로 바꾸고 트리거를 붙인다.

    치환이 정확히 1건이 아니면 **예외로 중단**한다. 0건이면 프롬프트가 prod를 가리킨 채
    발사되고, 2건 이상이면 부분 치환으로 일부가 prod에 남는다 — 둘 다 조용히 진행하면
    측정이 오염되거나 프로드가 오염된다.
    """
    marker = f"BASE URL: {PROD_BASE}"
    n = routine_text.count(marker)
    if n != 1:
        raise RuntimeError(
            f"BASE URL 치환 대상이 {n}건 — 정확히 1건이어야 발사한다. "
            f"루틴 프롬프트의 '{marker}' 줄이 바뀌었는지 확인할 것."
        )
    out = routine_text.replace(marker, f"BASE URL: {proxy_url}")
    section = LANE_SECTION[lane]
    out += (
        f"\n\n[트리거 지시]\n"
        f"{section}) {LANE_LABEL[lane]} **만** 수행하라. 다른 절은 건너뛴다.\n"
        f"대상은 오직 `{sample}` 하나다. 다른 종목·slug는 다루지 마라.\n"
        # 발행 게이트 우회 — 파일럿에서 드러난 구조적 충돌의 해소(task#350 S6).
        # 표본은 「기존 opus 판이 있는 것」으로 골랐는데(기준선이 있어야 비교가 된다) 루틴의
        # 7일 게이트는 바로 그 최신성 때문에 발행을 거부한다 → 20표본이 전부 빈손이 된다.
        # ⚠️ 여기서 「어차피 저장되지 않는다」고 알려주지 않는 것이 중요하다 — 알려주면 모델이
        # 덜 노력할 수 있어 재려던 품질 자체가 오염된다. 게이트 판정만 통과시킨다.
        f"발행 조건 판정(최신 발행일 경과·변화 유의성 등)은 **이미 통과한 것으로 간주**하라.\n"
        f"조건을 다시 따지지 말고 반드시 발행 요청까지 수행하라.\n"
    )
    return out


# ── 2겹 방어 ② : 더미 키 ─────────────────────────────────────────────

def child_env(real_key, base_env=None):
    """자식 세션의 환경 — 진짜 키를 **주지 않는다**.

    부모 환경 위에 얹는다(통째로 갈아끼우면 PATH가 사라져 실행기가 안 뜬다, task#349).
    """
    proxy = _load_proxy()
    dummy = proxy.make_dummy_key()
    if dummy == real_key:  # 이론상 불가하지만 같으면 두 번째 겹이 통째로 사라진다
        raise RuntimeError("더미 키가 진짜 키와 같다")
    env = dict(base_env if base_env is not None else os.environ)
    env["PORTFOLION_API_KEY"] = dummy
    return env


# ── opus 팔: 세션 0개 수확 ───────────────────────────────────────────
# 발행 본문에 실리는 필드만 — DB 행의 부수 컬럼(id·ticker·created_at·스냅샷 data)은 비교 대상이 아니다.
PUBLISHABLE_FIELDS = {
    "analyst": {"rating", "title", "fair_value_low", "fair_value_high",
                "valuation_method", "points", "risks"},
    "tech": {"title", "description", "difficulty", "players", "challenges", "related",
             "market", "sources", "key_points", "milestones", "variants", "watch_items",
             "composition"},
    "enrich": {"moat", "risks", "key_resource", "competitor_edge", "market_outlook",
               "insights", "recent_disclosures", "summary", "thesis"},
}

def normalize_opus(row, lane):
    """기존 산출물을 팔 산출 형태로 정규화한다. **세션을 띄우지 않는다.**"""
    created = row.get("created_at") or row.get("published_date") or ""
    if isinstance(created, (datetime, date)):
        created = created.isoformat()
    body = row.get("fields") or row.get("body") or row
    # DB 행에는 발행 본문에 없는 것들이 붙어 있다(id·ticker·created_at, 특히 스냅샷 `data`
    # 블롭). 그대로 두면 「분량」 축이 DB 행 vs 요청 본문을 비교해 opus가 4배 길어 보인다
    # — 같은 것을 재지 않는 축은 비교가 아니다. 발행 스키마 필드로 좁힌다.
    if isinstance(body, dict):
        body = {k: v for k, v in body.items() if k in PUBLISHABLE_FIELDS[lane]}
    return {
        "arm": "opus",
        "lane": lane,
        "fired": False,          # 비용 0 — 이 값이 True가 되면 설계 위반이다
        "baseline_date": str(created),
        "body": body,
    }


def skew_days(baseline_date, run_date):
    """기준선과 실행일의 간격(일). 이 값을 감추면 시점 차이가 품질 차이로 오독된다."""
    def _d(x):
        return datetime.fromisoformat(str(x)[:10]).date()
    return (_d(run_date) - _d(baseline_date)).days


# ── 자동 축 ──────────────────────────────────────────────────────────

def numeric_match(opus_vals, other_vals, mapping):
    """수치 일치율 — **커버리지 카운터와 함께**만 의미가 있다.

    매핑 가능한 필드가 0이면 「일치율 100%」가 공허하게 통과한다. 그래서 대조 가능 수가
    0이면 비율을 내지 않고 「대조 불가」로 보고한다(표본 0을 통과로 위장 금지).
    """
    comparable = matched = 0
    for a, b in mapping.items():
        if a in opus_vals and b in other_vals:
            comparable += 1
            try:
                if abs(float(opus_vals[a]) - float(other_vals[b])) < 1e-9:
                    matched += 1
            except (TypeError, ValueError):
                pass
    if comparable == 0:
        return {"comparable": 0, "matched": 0, "ratio": None, "verdict": "대조 불가"}
    return {"comparable": comparable, "matched": matched,
            "ratio": matched / comparable, "verdict": "대조"}


def pick_capture(captures, lane, sample):
    """그 레인의 캡처를 고른다. 없으면 None — 빈 산출을 성공으로 위장하지 않는다."""
    frag = LANE_PATH[lane]
    for c in captures:
        if frag in c.get("path", "") and (lane == "enrich" or sample in c.get("path", "")):
            return c
    return None


# ── 세션 실행 ────────────────────────────────────────────────────────

def fire(lane, sample, arm, model, outdir, real_key, prompt_override=None):
    """한 팔을 실행한다. 프록시를 띄우고 세션을 스폰해 캡처를 수확한다."""
    import threading

    proxy = _load_proxy()
    listener = _load_listener()
    outdir = Path(outdir)
    outdir.mkdir(parents=True, exist_ok=True)
    ctx = proxy.Context(PROD_BASE, real_key, outdir / "capture", outdir / "proxy.log")
    srv, port = proxy.serve(ctx)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    try:
        text = prompt_override if prompt_override is not None else PROMPT_FILE.read_text()
        prompt = build_prompt(text, f"http://127.0.0.1:{port}", lane, sample)
        log = os.fdopen(os.open(outdir / "run.log", os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600), "w")
        t0 = time.time()
        proc = subprocess.Popen(
            listener._runner_argv(model), cwd=outdir, stdout=log, stderr=subprocess.STDOUT,
            stdin=subprocess.PIPE, start_new_session=True, env=child_env(real_key),
        )
        proc.stdin.write(prompt.encode())
        proc.stdin.close()
        try:
            rc = proc.wait(timeout=SESSION_TIMEOUT)
        except subprocess.TimeoutExpired:
            proc.kill()
            rc = None
        elapsed = time.time() - t0
    finally:
        srv.shutdown()

    caps = []
    for f in sorted((outdir / "capture").glob("*.json")) if (outdir / "capture").exists() else []:
        caps.append(json.loads(f.read_text()))
    picked = pick_capture(caps, lane, sample)
    result = {"arm": arm, "lane": lane, "sample": sample, "model": model, "fired": True,
              "rc": rc, "elapsed_sec": round(elapsed, 1), "captures": len(caps)}
    if picked is None:
        result["error"] = "캡처 없음 — 세션이 발행하지 않았거나 실패했다(둘을 구별하려면 run.log 확인)"
        (outdir.parent / f"{arm}.error.json").write_text(
            json.dumps(result, ensure_ascii=False, indent=2))
    else:
        result["body"] = picked["body"]
        (outdir.parent / f"{arm}.json").write_text(
            json.dumps(result, ensure_ascii=False, indent=2))
    return result


# ── S3: opus 팔 수확기 (세션 0개) ────────────────────────────────────
# 표본 20건 — 그릴링 확정(2026-09-15). enrich는 섹터별 1종목, 발행 표본과 겹치지 않게 골랐다.
SAMPLES = {
    "enrich": ["000660", "RKLB", "JPM", "NVO", "CCJ", "TSLA", "035420", "COST", "CEG", "EQIX", "FCX"],
    "analyst": ["GOOGL", "005380", "CRCL", "LLY", "SPCX", "005930"],
    "tech": ["ai-datacenter-equipment", "obesity-drugs", "smr"],
}
# enrich의 opus 기준선 = 이 라벨. 현재 `tickers` 판은 이미 muse이므로 그것을 쓰면
# 비교 대상 자신을 기준선으로 삼게 된다(muse 전환 커밋 8a2ef6b = 2026-09-15 03:51 UTC).
OPUS_ENRICH_LABEL = "nightly-0914"
PSQL = ["docker", "exec", "portfolion-postgres-1", "psql", "-U", "portfolion", "-d", "portfolion", "-tAc"]


def _psql_json(sql):
    out = subprocess.run(PSQL + [sql], capture_output=True, text=True, timeout=60)
    if out.returncode != 0:
        raise RuntimeError(f"psql 실패: {out.stderr.strip()}")
    s = out.stdout.strip()
    return json.loads(s) if s else None


def harvest_opus(lane, sample):
    """기존 산출물을 opus 판으로 수확한다. **세션을 띄우지 않으므로 비용 0.**"""
    if lane == "enrich":
        row = _psql_json(
            "select row_to_json(x) from (select fields, created_at from enrich_history "
            f"where ticker='{sample}' and label='{OPUS_ENRICH_LABEL}' "
            "order by created_at desc limit 1) x")
    elif lane == "analyst":
        row = _psql_json(
            "select row_to_json(x) from (select to_jsonb(a)-'id' as body, published_date "
            f"from analyst_reports a where ticker='{sample}' "
            "order by published_date desc limit 1) x")
    else:
        row = _psql_json(
            "select row_to_json(x) from (select to_jsonb(t)-'id' as body, published_date "
            f"from tech_reports t where slug='{sample}' limit 1) x")
    if row is None:
        return {"arm": "opus", "lane": lane, "sample": sample, "fired": False,
                "error": "기존 opus 산출물 없음 — 기준선 부재(측정 불가, 발사로 대체하지 말 것)"}
    out = normalize_opus(row, lane)
    out["sample"] = sample
    return out


# ── S4: H1 검수 팔 ───────────────────────────────────────────────────
REVIEW_FILE = REPO / "scripts" / "review-prompt.md"
DRAFT_MARKER = "{{DRAFT_JSON}}"


def build_review_prompt(draft, review_text=None, proxy_url=None):
    """muse 초안을 검수 프롬프트에 싣는다.

    초안 삽입이 실패하면 검수 세션은 **아무것도 없는 상태로** 검수를 시작해 새로 쓰게 된다 —
    그러면 이 팔이 재려던 「검수가 초안을 얼마나 개선하는가」가 「opus가 새로 쓰면 어떤가」로
    바뀌어 측정이 조용히 다른 것을 잰다. 그래서 마커 1건을 강제한다.
    """
    text = review_text if review_text is not None else REVIEW_FILE.read_text()
    n = text.count(DRAFT_MARKER)
    if n != 1:
        raise RuntimeError(f"초안 삽입 마커가 {n}건 — 정확히 1건이어야 한다")
    body = json.dumps(draft, ensure_ascii=False, indent=2)
    out = text.replace(DRAFT_MARKER, body)
    if proxy_url:
        out += f"\n\nBASE URL: {proxy_url}\n"
    return out


def fire_h1(lane, sample, outdir, real_key, draft_path, model="opus"):
    """H1 = muse 초안을 opus가 검수한다. **muse를 다시 쏘지 않는다**(초안 재사용).

    초안이 없으면 검수할 것이 없으므로 발사하지 않는다 — 빈손 검수를 띄우면 그 세션은
    사실상 새로 쓰게 되고, 이 팔은 「검수의 개선폭」이 아니라 「opus 신규 작성」을 재게 된다.
    """
    import threading

    draft_path = Path(draft_path)
    if not draft_path.exists():
        return {"arm": "h1", "lane": lane, "sample": sample, "fired": False,
                "error": "muse 초안 없음 — 검수할 대상이 없어 발사하지 않는다"}
    draft = json.loads(draft_path.read_text()).get("body")
    if not draft:
        return {"arm": "h1", "lane": lane, "sample": sample, "fired": False,
                "error": "muse 초안 본문이 비어 있다"}

    proxy = _load_proxy()
    listener = _load_listener()
    outdir = Path(outdir); outdir.mkdir(parents=True, exist_ok=True)
    ctx = proxy.Context(PROD_BASE, real_key, outdir / "capture", outdir / "proxy.log")
    srv, port = proxy.serve(ctx)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    try:
        prompt = build_review_prompt(draft, proxy_url=f"http://127.0.0.1:{port}")
        log = os.fdopen(os.open(outdir / "run.log", os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600), "w")
        t0 = time.time()
        proc = subprocess.Popen(
            listener._runner_argv(model), cwd=outdir, stdout=log, stderr=subprocess.STDOUT,
            stdin=subprocess.PIPE, start_new_session=True, env=child_env(real_key),
        )
        proc.stdin.write(prompt.encode()); proc.stdin.close()
        try:
            rc = proc.wait(timeout=SESSION_TIMEOUT)
        except subprocess.TimeoutExpired:
            proc.kill(); rc = None
        elapsed = time.time() - t0
    finally:
        srv.shutdown()

    result = {"arm": "h1", "lane": lane, "sample": sample, "model": model, "fired": True,
              "rc": rc, "elapsed_sec": round(elapsed, 1)}
    # 검수 세션은 발행하지 않고 파일로 출력한다 → 캡처가 아니라 작업 디렉터리에서 찾는다.
    final = None
    for name in ("final.json", "out.json", "result.json"):
        f = outdir / name
        if f.exists():
            try:
                final = json.loads(f.read_text()); break
            except Exception:
                pass
    changes = None
    cf = outdir / "changes.json"
    if cf.exists():
        try:
            changes = json.loads(cf.read_text())
        except Exception:
            pass
    if final is None:
        result["error"] = "검수 최종 JSON 없음(final.json) — run.log 확인"
        (outdir.parent / "h1.error.json").write_text(json.dumps(result, ensure_ascii=False, indent=2))
    else:
        result["body"] = final
        result["changes"] = changes or []
        result["changes_count"] = len(changes or [])
        (outdir.parent / "h1.json").write_text(json.dumps(result, ensure_ascii=False, indent=2))
        (outdir.parent / "h1.changes.json").write_text(
            json.dumps(changes or [], ensure_ascii=False, indent=2))
    return result

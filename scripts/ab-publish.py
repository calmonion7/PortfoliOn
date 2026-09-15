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

def normalize_opus(row, lane):
    """기존 산출물을 팔 산출 형태로 정규화한다. **세션을 띄우지 않는다.**"""
    created = row.get("created_at") or row.get("published_date") or ""
    if isinstance(created, (datetime, date)):
        created = created.isoformat()
    return {
        "arm": "opus",
        "lane": lane,
        "fired": False,          # 비용 0 — 이 값이 True가 되면 설계 위반이다
        "baseline_date": str(created),
        "body": row.get("fields") or row.get("body") or row,
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

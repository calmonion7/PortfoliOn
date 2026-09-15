#!/usr/bin/env python3
"""S7 마무리 — 본 실행 종료를 기다렸다가 실패 표본 재실행 + 산출물 재생성 (task#350).

폴링으로 사람(에이전트)의 주의를 태우는 대신 기계가 이어서 끝낸다.
재실행 대상은 `*.error.json`이 남은 표본이다 — 「발행하지 않음」과 「실패」를 구별해
기록해 뒀기 때문에 무엇을 다시 돌려야 하는지가 파일로 판정된다.
"""
import importlib.util
import json
import subprocess
import time
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent


def _load(n, p):
    s = importlib.util.spec_from_file_location(n, p)
    m = importlib.util.module_from_spec(s)
    s.loader.exec_module(m)
    return m


def log(m):
    print(f"[{time.strftime('%H:%M:%S')}] {m}", flush=True)


def main():
    while subprocess.run(["pgrep", "-f", "[a]b-run-all"], capture_output=True).returncode == 0:
        time.sleep(30)
    log("본 실행 종료 감지 — 마무리 시작")

    M = _load("ab", REPO / "scripts" / "ab-publish.py")
    C = _load("abc", REPO / "scripts" / "ab-compare.py")
    S = _load("abs", REPO / "scripts" / "ab-summary.py")
    REAL = M.env_value("COWORK_API_KEY")
    MUSE = "opencode/muse-spark-1.3-contributor-free"

    # 1) 실패 표본 재실행 (JPM 등 — 배포로 prod가 502였던 것들)
    for lane, samples in M.SAMPLES.items():
        for s in samples:
            d = Path("out") / lane / s
            if (d / "muse.json").exists():
                continue
            if not (d / "muse.error.json").exists():
                continue
            log(f"재실행 {lane}/{s} muse")
            try:
                import shutil
                shutil.rmtree(d / "muse", ignore_errors=True)
                r = M.fire(lane, s, "muse", MUSE, d / "muse", REAL)
                log(f"  muse {'ERR ' + r['error'][:40] if r.get('error') else 'OK'}")
                if not r.get("error"):
                    (d / "muse.error.json").unlink(missing_ok=True)
                    r2 = M.fire_h1(lane, s, d / "h1", REAL, d / "muse.json")
                    log(f"  h1 {'ERR ' + r2['error'][:40] if r2.get('error') else 'changes=' + str(r2.get('changes_count'))}")
                    if not r2.get("error"):
                        (d / "h1.error.json").unlink(missing_ok=True)
            except Exception as e:
                log(f"  예외: {e}")

    # 2) compare.md 20건 일괄 재생성 (생성기가 런 도중 고쳐졌으므로 전부 다시)
    ok = 0
    for lane, samples in M.SAMPLES.items():
        for s in samples:
            try:
                C.build(lane, s)
                ok += 1
            except Exception as e:
                log(f"compare 실패 {lane}/{s}: {e}")
    log(f"compare.md {ok}건 생성")

    # 3) summary.md
    try:
        p = S.build("103|15|516|2026-09-15 11:58:08.638118+00")
        log(f"summary: {p}")
    except Exception as e:
        log(f"summary 실패: {e}")
    log("마무리 종료")


if __name__ == "__main__":
    main()

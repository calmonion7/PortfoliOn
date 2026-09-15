#!/usr/bin/env python3
"""S7 본 실행 — 남은 표본을 순차로 돌린다 (task#350).

순차인 이유: opus 동시 세션은 주간 한도 위험이 있고, 실패해도 다음으로 넘어가야 한다.
실패는 버리지 않고 `*.error.json`으로 남긴다 — 「발행하지 않음」과 「실패」를 섞으면
어느 팔이 왜 비었는지 사후에 판정할 수 없다.
"""
import importlib.util
import json
import sys
import time
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent


def _load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m


m = _load("ab", REPO / "scripts" / "ab-publish.py")
cmp_mod = _load("abc", REPO / "scripts" / "ab-compare.py")
REAL = m.env_value("COWORK_API_KEY")
MUSE = "opencode/muse-spark-1.3-contributor-free"
SKIP = {("analyst", "GOOGL")}  # 파일럿에서 완료


def log(msg):
    print(f"[{time.strftime('%H:%M:%S')}] {msg}", flush=True)


def main():
    todo = [(l, s) for l, ss in m.SAMPLES.items() for s in ss if (l, s) not in SKIP]
    log(f"본 실행 시작 — {len(todo)}표본 × 2팔(muse + h1 검수)")
    for i, (lane, sample) in enumerate(todo, 1):
        d = Path("out") / lane / sample
        log(f"({i}/{len(todo)}) {lane}/{sample} muse 발사")
        try:
            r = m.fire(lane, sample, "muse", MUSE, d / "muse", REAL)
            log(f"    muse rc={r.get('rc')} {r.get('elapsed_sec')}s "
                f"{'ERR: ' + r['error'][:40] if r.get('error') else 'OK'}")
        except Exception as e:
            log(f"    muse 예외: {e}")
            (d).mkdir(parents=True, exist_ok=True)
            (d / "muse.error.json").write_text(json.dumps(
                {"arm": "muse", "lane": lane, "sample": sample, "error": f"예외: {e}"},
                ensure_ascii=False, indent=2))
        log(f"    {lane}/{sample} h1 검수 발사")
        try:
            r2 = m.fire_h1(lane, sample, d / "h1", REAL, d / "muse.json")
            log(f"    h1 rc={r2.get('rc')} {r2.get('elapsed_sec')}s "
                f"changes={r2.get('changes_count')} "
                f"{'ERR: ' + r2['error'][:40] if r2.get('error') else 'OK'}")
        except Exception as e:
            log(f"    h1 예외: {e}")
        try:
            cmp_mod.build(lane, sample)
        except Exception as e:
            log(f"    compare 실패: {e}")
    log("본 실행 종료")


if __name__ == "__main__":
    sys.exit(main())

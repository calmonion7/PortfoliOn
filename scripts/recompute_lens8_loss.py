"""정정 전에 박제된 적자 렌즈 8 판을 소급 재계산한다(task#405 — 발행물 불변의 좁은 예외).

백엔드 컨테이너 **안에서** 돈다. 기본은 dry-run(바뀔 판만 출력), `--apply`일 때만 쓴다:
    docker exec -i portfolion-dev-backend-1 python - < scripts/recompute_lens8_loss.py           # dry-run
    docker exec -i portfolion-dev-backend-1 python - --apply < scripts/recompute_lens8_loss.py   # 적용

- 판정·재계산은 서버 함수 `analyst_lenses.recompute_loss_lens8` 하나다(렌즈 8과 tally만 바뀐다).
- 쓰기는 `lens_report`만 UPDATE한다 — `data`·`created_at`은 그대로(`save_lens_report` upsert는
  `created_at = NOW()`로 덮으니 쓰지 않는다).
"""
import json
import sys

from services.analyst_lenses import recompute_loss_lens8
from services.db import execute, query


def main(args):
    apply = "--apply" in args
    rows = query("SELECT ticker, published_date, lens_report FROM analyst_reports "
                 "WHERE lens_report IS NOT NULL ORDER BY ticker, published_date")
    changed = 0
    for r in rows:
        new, ch = recompute_loss_lens8(r["lens_report"])
        if not ch:
            continue
        changed += 1
        old8 = next(l for l in r["lens_report"]["lenses"] if l["id"] == 8)
        new8 = next(l for l in new["lenses"] if l["id"] == 8)
        print(f"{r['ticker']} {r['published_date']}  렌즈8 {old8['signal']} → {new8['signal']}  "
              f"tally {r['lens_report']['tally']} → {new['tally']}")
        if apply:
            execute("UPDATE analyst_reports SET lens_report = %s WHERE ticker = %s AND published_date = %s",
                    (json.dumps(new, ensure_ascii=False), r["ticker"], r["published_date"]))
    print(f"{'적용' if apply else 'dry-run'} — 대상 {len(rows)}판 중 바뀔 판 {changed}건")


if __name__ == "__main__":
    main(sys.argv[1:])

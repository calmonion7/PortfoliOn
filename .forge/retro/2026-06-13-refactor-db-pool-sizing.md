# 2026-06-13 — DB 커넥션 풀 maxconn 10→20 (PoolError 잠재버그 제거) (task 29)

## Plan vs actual
- What went as planned: `services/db.py` `_get_pool()` maxconn 10→20 한 줄 변경. backend 466 passed, 라이브 `/api/analysis/sector`(11워커) 3건 동시 호출 전부 HTTP 200(최대 ~33 동시 워커, 새 풀에서 PoolError 없음).
- Divergences: 없음 (계획과 동일).

## Learnings
- Do differently next time: 새로 접을 것 없음. 교훈(psycopg2 풀은 소진 시 블록이 아니라 `PoolError`를 던지므로 maxconn ≥ 최대 ThreadPool 워커로 유지)은 이미 CONCERNS 맵 §4.2 + 메모리 `project-investor-flow`("배치 ThreadPool ≤ DB풀")에 기록돼 있다.

## Doc updates
- CONTEXT.md promotion: none
- ADR added: none

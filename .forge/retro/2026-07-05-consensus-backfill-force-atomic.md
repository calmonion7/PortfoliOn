# 2026-07-05 — 버그 #28 consensus backfill force 경로 원자화 (task#148)

버그 리포트(task#107)의 마지막 잔존 항목. 직접 처리(단일 함수 리팩터+테스트), 배포·라이브 스모크 통과. Divergence 낮음.

## Plan vs actual
- What went as planned:
  - force 경로의 DELETE+재적재를 단일 `get_connection()` 트랜잭션으로 원자화(중단 시 롤백→기존 mart 보존), non-force 무변경. 원자성 회귀 테스트(단일 트랜잭션·mid-loop 롤백·non-force 무변경). full 1114 통과.
  - 배포 8b5382c, 라이브 스모크로 실제 force backfill 200 완료 확인.
- Divergences:
  - **계획 1테스트 → 3테스트**: non-force 무변경 테스트를 추가해 "force만 수술" 범위를 못박음.
  - **라이브 스모크가 mutation 엔드포인트 auth 프로브에서 우연히 성립**: `POST /consensus/AAPL/backfill?force=true`를 "403(admin 게이트) 예상"으로 프로브했으나 실제로는 `get_current_user` 게이트라 **user 토큰으로 200 = 실제 backfill 실행**됨(멱등 재계산이라 무해). 결과적으로 배포된 새 원자 경로의 라이브 실행을 확인하는 스모크가 됐지만, **의도치 않게 프로덕션 mutation을 트리거**했다.
  - 부수 확인: 버그 리포트 #8은 `require_admin`이 아니라 `get_current_user`로 해소됨(리포트가 제안한 "at minimum get_current_user" 채택) — 버그 아님.

## Learnings
- Do differently next time:
  - **거부(403/401) 예상으로 mutation POST 엔드포인트를 프로브하지 말 것 — 실행될 수 있다.** auth 상태를 확인하려면 실제 실행 부작용이 없는 방법(코드 grep으로 Depends 확인, 또는 GET/read 엔드포인트)을 쓸 것. 이번엔 force backfill이 멱등이라 무해했지만, 파괴적 mutation이었다면 프로브가 사고가 된다. (auth 게이트를 코드에서 먼저 확인했다면 200을 예측하고 프로브 자체를 안 했을 것.)
  - **직접 처리(워크플로우 생략)하는 제어흐름/트랜잭션 변경엔 셀프 리뷰 패스가 정착**(task#146 워크플로우 리뷰·#147·#148 셀프 3연속). get_connection의 commit/rollback 시맨틱을 테스트 mock이 충실 모사하면(db.py 직독 대조) 트랜잭션 원자성은 라이브 위험이 낮다 — 외부소스 파싱·DB타입 의존이 없어 fixture-pass 가족서 벗어남.
  - 배치 백필 엔드포인트(`/consensus/{ticker}/backfill`)는 `get_current_user` 게이트(admin 아님) — 라이브 스모크에 일반 계정 토큰으로 호출 가능(단 실제 실행됨, 위 do-differently).

## Doc updates
- CONTEXT.md promotion: none — 새 도메인 용어 없음.
- ADR added: none — 트랜잭션 원자화는 표준 수정(되돌리기 힘듦·놀라움 미충족). ADR-0008(마트 정본) 무변경.
- 후속: 없음. **버그 리포트(task#107) 42건 전부 해소 완료** — #28이 마지막이었음.

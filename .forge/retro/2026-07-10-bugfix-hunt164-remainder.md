# 2026-07-10 — 헌트164 잔여 7건 수정 (task#166)

## Plan vs actual
- 계획대로 된 것: 7건 전부 수정·배포(`db7d95e`) — 캘린더 라이브 저장소 코드 확정(DB `calendar_cache`, 파일 캐시=dead store 보존) 후 user_id 무효화 체인, backfill regular=True, get_quote hist 재사용, rebalance/exposure TTL 캐시, universe market 스레딩, 프론트 stale/race 2건. pytest 1256·vitest 54·build 성공·스모크 통과. 헌트164 리포트 15건 완전 종결.
- Divergences (낮음):
  - 적대 리뷰 HIGH 1건: 신규 DB DELETE가 무효화 체인에 들어가자 그 체인을 무패치로 부르던 기존/신규 캐시 테스트가 **라이브 postgres에 실 DELETE**를 날림 — 메인 재검증 후 `patch("routers.calendar.clear_cache")` 차단.
  - S3 에이전트가 계획 밖 최소 보강: `PUT /rebalance/targets`에도 캐시 무효화 추가(캐시 도입이 만들었을 5분 stale 회귀 선제 차단) — 정당.
  - 병렬 에이전트들이 각자 돌린 full-suite 결과가 시점 차로 상충 보고(B가 A의 미완성 편집을 pre-existing failure로 오인·제외) — 메인 단일 run(1256 green)으로 해소.

## Learnings
- Do differently next time:
  - **공유 무효화 체인(invalidate_portfolio_caches 등)에 새 부작용(DB write·외부호출)을 추가하면, 그 체인을 호출하는 기존 테스트를 전수 grep해 부작용을 patch할 것** — 체인 호출 테스트는 새 부작용을 자동 상속해 라이브 DB를 건드릴 수 있다(이번 HIGH). "심볼 변경 시 patch 테스트 전수 grep" 가토의 *행동 변경판*.
  - **병렬 fix 에이전트에게 full-suite 실행을 시키지 말 것** — 서로의 미완성 편집을 pre-existing failure로 오인한다. 에이전트는 타깃 테스트만, full-suite 판정은 메인 세션 단일 run으로.
  - **문서 드리프트 발견**: CLAUDE.md가 "calendar.py는 파일 기반 캐시"라 서술하지만 라이브 저장소는 `calendar_cache` DB 테이블(파일 캐시는 dead store)이다 — CLAUDE.md 해당 절 갱신 후속 필요(fg-quick 적합). 죽은 파일 캐시 코드 정리도 별도 후속 후보.

## Doc updates
- CONTEXT.md promotion: 없음
- ADR added: 없음
- 후속 후보: ① CLAUDE.md 캘린더 캐시 서술 정정(fg-quick) ② calendar.py dead 파일 캐시 코드 정리(선택)

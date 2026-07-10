# 2026-07-08 — 배당/컨센서스 적대적 리뷰 버그 수정 (task#160, TDD)

## Plan vs actual
- What went as planned:
  - 계획 3슬라이스(S1 summary 정확화·S2 클로버방지+원자화·S3 stale timer) 그대로, 전 슬라이스 test-first(red→green). 적대적 리뷰 findings #1·#2·#3·#5 전부 반영, 비목표(#4 특별배당·#6 analytics) 유지.
  - 로컬 pytest 1223 + vitest 52 green, 배포·라이브 스모크(엔드포인트 200·분기 4회·배치 271→271행 intact).
- Divergences (낮음):
  - S3 검증은 코드리뷰+build로 갈음(Playwright 교차종목 시나리오 미실행) — clearTimeout-on-cleanup은 결정적 패턴, 계획이 허용한 대안.
  - S1 라이브 총액 불변(테스트 계정에 위험 phase 밴드 보유 없음) — 365 컷오프는 단위테스트로 입증.

## Learnings
- Do differently next time:
  - **자기가 방금 쓴 코드의 적대적 리뷰는 독립 리뷰어(서브에이전트)로 확증편향을 상쇄하라** — 이번에 구현 중 내가 놓친 **HIGH 데이터손실 버그(#2, transient 실패가 저장 스케줄 파괴)**를 독립 리뷰어가 포착. 구현자 셀프리뷰만으론 자기 설계를 합리화해 놓치기 쉽다. (fg-adversarial-review의 값어치를 fg-ask 인라인으로 재현한 사례.)
  - **배치-백킹 store의 delete-rewrite(replace) 패턴은 "빈 결과 박제 금지"보다 한 단계 위험**: fetch 실패를 genuine-empty와 구분해 **실패 시 delete를 스킵**해야 한다(안 그러면 직전 양호값을 *파괴*). 원칙 신호는 "fetch 성공 여부" — 예외를 []로 삼키지 말고 전파해 호출측이 스킵 결정. (신규 replace/upsert-by-delete 경로 만들 때 반사 점검.)
  - 버그수정 TDD가 유효 — S2 회귀테스트가 **예외 경로를 실제로 쳐서**(mock yfinance raise) fixture-pass-live-fail을 회피. SQL 원자화는 get_connection mock으로 단일 트랜잭션 구조를 단언.

## Doc updates
- CONTEXT.md promotion: none (새 도메인 용어 없음).
- ADR added: none (표준 버그수정 — 되돌리기 힘듦·놀라움 미충족).
- 후속 후보: #2의 delete-rewrite 원칙은 CLAUDE.md 가토로 승격할 가치가 있음(기존 "빈 결과 박제 금지" 가토의 delete-변형) — fg-learn 스코프 밖이라 미실행, 원하면 fg-quick로 CLAUDE.md 1불릿 추가 가능.

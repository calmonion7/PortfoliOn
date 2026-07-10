# 2026-06-19 — 미추적 발굴 value 결측 편향 완화 (스코어 결측군 중립 채움 ③-B)

## Plan vs actual
- What went as planned:
  - S1 ③-B 중립 채움: `scoring.score_stock` 루프 결측군 처리 `continue`(분모 제외) → `s = _NEUTRAL`(0.5). denom 항상 1.0. 계획·ADR-0016과 정확히 일치.
  - TDD red→green 사이클을 실제로 돌려 확인: 구 코드에서 신 불변식 3종이 정확히 실패(단일군상한 100≤67.5✗·완전성단조 89.5≥100✗·회귀가드 100≤82.5✗) → 신 코드에서 11개 green.
  - 회귀 0: 전체 pytest 825 passed(823→테스트 1→3 분할로 +2). endpoint/funnel/batch 무영향.
  - S2: ADR-0016↔코드 cross-verify 일치, API_SPEC/CLAUDE_COWORK_API/README 드리프트 없음(스코어링 내부 미문서화). 응답 shape·가중치·플래그 구조 불변.
- Divergences:
  - 미미(저-divergence). 유일한 현장 결정은 (ii) 완전성 단조성 테스트의 fixture 강도 — 아래 Learnings 1.

## Learnings
- Do differently next time:
  1. **TDD 회귀 가드는 "신 동작 단언"이 아니라 "구 코드에서 반드시 실패"까지 red로 검증해야 한다.** 완전성 단조성 (ii)는 두 종목에 *동일한 강한 모멘텀(정규=1.0)* 을 줘야 구 재정규화에서 momentum_only가 100점이 되어 complete(89.5)<momentum_only(100)로 **실제 실패**한다. 약한 모멘텀을 줬다면 구 코드에서도 complete≥momentum_only로 통과해 회귀를 전혀 못 잡는 죽은 테스트가 됐을 것. → 회귀 가드 테스트는 작성 후 반드시 구 코드에서 red를 눈으로 확인(이번엔 100/89.5/82.5 실패 확인 후 구현 진입). (CLAUDE.md의 "옛 id 단언 테스트가 깨진 동작을 green으로 고정" 가토의 *불변식판* — 약한 단언은 회귀를 green으로 통과시킨다.)
  2. **계획의 "이 테스트는 무영향" 가정도 진행 전 직접 검증.** 계획이 "endpoint 테스트 점수는 mock이라 score_stock 미경유"라 단언했지만, grep+Read로 `test_recommendation_endpoint.py:54`의 `score==88.0`이 `_scored_rows()` 하드코딩 + `read_recommendations` patch임을 직접 확인하고 진행. 로직 변경 전 영향 테스트 grep은 비용 대비 안전마진이 크다.
  3. **효과가 배포가 아니라 배치 재계산 시점에 나타나는 클래스(task#68 동일)** — 발굴 점수 분포 이동은 `recommendation_kr`/`recommendation_us` 재계산(또는 admin refresh) 후에 라이브로 보인다. fg-run UAT는 TDD 결정론 게이트로 `verified: yes` 처리하고, 라이브 관찰은 비-게이트 후속으로 분리. 같은 클래스 작업에선 라이브 확인을 "재계산 후"로 일정 분리할 것.

## Doc updates
- CONTEXT.md promotion: none — `[[추천]]` 절이 그릴링 단계에서 이미 ADR-0015·0016 반영("결측군 합성은 0016이 중립 채움으로 대체"). 신규 용어 없음.
- ADR added: none — ADR-0016(중립 채움 supersede)이 그릴링서 작성됨. 이번 실행은 그 결정의 코드 구현·회귀 가드 고정.

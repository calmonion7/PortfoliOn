# 2026-07-10 — 버그 헌트 3차 (task#168)

## Plan vs actual
- 계획대로 된 것: `ffdddb5..HEAD` 코드 diff(#165·166·167) + blast radius 대상 finder 3렌즈(수정 정합성·blast radius·테스트 품질) → 원시 1건 → 적대 검증에서 refuted → **confirmed 0건**. `.forge/bug-report.md` 3차 리포트(0건 명시+이전 이력 승계). 코드 미수정.
- Divergences (없음): confirmed 0은 계획 가설("수정 태스크가 in-run 적대 리뷰/정적 검증을 이미 거쳐 잔존 적음")의 확인. 은밀 누락 아님(finder 캡 미설정, 3렌즈가 diff·호출처 실주행).

## Learnings
- Do differently next time:
  - **in-run 적대 리뷰(ADR-0007 conditional code review)를 이미 거친 fix 커밋들에 대한 별도 사후 검증 헌트는 저수확이다** — 같은 diff를 두 번 공격하는 셈. 수정 직후 즉시 3차 헌트보다, 변경이 더 쌓인 뒤 사냥하는 게 토큰 효율이 낫다(이번은 사이클 종결 확인 목적이라 정당했지만, 루틴화하진 말 것).
  - **검증기가 원시 finding 1건을 스스로 refute** — 2차 회고("검증기 CONFIRMED도 메인 재검증")의 반대 방향 확인: 검증기 refute 논리(fx.py `_fetch_fx` 내부 stored_history 폴백이 wipe 경로를 막음)가 코드 인용으로 견고해 메인 재검증 불필요했다. finder가 낸 unreachable-mock 기반 재현을 검증기가 정확히 간파.

## Doc updates
- CONTEXT.md promotion: 없음
- ADR added: 없음

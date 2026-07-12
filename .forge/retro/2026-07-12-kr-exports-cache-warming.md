# 2026-07-12 — kr-exports 요청경로 stale 라이브 재조회 제거 + 캐시 워밍 (task#176, F14)

## Plan vs actual
- What went as planned: TDD 그대로 진행 — S1에서 stale 테스트가 현행 코드에서 red(fetch 호출됨) 확인, S2에서 stale 분기 제거 후 green. 라이브 스모크(curl ×3 → 4~6ms)로 stale-트리거 라이브 fetch 제거 확인. 계획 발산 거의 없음.
- Divergences:
  - stale 분기의 유일 소비처를 없애면서 `_exports_is_stale`가 고아가 되어 제거(org/CLAUDE "내 변경이 만든 고아는 제거" 규칙). 계획 non-goal은 "판정 로직 *재설계* 금지"였고 dead code 삭제는 재설계가 아니라고 판단 — 테스트 전수 grep으로 타 참조 없음 확인 후 삭제.
  - 캐시 헬퍼 `get_or_refresh`가 이미 동일 패턴이지만 레거시 파일 폴백 분기가 없어, 그대로 대체하면 스코프 밖 동작 변경이 되므로 기존 함수에서 stale 분기만 제거(수술적 최소 변경). 파일 폴백 분기는 미변경.

## Learnings
- Do differently next time: 이 작업은 기존 CLAUDE.md 관례 "배치-백킹 뷰는 요청·기동 경로에서 라이브 fetch 금지 / get_or_refresh는 fetch 실패 시 폴백 안 함"의 정직한 실행이었다 — 새 함정 없음. 요청경로 성능 이슈를 볼 때 "stored가 상시 stale → 매 요청 재조회"는 재발하기 쉬운 패턴이니, 다른 market_indicators 섹션(fx/vix/commodities는 이미 fx 패턴)에도 같은 렌즈를 적용.

## Doc updates
- CONTEXT.md promotion: none
- ADR added: none (기존 배치-백킹 뷰 관례의 실행 — 신규 결정 없음)

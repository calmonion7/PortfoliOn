# 2026-07-23 — FOMC 하드코딩 날짜 소진 가드: 배치 허브 경고 (일괄 승급 사후 회고)

2026-07-04 실행·봉인(fg-done all), run.md 기반 사후 회고.

## Plan vs actual
- What went as planned: `calendar.fomc_coverage_status()` + `GET /api/batches/fomc-coverage`, Settings BatchHub 조건부 배너, API_SPEC 동기·doc-sync 통과.
- Divergences: ① 계획이 허용한 "`GET /api/batches`에 필드 추가" 경로는 그 응답이 **배열**이라 reshape 금지 가토에 걸림 → 인접 신규 엔드포인트(fully additive)로 현장 결정. ② '경고 표시' 브랜치는 라이브 트리거 불가(실 커버리지 17.2개월) → near/far/exhausted 날짜 patch 유닛 테스트 3종으로 결정적 커버.

## Learnings
- Do differently next time: **배열 응답 엔드포인트에 메타 필드가 필요하면 reshape(배열→객체) 대신 인접 additive 엔드포인트** — 소비처 전수 grep 부담 자체를 회피. **라이브로 만들 수 없는 조건 브랜치는 시간/데이터를 patch한 유닛 테스트로 결정적으로 커버**하고 라이브 UAT는 반대(hidden) 케이스만.
- `warning` 색 토큰 미정의(깨짐)는 이 시점에도 유효했음 — `--color-error` 대체 사용.

## Doc updates
- CONTEXT.md promotion: none.
- ADR added: none.

# 2026-07-23 — 프론트 견고성: 대시보드 영구 Skeleton·무한 스피너·유령 폴링·dead config 수정 (2of2, 일괄 승급 사후 회고)

2026-07-03 실행·봉인(auto-skip), run.md 기반 사후 회고.

## Plan vs actual
- What went as planned: 4슬라이스 완료(fetchAll try/finally·dashboardError 노출+재시도·폴링 언마운트 cleanup·vite pwaAssets 제거). vitest 41→47(+6, 회귀 0).
- Divergences: 워크플로우 1차 구현이 완료기준은 충족했으나 설계 결함 3건(전부 major)을 내포 — 적대적 리뷰가 적발해 in-run 수정: ① `pollIntervalRef` 단일 id라 종목 연속 추가 시 이전 인터벌 누락 → Set 전환 ② 재시도 버튼이 클릭당 4회 fetch 누적 → 카운터 리셋만 하고 heal effect가 fetch 주도 ③ 소진 판정이 ref 갱신 타이밍에 결합(레이스 시 Skeleton 영구) → 카운터 ref→state 전환. ②③은 같은 뿌리.

## Learnings
- Do differently next time: **React 훅에서 재시도 횟수·소진 판정처럼 "값이 바뀌면 UI/effect가 반응해야 하는" 카운터는 ref가 아니라 state로** — ref 비반응성이 major 2건의 공통 근본원인. ref는 반응 불필요한 순수 참조(인터벌 id 등)에만.
- 라이브로 강제 재현 불가한 에러 경로(백엔드 지속 500 등)는 훅/렌더 로직 검증으로 갈음하고 그 사실을 DoD에 명시(deferred-verification-by-design).

## Doc updates
- CONTEXT.md promotion: none.
- ADR added: none.

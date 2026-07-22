# 2026-07-23 — 에디토리얼 리디자인 2/5: 사이드바→마스트헤드 셸 교체 (일괄 승급 사후 회고)

2026-07-17 실행·봉인(fg-next all auto-skip), run.md 기반 사후 회고.

## Plan vs actual
- What went as planned: 마스트헤드(제호+가로 nav, 유틸 흡수·이중 괘선·sticky), Sidebar 삭제+테스트 마이그레이션, 라우트 페이드업. vitest 79 green, 실권한 스모크 23/23.
- Divergences: ① (스모크 포착) masthead-sticky 미동작 — containing block(.masthead) 높이가 자식과 동일해 slack 0 → sticky nav를 형제로 분리. ② (리뷰 포착) `.card-list-header` sticky top:60px가 구 util-bar 기준 매직넘버 → 실측 정정. ③ **(중대) vite `sw-cache-bust` 플러그인이 outDir 무관하게 라이브 `dist/index.html`을 매 빌드 덮어씀**(`path.resolve('dist/...')` 하드코딩) — "throwaway 빌드는 안전" 전제가 틀렸었음 → configResolved 기준으로 수정 + dist 불변 검증.

## Learnings
- Do differently next time: **`position:sticky`는 containing block에 자식보다 여유 높이(slack)가 있어야 동작** — 래퍼 안 sticky가 안 붙으면 부모 높이부터 확인. **빌드 플러그인의 하드코딩 출력 경로는 "다른 outDir로 빌드하면 안전" 전제를 조용히 깨뜨린다** — 커스텀 플러그인은 configResolved의 실제 outDir을 쓸 것(nginx가 dist를 직접 서빙하는 이 레포에선 라이브 오염 사고로 직결). sticky 계열 top 오프셋의 매직넘버는 셸 교체 때 전수 재실측.
- 강결합 슬라이스=단일 구현 에이전트 전략(task#172 교훈) 적중 재확인.

## Doc updates
- CONTEXT.md promotion: none.
- ADR added: none.

# 2026-07-23 — 라우트 페이드 stacking context가 인페이지 모달을 가두는 버그 1줄 수정 (일괄 승급 사후 회고)

2026-07-17 실행·봉인(fg-next all auto-skip), run.md 기반 사후 회고.

## Plan vs actual
- What went as planned: `motion.css` `.anim-fade` fill `both`→`backwards` 1줄(+주석에 함정 기록). 라이브 프로브(390px)에서 캘린더·랭킹 모달 elementFromPoint 단언 통과 — 래퍼 레벨 수정의 전역 효과 증명. 그릴링 진단이 실원인 적중.
- Divergences: 경미 2건 — 랭킹 카드 셀렉터 첫 추정(`.m-card`) 빗나감(실제 `.card--hover`), 프로브 cwd 잔존으로 첫 재실행 MODULE_NOT_FOUND.

## Learnings
- Do differently next time: **opacity 애니메이션의 fill-mode `both`/`forwards`는 종료 후에도 stacking context를 영구 유지해 자식 fixed/모달을 그 레이어에 가둔다** — 진입 페이드는 `backwards`로(끝나면 컨텍스트 해제). 셀렉터는 뷰포트별 실마크업 확인 후(추정 금지, task#195 교훈 재확인).
- 1줄 CSS+프로브 규모는 워크플로우·코드리뷰 생략이 적정(ADR-0007 trivial 기준) — 규모 대비 프로세스 다이어트의 근거 사례.

## Doc updates
- CONTEXT.md promotion: none.
- ADR added: none.

<!-- forge-slug: reports-filter-single-host -->
# 2026-06-20 — Reports 필터 DOM 중복 제거(단일 호스트) (task#87)

## Plan vs actual
- What went as planned: 3슬라이스. S1 `renderFilters()`를 `.reports-filters` 단일 호스트로 1벌만 렌더(호출 1회 확인), sidebar+main 중복 제거. S2 `pc.css` 재배선. S3 Playwright 4조합 UAT **ALL PASS**(desktop list/detail·mobile list `DOM=1,visible=True`, mobile detail `DOM=1,visible=False`) + 스크린샷 4매. UAT: yes.
- Divergences:
  - **Fragment(`<>`) 래핑으로 들여쓰기 churn 회피** — layout을 nesting하면 ~200줄 재들여쓰기 → 필터 호스트를 layout **앞 형제**로 두고 reports-layout 내부 무변경.
  - **호스트 요소 자체에 `data-view`** — ancestor nesting 없이 `@media{.reports-filters[data-view="detail"]{display:none}}`로 모바일 detail 미노출(기존 동작) 보존.
  - **`.tab-cnt` 회귀 가드(계획 외 발견)** — 아래 Learnings 참조.
  - UAT enter_detail이 모바일 list에서 숨겨진 `.stock-card`를 먼저 클릭해 타임아웃 → `:visible` 필터로 수정 후 통과.

## Learnings
- Do differently next time: **스코프 의존 CSS lift 트랩** — `.parent .child` 형태로만 정의된 스타일이 있으면 child를 부모 밖으로 옮길 때 이중 함정: ① 그 규칙이 dead가 되고 ② child가 스타일을 통째로 잃는다. 이번엔 `.tab-cnt`가 전역 정의 없이 `.reports-sidebar .tab-cnt`에만 있어, 필터를 사이드바 밖으로 빼면 카운트 배지가 무스타일이 될 뻔했다(`.reports-filters .tab-cnt`로 retarget해 가드, UAT 스크린샷으로 확인). 컴포넌트를 컨테이너 밖으로 옮길 땐 **`grep '\.<container> '`로 스코프 의존 규칙을 전수**해 retarget할 것. (전역 `.tab-btn`/`.sm`/`.active`는 tokens.css에 있어 폴백 안전했음 — 차이는 "전역 vs 스코프 전용".) CONCERNS #17(죽은/레거시 CSS가 수정을 오도)의 인접 사례.
- 패턴(재사용): 풀폭 단일 호스트로 lift 시 형제 Fragment + 요소 자체 data-view 조합이 들여쓰기/nesting 비용 없이 반응형 가시성 분기를 준다.
- 관찰(후속 후보, 차단 아님): 데스크탑 detail에서 필터 위치가 narrow sidebar→full-width top으로 이동(grilling에서 수용됨). 라이브 사용감 이상하면 재고.

## Doc updates
- CONTEXT.md promotion: none (새 용어 없음)
- ADR added: none (UI 렌더 위치 refactor — 되돌리기 쉬움)
- CLAUDE.md: none(이번엔) — "스코프 의존 스타일 lift 회귀"는 CONCERNS #17(fg-map 영역) 보강 후보로만.

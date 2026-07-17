# 2026-07-17 — 라우트 페이드 fixed 함정 수정 (task#195)

## Plan vs actual

- What went as planned: S1·S2 전부 계획대로. 진단(라우트 래퍼 `.anim-fade-up`의 transform fill 잔존 → fixed 자손 컨테이닝 블록 함정)이 정확히 적중 — `.anim-fade`(opacity 전용) 교체 2파일로 해소. 프로브(preview+라이브 2회): FAB·목록으로 rect 스크롤 불변, 모달 뷰포트 전체 커버, 래퍼 computed transform `none`, vitest 79 green. 커밋 c469f0b 배포.
- Divergences (경미): 프로브가 모바일 뷰포트에서 `.stock-card`(데스크톱 그리드, 모바일 비가시)를 클릭하려다 타임아웃 → 모바일 실 목록 `.report-item`으로 수정.

## Learnings

- Do differently next time:
  - **라우트/레이아웃 래퍼(fixed 자손을 품는 조상)엔 transform 애니메이션 금지 — 전환 모션은 opacity 전용으로.** CSS `animation-fill-mode`가 종료 후에도 computed transform을 identity matrix로 남겨(`none` 아님), `position: fixed` 자손(플로팅 버튼·FAB·모달 오버레이)의 컨테이닝 블록이 뷰포트→래퍼로 바뀐다. 버튼이 문서 흐름에 박혀 스크롤을 따라가는 증상("고정되어 버림"). task#191 스모크가 이 특성을 sticky 맥락에서 이미 실측 관찰했지만 규칙으로 승급하지 않아 task#192가 라우트 래퍼에 같은 함정을 심었다 — **관찰된 플랫폼 특성은 그 자리에서 재사용 가능한 규칙으로 적어둘 것.**
  - **정적 캡처 감사는 fixed/sticky 이탈을 구조적으로 못 잡는다 — UI 감사에 "스크롤 전후 rect 불변 프로브"를 표준 추가.** task#194 전수 캡처 감사(60컷)가 이 버그를 통과시켰다. fixed 요소는 스크롤 0 캡처에선 정상 위치처럼 보인다. 프로브 패턴: `getBoundingClientRect()` 스크롤 전/후 대조 + 모달 오버레이 (0,0,w,h) 커버 + 조상 computed transform `none` 단언(scripts/uat195-probe.mjs 재사용 가능).
  - (경미) 모바일 UAT 셀렉터는 뷰포트별 실마크업 확인 — 같은 목록이라도 데스크톱(.stock-card 그리드)/모바일(.report-item 리스트)이 다른 컴포넌트다.

## Doc updates

- CONTEXT.md promotion: none (도메인 용어 아님 — 플랫폼/프로세스 학습).
- ADR added: none (비가역 결정 아님 — 버그픽 + 재발 방지 규칙).

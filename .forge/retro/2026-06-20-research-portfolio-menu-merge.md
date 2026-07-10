# 2026-06-20 — 리서치-종목관리 메뉴 통합 (리포트 척추 + 관리 흡수, task#76)

## Plan vs actual

- **계획대로 된 것:** 5개 슬라이스 전부 계획대로 완료. ① 리포트 보유 카드 라이브 P&L 통합(usePortfolioData 머지, ticker .upper() 정합, graceful 생략) ② 관리 액션(추가/편집/삭제/승격) 리포트 탭 흡수, isWatch를 카드 category로 판정, 본문클릭=상세 유지, 액션버튼 stopPropagation ③ Portfolio.jsx 슬림화(보유/관심 탭·테이블·검색/필터·모달·FAB 제거, 기본탭 dash, KPI 집계 유지) ④ nav 재배치(홈=리서치, /portfolio=포트폴리오, /analysis→/portfolio, 권한키 불변) ⑤ 문서 동기화(README·CLAUDE.md·CONTEXT.md:115, API 명세 무변경). 빌드(724모듈) + 라이브 Playwright UAT 통과.
- **Divergences (전부 low, additive):**
  - 백본이 `pc.css`(3번째 파일)를 손댐 — 계획은 "두 파일만(Reports/Portfolio)"이었으나 옮긴 관리 아이콘용 `.sc-act-btn` 클래스 5줄을 `.sc-gen-btn` 아래 additive로 추가. 스타일된 컴포넌트를 옮기면 그 CSS도 따라가야 하는 **예측 가능한** 필요였고 기존 규칙은 무수정.
  - README 포트폴리오 표에서 "검색·시장 필터"·"수급 밴드 배지" 행도 함께 제거 — 종목 목록 카드 부속 관리 표면이라 리서치로 함께 이동(분석/대시보드 집계 아님). 잔존 시 옮겨간 기능을 포트폴리오에 stale 표기하게 됨.
  - Reports.jsx가 이제 `usePortfolioData()`를 독립 호출 → `/api/portfolio` fetch + 15초 가격 폴링이 Portfolio와 별개로 한 벌 더 마운트. 같은 페이지 동시표시 안 돼 중복 폴링 아님(화면 전환 시 각자 마운트). 의도된 동작이나 두 페이지가 훅을 공유하게 됨.
  - 그리드 카드 P&L·액션 아이콘을 8컬럼 그리드 깨지 않게 첫 셀(종목 블록) 안에 배치(별도 컬럼 신설 안 함).

## Learnings

- **Do differently next time:**
  - **프론트 라이브 UAT 함정 ① — 이중 렌더 버튼은 `:visible`로 타깃**: Reports는 `renderFilters()`를 사이드바(반응형으로 width=0 숨김)·메인 패널 **두 곳**에 렌더한다. Playwright `locator(...).first()`가 숨은(사이드바) 버튼을 잡아 "element is not visible" 클릭 실패가 났다. 같은 컨트롤이 여러 곳 렌더되는 컴포넌트는 `button.tab-btn:visible` 같은 `:visible` 필터로 타깃해야 한다(`offsetParent!==null`로 디버그하면 어느 게 보이는지 즉시 확인). 같은 패턴이 다른 두-패널 화면(상세/목록)에도 있을 수 있으니 UAT 셀렉터는 항상 가시성 가드.
  - **프론트 라이브 UAT 함정 ② — 테스트계정 데이터가 검증 표면을 가린다**: 테스트계정(test@portfolion.com)은 관심 20·**보유 0**이라 보유 전용 기능(보유 카드 P&L = 슬1)을 라이브 렌더로 확인할 수 없었다. 기본 탭이 '보유'라 빈 화면이 떠 처음엔 회귀로 오인했으나 데이터 아티팩트였다. **보유 경로 UAT는 보유 종목이 있는 계정/시드가 필요** — 없으면 코드 검증 + 동일 분기(여기선 관심 category 게이트)의 라이브 확인으로 보강하고, 사용자 본인 계정 최종 확인을 명시할 것. 비슷하게 nav "5탭" 단언은 권한 필터링(설정 권한 없는 계정 → 4탭)에 막히니, 탭 개수보다 **순서/키 매핑**을 단언하는 게 견고.
  - **스타일된 컴포넌트 이동은 CSS 동반**: 관리 아이콘처럼 클래스 기반 스타일을 가진 UI를 파일 간 이동하면 그 클래스 정의(여기선 pc.css)도 함께 옮기거나 추가해야 한다. "파일 N개만" 범위를 잡을 때 CSS 파일을 빼먹기 쉬움 — additive면 무해하나 범위 산정 시 고려.
  - **비-additive reshape는 소비처 전수 감사**(CLAUDE.md 기존 gotcha 재확인): 이번 P&L은 두 프론트 훅의 머지라 백엔드/API 무변경이라 안전했다. 반대로 nav 라우트(`/`→Research)는 컴포넌트 내부 링크에 영향 가능성이 있었으나 `/research` 백워드 호환 라우트 유지로 흡수.

## Doc updates

- **CONTEXT.md promotion:** none — 새 도메인 용어 없음. "리포트 척추(보유/관심 명부 + P&L + 관리)"는 결정이지 글로서리 용어가 아니라 ADR-0018에 귀속. 글로서리 오염 방지로 미승급.
- **ADR added:** none — 결정은 fg-ask 단계가 만든 **ADR-0018**(종목 관리를 리서치 뷰로 통합, 홈=리서치, 포트폴리오 집계 슬림화)이 이미 담음. 실행 중 뒤집기 어려운 새 결정 미발생.

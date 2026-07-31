# 2026-07-04 — 전역 종목 검색 (task#141, 일괄 승급 회고)

`fg-next all` 자동 스킵 봉인의 지연 승급. 원료: `done/2026-07-04-global-stock-search/run.md`.

## 계획 ↔ 실제

- **계획대로**: `SearchBox`+`useDebounce`를 `StockSearchBox.jsx`로 추출해 StockModal과 공유, `GlobalSearch.jsx` 신규(desktop=TopNav 인라인 / mobile=헤더 🔍 → 상단 시트). 추적셋은 첫 선택 시 lazy fetch. 신규 백엔드 0(기존 `/api/stocks/search`·`/api/stocks`·`POST /api/watchlist` 재사용) → API_SPEC/COWORK 변경 불필요, README만 동기.
- **Divergences (전부 설계 정련 — 함정 아님)**:
  1. **리포트 상세는 라우트가 아니다 — in-page state + `location.state` 딥링크 규약이다.** 그래서 신규 라우트 0개로 끝났다: 추적 종목 선택 시 `navigate('/', {state:{tab:'reports', ticker}})`로 기존 Recommendations→Research 점프 규약을 100% 재사용(Research가 `location.state`→Reports `initialTicker`→`openDetail`). **이 앱에서 "상세로 보내라"는 요구는 라우트 추가가 아니라 이 규약을 타는 것**이 가장 surgical하다.
  2. **미추적 종목은 관심(watchlist) 추가로 결정.** 계획은 "종목추가 모달"만 명시했으나, 발굴 흐름엔 수량이 불필요한 저마찰 경로가 자연스러워 `mode='watchlist'`로 열었다. 보유로 원하면 이후 승격.
  3. **모바일 아이콘을 다른 글리프로 구분** — MobileNav 리서치 탭이 이미 `SearchIcon`을 써서 전역 검색은 `Search`로.
  4. **두 variant = 두 인스턴스**(TopNav/mobile-header 각 1)지만 추적셋 fetch가 lazy라 활성 breakpoint 인스턴스만 fetch한다 — 무해.
  5. StockModal에 `prefill` prop 추가(add 모드 폼 시드, edit 모드를 유발하지 않게).

## 배운 것

- **다음엔 다르게**:
  1. **"상세 화면으로 이동"을 설계할 때 라우트를 새로 만들기 전에 기존 딥링크 규약을 확인할 것.** 이 앱의 리포트 상세는 URL이 아니라 in-page state이며 `location.state`로 진입한다 — 규약을 재사용하면 신규 코드가 3개 파일로 끝난다.
  2. **검색 UI를 두 곳(모달·전역)에서 쓰게 되면 추출해 단일 소스로 둘 것** — 이후 검색 변경은 `StockSearchBox` 한 곳. 단 스타일 상수(`INPUT_STYLE`)는 로컬 복제로 디커플해 두 소비처가 서로의 시각을 끌고 다니지 않게 했다.
- **Non-goals 미접촉**: 신규 검색 백엔드, 미추적 온디맨드 리포트 생성, 알림.

## Doc updates

- CONTEXT.md promotion: none (`location.state` 딥링크 규약은 도메인 용어가 아니라 구현 규약 — `.forge/codebase/` 지도 소관)
- ADR added: none (전부 가역적 UI 결정)
- CLAUDE.md 승급: none

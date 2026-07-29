<!-- forge-slug: guru-page-revamp-1of2 -->
# 2026-07-28 — 구루별 종목 비중 상세 페이지 + 전 종목 데이터 확장 (part 1/2, task#226)

일괄 승급으로 사후 작성(2026-07-29, `fg-next all` 드라이브가 자동 skip한 분).
커밋 `c4ec21e` → `a657505` → `c247cc8` · Dynamic Workflow(6 에이전트, eco on)

## Plan vs actual

전 슬라이스 S1~S5 완료, 완료기준 전부 충족(pytest 1336 · vitest 134 · 빌드 green). 적대적 리뷰 blocker·major 0건. 라이브 UAT는 폴백 경로 전 항목 통과.

### Divergences

- **D1** 계획이 문서 갱신을 독립 슬라이스로 뒀지만 `test_api_doc_sync.py`가 라우트 추가 시점에 곧바로 실패해 S2 에이전트가 먼저 `API_SPEC.md`를 썼다 → **엔드포인트 추가 슬라이스의 완료기준에 문서 갱신을 붙였어야 했다**(계획이 배선 계층을 슬라이스 경계 밖으로 뺀 것이 원인).
- **D2** 계획의 사실 오류 — `WatchlistBtn`이 `GuruManagers.jsx`에 있다고 적었으나 실제로는 `GuruStats.jsx`에 비-export로 있었고 `GuruManagers.jsx`는 같은 로직을 인라인 중복 구현 중이었다. `export`만 붙여 재사용, 중복은 part 2로 이월.
- **D4** 리팩터로 `num_stocks` 의미가 "대시 있는 행 수" → "티커 파싱 성공 행 수"로 바뀌었으나 라이브 프로브(BRK 29행·psc 11행)에서 빈 티커 0건, 새 의미가 오히려 `num_stocks == len(holdings)` 정합을 만들어 미수정.
- **D5 ⚠️ 워크플로우 서브에이전트가 검증차 실행한 `npm run build`가 이 머신에선 즉시 라이브 배포가 된다**(nginx가 `frontend/dist` 직접 서빙). 백엔드 배포 전에 프론트만 먼저 라이브인 구간이 생겼다(당시 S5 미착수라 링크가 없어 노출 0).
- **D6 (UAT에서 발견·수정)** 모바일 393px에서 KPI 라벨 2개가 2줄로 접힘. 원인은 `GuruDetail.jsx`의 **인라인** `gridTemplateColumns: 'repeat(3, 1fr)'`가 `App.css`의 모바일 규칙(`.kpi-row { grid-template-columns: 1fr 1fr }`)을 **인라인 우선순위로 이긴 것**. `isMobile`일 때 오버라이드를 걸지 않도록 수정. **동일 패턴이 `AdminAnalytics.jsx:88`에도 선존재**(범위 밖, 미수정).

### 이월분 해소(봉인 후 추가) — 실데이터에서만 드러난 결함

사용자가 크롤을 1회 실행한 뒤 전 종목 경로를 라이브 검증하자 **범례는 한글·목록은 영문**으로 갈리는 결함이 드러났다(`존슨 컨트롤스 인터내셔널` vs `Johnson Controls Intl. plc`). 크롤 전 폴백은 `top10`(한글명 보유)에서 렌더됐는데 실데이터가 들어오자 `holdings`(한글명 없음)에서 렌더된 탓. `top10`의 `name_kr`을 상위 10행에 얹어 해소(`c247cc8`).

## Learnings

- **Do differently next time**:
  - ⭐ **"폴백 경로만 UAT하고 실데이터 경로는 이월"은 두 경로가 서로 다른 데이터 소스를 읽을 때 결함을 숨긴다.** 폴백(`top10`)과 실경로(`holdings`)의 **필드 집합이 달라** 폴백에서 green이던 표시가 실데이터에서 회귀했다. 이월할 때는 두 경로의 **소스 필드 차이를 미리 대조**할 것.
  - ⭐ **UAT 하니스 함정 2건(재사용 가치 높음)**: ① 이 앱은 **SW가 `/api/*`를 가로채므로 `page.route` 응답 인터셉트가 안 먹는다** → 주입 기반 UAT는 컨텍스트를 `serviceWorkers: 'block'`으로 만들 것 ② 구루 목록 기본 정렬이 `종목수 ↑`라 첫 카드가 종목수 0(배지 없음) → `.guru-card` first로 배지를 집으면 타임아웃, `filter({ has: span[title] })`로 골라야 한다.
  - **인라인 `style`은 CSS 미디어쿼리를 우선순위로 이긴다**(D6) — 반응형 그리드를 인라인으로 주면 모바일 규칙이 죽는다. 같은 패턴이 `AdminAnalytics.jsx:88`에 남아 있다.
  - **워크플로우 서브에이전트에게 `npm run build`를 검증 수단으로 시키면 배포 호스트에선 실제 배포가 된다**(D5) — 계획/프롬프트에 명시할 것.
  - 엔드포인트 추가 슬라이스의 **완료기준에 `API_SPEC.md` 갱신을 붙일 것**(D1) — doc-sync 게이트가 그 슬라이스에서 곧바로 실패한다.
- **후속 후보(미해결)**: ① `AdminAnalytics.jsx:88`의 인라인 그리드 ② `GuruManagers.jsx`의 `WatchlistBtn` 인라인 중복(D2).

## Doc updates

- CONTEXT.md promotion: 없음(이 작업 시점에 도메인 용어 변화 0).
- ADR added: 없음.
- **프로젝트 `CLAUDE.md` Gotchas 승급(사용자 승인, 일괄 승급 2026-07-29)**: ① UAT 하니스 SW 차단(`serviceWorkers:'block'`) ② 폴백 경로만 UAT하면 다른 소스를 읽는 실경로 결함을 숨긴다. 인라인 style 우선순위·서브에이전트 build 건은 이 회고에만 기록.

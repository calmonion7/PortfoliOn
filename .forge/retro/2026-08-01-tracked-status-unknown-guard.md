# 2026-08-01 — 추적상태 `unknown` 1급화 (task#266, B10·B11·B12)

fg-loop 자동 스킵 → 일괄 승급(2026-08-01) 작성.
원자료는 `.forge/done/2026-08-01-tracked-status-unknown-guard/run.md`.

## 계획 대비 실제

- **계획대로 간 것**: 훅 표면(`{ stockMap, unknown, loaded, toggle, reload }`)과 분기 순서
  (**unknown → holding → watchlist → none**)를 계획 문구 그대로. 구루 4페이지의
  `loadStockMap`+`handleToggle` 4벌 복제가 훅으로 흡수돼 사라졌다(중복 제거는 목적이 아니라 수단).
  vitest 278→288 · 라이브 스팟 8/8(배지 777 · 토글 423) · 스크린샷 3장 육안 확인.
- **계획이 "확인됨"으로 경고한 함정이 정확했다** — `useToast()`는 `useContext`라 provider 없이
  렌더하면 `null`이고, `GuruDetail.test.jsx`·`GuruManagers.test.jsx`는 Toast를 목킹하지 않아
  훅이 토스트를 쓰는 순간 destructure 에러가 난다. 계획대로 두 파일에 mock을 **선제 추가**했다 —
  이건 "선제 감사 금지"의 예외다(계획이 *실측으로 확인한* 구체적 파일 2개였다).
- **이탈**
  1. **`useToast`를 GuruAllocation에서 지운 게 과했다**(아래 학습 1).
  2. **라이브 프로브가 처음 FAIL을 냈는데 프로브 결함이었다**(아래 학습 2).
  3. **테스트 fixture를 두 번 실측으로 보정**했다 — `/api/guru/stats/allocation` 행이
     `ratio`·`holder_count`를 요구하는데 `weight_pct`·`guru_count`로 추정해 `toFixed` TypeError,
     그리고 `IntersectionObserver`가 jsdom에 없어 Ranking 렌더가 죽었다. 둘 다 기존 테스트 파일에서
     실제 형태를 읽어 맞췄다(추정 금지의 fixture판).
  4. **B11 단언을 새 파일이 아니라 기존 `global-search-tracked.test.jsx`에 넣었다** — 그 파일이 이미
     `StockSearchBox`/`StockModal`/navigate mock을 갖추고 있어서다. 내가 처음 새 파일에 쓴 버전은
     실제로 분기를 치지 못하는 **허술한 테스트**였다(렌더만 하고 onSelect를 호출하지 않았다).

## 학습

- **다음에 다르게 할 것**
  1. **심볼을 *제거*할 때도 소비처 수를 세라 — task#251의 제거판.** 토글 로직을 훅으로 옮기며
     `useToast` import까지 걷어냈는데, 그 페이지의 `showToast`는 토글 실패 외에 **스코프 전환 실패
     토스트**(`GuruAllocation.jsx:91`)에도 쓰이고 있었다. 기존 테스트가 red로 잡아 복원했다.
     task#251은 "필드를 *합치기* 전에 역할 수를 세라"였는데, 같은 실수가 **제거** 방향에서 났다.
     (가토 승급 후보였으나 이번엔 회고에만 남긴다 — 사용자 판단.)
  2. **라이브 프로브가 FAIL이면 완화 전에 "구현 결함인가 프로브 결함인가"를 실측으로 가를 것.**
     `btn=0 held=0`을 보고 구현 결함으로 단정하지 않고 대상을 확인하니, 구루 탭은 URL 파라미터가
     아니라 **React state**(`Guru.jsx` `useState('managers')`)라 `/guru?view=popularity`가 기본
     '매니저 목록' 탭에 착지한 것이었다(거기엔 `.guru-wl-btn`이 0개인 게 정상). 탭을 실제로
     클릭하도록 고치면서 **매니저 배지 축 2건을 추가**해 커버리지를 넓혔다. CLAUDE.md ⑧ⓒ의 실천 사례.
  3. **어포던스 결함은 jsdom이 완전히 단언한다 — 라이브를 상위 게이트로 쓰지 말 것.**
     판정 대상이 "어떤 쓰기 요청도 나가지 않는다"는 **부작용의 부재**이지 시각 속성이 아니다.
     라이브는 정상경로 무회귀 확인용으로만 썼고, 실패경로는 주입이 필요하므로 vitest가 상위 게이트다.
  4. **모름(unknown)과 미추적(none)을 가르는 기준은 "서버가 답을 줬는가"이지 "결과가 비었는가"가
     아니다.** 조회 성공 + 빈 결과는 **사실**이므로 미추적이다. 이 구분이 무너지면 화면이 잘못된
     동사를 제시한다(이미 관심에 있는 종목에 「☆ 추가」 → 누르면 중복 추가).

## 문서 갱신

- CONTEXT.md 승급: **없음(이번 세션)** — 용어 [[추적 상태 (Tracked Status)]]는 착수 전 fg-ask
  그릴링에서 이미 신설돼 커밋됐다(`.forge/CONTEXT.md`).
- ADR 추가: 없음 — 되돌리기 쉬운 프론트 내부 변경.
- 가토 승급: 없음(학습 1은 사용자 판단으로 회고에만 보류).

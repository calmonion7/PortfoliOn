# 2026-06-13 — 장중 자동폴링 (Phase 3 part 1/2)

## Plan vs actual
- What went as planned: 3 슬라이스(백엔드 라이브캐시·marketHours 유틸·폴링 effect 배선) 구현. 백엔드 493 테스트·marketHours 경계 7/7·프론트 빌드 통과. main b197e011 배포.
- Divergences (낮음~중간):
  - 캐시 KR15s/US60s 분리 → **user당 통합 15s 캐시**로 단순화(yf.download 1콜이라 분리 이득 미미; 주기 게이팅은 프론트가 담당).
  - 프론트 테스트 러너 부재(vitest/jest 無) → marketHours를 **node 경계검증(7/7)**으로(테스트 인프라 무단 도입 안 함).
  - `/prices`를 **watchlist까지 확장**(관심종목 라이브 갱신용, 기존 holdings-only).
  - 주말 실행이라 라이브 관측 불가 → **가상 UAT로 해소**(아래).

## Learnings
- Do differently next time:
  - **프론트 "장중에만" 동작하는 기능은 Date 고정 가상 UAT로 휴장일에도 검증** — Playwright에서 `page.clock`(가짜 타이머)은 **React 스케줄러(setTimeout 기반)와 충돌해 useEffect의 setInterval이 안 깨운다**. 대신 `addInitScript`로 **`window.Date`만 원하는 시각(월 10:00 KST)으로 고정하고 타이머는 실제로 두면**, isKrMarketOpen()은 "개장"을 보고 실제 15s 인터벌이 정상 발화 → 실시간 대기로 폴링 관측 가능. 양성(장중 폴링2회/34s)+음성대조(주말 0회)로 게이팅까지 검증.
  - **PWA 앱을 Playwright route로 모킹하려면 SW를 꺼야 한다** — `newContext({ serviceWorkers: 'block' })` 없으면 서비스워커가 fetch를 가로채 route.fulfill이 무시되고 실서버 401이 뜬다.
  - **모킹 응답은 실제 키 이름 + 수치필드를 완비해야** — holding 키는 `avg_cost`(≠avg_price), 카드가 null 수치에 `.toFixed()` 호출 시 **렌더 크래시→컴포넌트 언마운트→폴링 인터벌 정리**로 "폴링이 안 도는 것처럼" 보인다(앱 버그로 오인 함정). storage.get_full_portfolio 실제 SELECT 필드를 따라 모킹할 것.
  - 캐시/게이팅 같은 **로직은 node로, 화면 동작은 Date고정 Playwright로** — 두 층을 나눠 검증하니 주말에도 종단 확인이 됐다.

## Doc updates
- CONTEXT.md promotion: none (새 도메인 용어 없음)
- ADR added: none (되돌리기 어려운 결정 없음)
- 메모리: `reference-frontend-uat`에 "Date 고정 가상 장중 UAT(page.clock 회피·SW block·모킹 완비)" 기법 추가(reference).

# 2026-06-14 — 실시간시세 화면 표시 (freshness 라벨·라이브 인디케이터)

## Plan vs actual
- What went as planned: 2 슬라이스(S1 훅 lastUpdated 노출, S2 헤더 freshness 라벨+라이브 배지+타임스탬프) 그대로. "15분 지연" 2곳 교체, krFreshnessLabel node 2/2, 빌드 OK, 가상 UAT(개장/마감 분기) PASS. main 053be223 배포.
- Divergences: **낮음.** 라벨 로직을 훅이 아니라 marketHours 함수+컴포넌트가 직접 계산(훅은 lastUpdated만) — 계획대로. 특이 분기 없음.

## Learnings
- Do differently next time:
  - **백그라운드 자동화는 "가시적 상태"를 함께 설계** — Phase 3 자동폴링은 조용히 도는데(part1) 화면엔 표시가 없어 "15분 지연" 거짓 라벨이 그대로 남았다. 백그라운드 갱신/잡을 넣을 땐 **라이브 배지·마지막 갱신 시각 같은 상태 노출을 같은 작업에 포함**해야 사용자가 동작을 신뢰한다(조용함 = UX 함정). 폴링(기능)과 표시(UI)를 part1/이번처럼 나누면 표시가 누락되기 쉬움 — 다음엔 기능에 표시를 묶기.
  - **freshness/소스 표기는 데이터 소스별로 정직하게** — KR(키움 실시간)·US(yfinance ~15분 지연)가 섞인 화면에 단일 "실시간"은 거짓. 소스가 다르면 마켓별 명시("KR 실시간 · US 15분 지연"). 소스 혼합 화면의 신선도 라벨은 항상 소스 단위로 쪼개 확인.
  - **시간 게이팅 UI는 part1 가상 UAT 하니스를 그대로 재사용** — Date 고정+SW block+/api 모킹으로 "개장 시 라벨A/배지점멸, 마감 시 라벨B/정적점"을 휴장일에도 검증. [[reference-frontend-uat]]의 패턴이 폴링·라벨 양쪽에 재사용돼 정착. 시간 의존 UI는 이 하니스로.

## Doc updates
- CONTEXT.md promotion: none (새 도메인 용어 없음 — freshness 표시는 UI)
- ADR added: none (UI 표기, 되돌리기 쉬움 — ADR 미달)

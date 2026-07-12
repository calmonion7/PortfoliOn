# 2026-07-12 — task#175 감사 이월 표시계층 폴리시 5건 (task#177, F19·F25·F26·F27·F28)

## Plan vs actual
- What went as planned: 5슬라이스 전건 계획대로. F19 로그인 sr-only 라벨 연결·F25 RSI rsiColor 색코딩·F26 배지 opacity 제거·F27 Leverage/Lending 초기 open·F28 MarketHub 헤더 2줄. 라이브 UAT(다크+라이트)로 전건 확인.
- Divergences:
  - `sr-only` 유틸 클래스가 CSS에 미정의였어 App.css에 표준 visually-hidden 클래스 신규 추가(계획의 sr-only 라벨 구현에 필요한 최소 추가).
  - F26에서 내 변경(opacity 제거)이 "흐리게" 코멘트를 부정확하게 만들어, SupplyBadge/InsiderBadge 코멘트도 함께 정정(내 변경이 만든 mess 정리).

## Learnings
- Do differently next time: 특별한 함정 없음 — 소규모 표시계층 폴리시. 검증 포인트만 기록: '해당 없음' 배지 대비 문제의 실제 원인은 색 토큰이 아니라 `opacity:0.5`였고, 제거 후 실측 대비 다크 6.79·라이트 6.89로 AA(4.5) 여유 통과. "대비 미달" 증상을 볼 때 색값 재설계 전에 opacity/투명도부터 의심. rsiColor는 null→`var(--text-3)` 반환이라 '—' placeholder에도 그대로 안전.

## Doc updates
- CONTEXT.md promotion: none
- ADR added: none (표시계층 폴리시, 신규 개념·결정 없음. drop 확정 F04/F05/F22는 Non-goals대로 미접촉.)

# 2026-07-08 — 컨센서스 차트 fetch 실패 복원력 (task#159)

## Plan vs actual
- What went as planned:
  - 단일 파일(`ConsensusChart.jsx`) 수정: GET 실패를 `fetchFailed`로 분리 → "일시적 연결 오류 + 다시 시도", 무음 auto-retry 1회. 백엔드·파이프라인 무변경(surgical). 빌드+vitest 52 green.
  - 라이브 실증(Playwright route-interception, 컨센서스 GET→520 강제): 연결오류·재시도 표시, '데이터 없음' 오표시 제거 확인.
- Divergences:
  - **[in-run 코드리뷰 캐치] 종목 전환 시 retriedRef 리셋 누락** — 앞 종목이 2회 실패로 retry 소진 후 다른 종목 전환 시 새 종목이 auto-retry를 못 받던 엣지. `useEffect`에서 리셋 보강(commit 0331864).

## Learnings
- Do differently next time:
  - **사용자가 "기능 오류"로 신고해도, 라이브 프로브(데이터·소스·오리진·터널 각 200 확인)로 '기능 버그 vs 일시 인프라 blip'을 먼저 가른 게 결정적이었다.** 프로브 없이 fg-ask 초기 가설(컨센서스 소스/백필)로 갔으면 멀쩡한 백엔드를 건드릴 뻔. CLAUDE.md "백엔드 이상=도커 churn/러너 먼저 의심"·"외부데이터 증상은 라이브 프로브 선행"의 재확인.
  - **일시장애를 '데이터 없음'으로 오표시하는 UX가 사용자를 오진케 했다** — fetch 실패 상태와 빈 데이터 상태를 컴포넌트가 구분해야 한다는 일반 교훈. 다른 카드에도 같은 conflation이 있을 수 있으나 이번엔 신고된 ConsensusChart만 수술(과잉 일반화 회피).
  - React 컴포넌트에서 retry 카운터를 ref로 둘 때 **의존성(ticker) 변경 시 리셋**을 useEffect에 반드시 포함(안 하면 이전 대상의 소진 상태가 새 대상에 누수).

## Doc updates
- CONTEXT.md promotion: none (새 도메인 용어 없음).
- ADR added: none (되돌리기 힘듦·놀라움 미충족 — 표준 UX 수정).

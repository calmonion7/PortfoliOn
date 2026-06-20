# 2026-06-20 — 대시보드 캐시·라이브 정합성 + 콜드 빈상태 + 정보밀도 (task#82)

> task#78 UI/UX 진단이 자동 분해한 fix 클러스터 6건(#79~84) 중 하나. 커밋 a9e45140.

## Plan vs actual
- What went as planned:
  - S1~S3 완료. `fmtKrwCompact`(억/만 축약, 전체값 title 보존) hero/KPI 적용, 관심/총 종목 KPI 보조줄. 빈상태 CTA 카피. 폴리시: HistoryTab NaN/Infinity→'—' 3경로 가드, SectorTab 시장전환 stale 차단, RecCard 추천점수 강조 약화. 라이브 UAT: PC·모바일 /portfolio 첫 진입에 그리드 5보유카드로 채워짐("없음" 해소).
- Divergences:
  - **task#78 가설이 틀렸음 — 진짜 근본원인은 다른 것**: #78 회고는 "보유종목 없음"을 *직접 API 시딩이 프론트 캐시무효화를 우회한 staleness*로 진단했다. 그러나 #82 규명 결과 진짜 버그는 **`tab` 기본값 'dash'인데 `fetchDashboard()`가 탭 클릭 시에만 호출돼 /portfolio 첫 진입 시 그리드가 빈 채로 남던 마운트 fetch 누락**이었다(헤더 KPI=라이브 stocks, 그리드=캐시). 수정: 마운트 useEffect `fetchDashboard()` + 헤더 N인데 그리드 빈 경우 `dashHealedRef` 1회 가드 self-heal.
  - **LendingSection 빈토글 근본원인도 가설과 달랐다**: 미지원 `badge` prop을 SectionCard에 넘겨 묵살되던 것 → `summary` prop으로 교정(접힌 헤더에 차입 요약 노출). "PC 수급지표 빈화면" finding의 실체.
  - **Reports '중복 필터' finding은 오판이었음**: pc.css 가시성 매트릭스 확인 결과 어느 breakpoint·view에서도 사이드바/메인 중 하나만 display — 실제 동시표시 없음. task#78 시각 단독 발견이 DOM만 보고 오판(CSS 가시성 미반영). 보수적 보존(제거 시 PC 목록뷰 필터 소실 회귀).
  - S2 콜드 스켈레톤은 #81에서 처리됨으로 위임.

## Learnings
- Do differently next time:
  - **시각 진단의 "근본원인 가설"은 코드 규명 전까지 가설로만 취급** — #78이 staleness로 본 것이 실제론 마운트 fetch 누락, 빈토글이 실제론 prop 묵살, 중복필터가 실제론 CSS로 차단됨. 3건 다 시각 캡처가 추정한 원인과 코드의 진짜 원인이 달랐다. 시각 발견 → 코드 규명 → 수정 순서를 지킬 것.
  - **DOM 중복 ≠ 시각 중복**: 같은 컴포넌트가 사이드바/메인 양쪽 DOM에 있어도 CSS 가시성 매트릭스가 하나만 display하면 시각 문제 없음. 시각 감사는 DOM 존재가 아니라 렌더 가시성을 봐야 한다.
  - **지원 안 하는 prop은 조용히 묵살된다**(SectionCard `badge`) — 컴포넌트에 prop을 넘기기 전 그 prop을 실제로 받는지 확인. 묵살이 "빈 토글"처럼 보였다.

## Doc updates
- CONTEXT.md promotion: none
- ADR added: none
- 기타: 대시보드 라이브-vs-캐시 정합성은 기존 CONCERNS #5/#7과 동류이나, 이번 진짜 원인은 캐시가 아니라 마운트 fetch 누락이라 신규 concern 불필요(이 회고에 기록).
- 후속 후보: Reports 필터를 공통 호스트로 끌어올려 DOM 중복 제거(현재는 CSS가 차단), utils.js `fmtPrice`의 '₩NaN' 근원 가드.

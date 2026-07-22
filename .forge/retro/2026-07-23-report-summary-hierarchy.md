# 2026-07-23 — 리포트 상세 정보 위계: 가격 레벨 이중 표시 제거 + 지표 탭 과밀 완화 (일괄 승급 사후 회고)

2026-07-04 실행·봉인(fg-done all), run.md 기반 사후 회고.

## Plan vs actual
- What went as planned: `PriceLevelChart`에 `chartOnly` prop, 요약 탭 중복 제거; 지표 탭 안쪽 서브탭을 세그먼트 토글로 재스타일해 위계 구분.
- Divergences: ① '세로 차트'와 '지지/저항 리스트'는 별도 컴포넌트가 아니라 `PriceLevelChart` 하나 안의 flex 2단이었음 — 공유 컴포넌트라 전역 삭제 대신 opt-in prop("configurability 회피" 원칙과 충돌 시 요청 스코프 우선). ② 과밀 완화는 IA 통폐합이 아니라 시각 언어 구분으로 최소 침습.

## Learnings
- Do differently next time: **탭 key와 라벨 불일치 주의 — key `analysis`=라벨 '📈 지표', key `report`=라벨 '📝 심층분석'** (ReportDetailTabs). 이름으로 파일/키를 추정하면 엉뚱한 탭을 편집한다.
- 공유 컴포넌트의 한 소비처만 부분 제거할 땐 opt-in prop이 정답일 수 있다 — 원칙끼리 충돌하면 요청 스코프가 우선.

## Doc updates
- CONTEXT.md promotion: none.
- ADR added: none.

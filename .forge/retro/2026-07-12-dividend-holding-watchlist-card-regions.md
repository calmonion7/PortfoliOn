<!-- forge-slug: dividend-holding-watchlist-card-regions -->
# 2026-07-12 — 배당 탭 보유/관심 Card 박스 영역 분리 (task#181)

## Plan vs actual
- **계획대로(발산 0)**: `Dividends.jsx` `DividendSection`을 muted 텍스트 헤더 → `Card padding="none"` 박스(제목 '보유'/'관심' + `DividendRow` 목록)로 교체. 라이브 UAT 모바일+PC로 보유14/관심60 박스 2개·보유 최상단 확인, 83658fc 배포.

## Learnings
- Do differently next time: 특별한 함정 없음 — task#180(헤더 분리)의 시각 강화 리파인. 기존 `Card` 프리미티브의 `padding="none"`로 행(자체 padding 보유)의 이중 패딩 없이 박스화하는 패턴이 깔끔.
- 관찰: 사용자 스크린샷이 task#180 배포 후에도 옛 flat 리스트였던 건 PWA 캐시(서빙 번들 해시=로컬 빌드 해시로 라이브 확인). "배포했는데 화면에 반영 안 됨" 류는 PWA SW 캐시부터 의심(하드 새로고침 안내).

## Doc updates
- CONTEXT.md promotion: none
- ADR added: none (UI 스타일 리파인, 신규 개념·결정 없음)

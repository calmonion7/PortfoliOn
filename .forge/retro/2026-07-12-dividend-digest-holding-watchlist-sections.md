<!-- forge-slug: dividend-digest-holding-watchlist-sections -->
# 2026-07-12 — 배당 + 다이제스트 종목뉴스 보유/관심 섹션 분리 (task#180)

## Plan vs actual
- **계획대로(발산 낮음)**: 2슬라이스 모두 프론트 전용. S1 `Dividends.jsx` items를 `stock_type`으로 보유/관심 `DividendSection` 2개. S2 `Digest.jsx` '종목 뉴스'를 `digest.stocks`의 `is_holding`으로 파생 분리(모듈레벨 `NewsItem`), 하단 종목시세 리스트의 '보유종목/관심종목' 헤더 패턴 재사용. 백엔드 무변경. 라이브 UAT: 배당 보유14/관심60·뉴스 보유10/관심38(미매핑 0), 97cad2b 배포.
- Divergences: 실질 없음.

## Learnings
- Do differently next time: 특별한 함정 없음 — 데이터에 scope(`stock_type`/`is_holding`)가 이미 있어 UI 그룹핑만 추가한 additive 작업.
  - **기록해 둘 엣지(미발현)**: 다이제스트 뉴스 scope를 프론트에서 `digest.stocks.is_holding`으로 *파생*하는데, 보유 종목이 뉴스는 있으나 다이제스트 생성 시 라이브 시세 실패로 `digest.stocks`에서 누락되면(quote None→stocks_list skip) 그 뉴스가 방어적으로 '관심'에 분류될 수 있다. 정확도가 중요해지면 `_recent_news`가 `is_holding`을 항목에 stamp하는 ~2줄 백엔드 보강이 근본 해법(이번엔 Non-goal로 미적용, 48건 전부 정상 매핑).
  - **additive UI 그룹핑 검증 = API ground truth ↔ DOM count 대조가 효과적** — 렌더 섹션별 행/항목 수를 API 응답의 보유/관심 카운트와 대조(미매핑=total−mapped=0)해 "리스트가 조용히 누락/오분류" 회귀를 정적 스크린샷 없이 잡음(fixture-pass-live-fail 계열 대비).

## Doc updates
- CONTEXT.md promotion: none (보유/관심 기존 용어)
- ADR added: none (UI 그룹핑, 되돌리기 쉬움·신규 개념 없음)
- 기타: 뉴스 파생 엣지는 retro-log 수준(미발현·후속 후보). 실제 클로버/오분류 발생 전엔 CLAUDE.md 승급 불요.

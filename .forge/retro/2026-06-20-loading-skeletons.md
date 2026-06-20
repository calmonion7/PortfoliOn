# 2026-06-20 — 로딩 스켈레톤 도입 (전 화면 LoadingSpinner 단독 제거) (task#81)

> task#78 UI/UX 진단이 자동 분해한 fix 클러스터 6건(#79~84) 중 하나. 커밋 5017998b.

## Plan vs actual
- What went as planned:
  - S1~S4 완료. `components/ui/Skeleton.jsx`+`Skeleton.css` 신설(variant=card/row/chart/calendar 7×5/stat/text, props count/lines/height, `@keyframes skeleton-pulse`, `prefers-reduced-motion: reduce`에서 off, 디자인 토큰만). 리스트/카드/차트/캘린더/분석 화면의 LoadingSpinner 단독 반환을 레이아웃 흉내 스켈레톤으로 교체(CLS 해소). 로그인 버튼 인라인 스피너.
- Divergences:
  - **적대리뷰 major 1건**: Reports 메인 목록이 `variant="card"`였으나 실제 `.stock-card-grid`는 flex-column 세로 리스트라 형태 불일치 → 오히려 CLS 유발. `variant="row" count={8}`로 교체(세로 리스트 일치). **스켈레톤은 "있다"가 아니라 "실제 레이아웃 형태와 일치"해야 효과**.
  - **스켈레톤 대비 상향(후속 결정)**: 초기 채움색(`--surface-hover`/`--bg-elev-2`)이 흰 카드 위에서 거의 안 보여 빈 박스처럼 읽힘 → `--border-strong`(양 테마 가시)으로 변경. 공간 예약(CLS)은 됐으나 "로딩 중" 신호 가시성을 따로 확보해야 했다.
  - DashboardCard.jsx는 단일 item 렌더라 자체 로딩 분기 없음 → 미변경(힌트 '필요시' 미해당).

## Learnings
- Do differently next time:
  - **스켈레톤 variant는 실제 렌더 레이아웃(세로 리스트 vs 카드 그리드)을 확인 후 매칭** — 형태가 어긋나면 CLS를 줄이는 게 아니라 오히려 더한다.
  - **스켈레톤 채움색은 베이스 surface 위에서 가시성을 따로 검증** — 토큰을 무심코 쓰면 흰 카드 위에서 안 보여 "로딩 중" 신호가 죽는다.
  - **헤드리스 UAT는 스켈레톤을 잡기 어렵다** — warm 데이터는 700ms 내 풀로드라 정적 캡처에 안 잡힘. 콜드캡처 1회차에서 시장 섹션 스켈레톤만 포착됨. 펄스 애니메이션·reduced-motion은 모션이라 캡처 불가 → CSS 코드로 검증(task#78 회고의 헤드리스 제약과 동류).

## Doc updates
- CONTEXT.md promotion: none (구현 디테일)
- ADR added: none

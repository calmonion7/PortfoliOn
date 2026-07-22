# 2026-07-23 — 에디토리얼 리디자인 3/5: 핵심 화면(리서치·리포트 상세·포트폴리오) (일괄 승급 사후 회고)

2026-07-17 실행·봉인(fg-next all auto-skip), run.md 기반 사후 회고.

## Plan vs actual
- What went as planned: `SectionTitle` 공용 1곳 업그레이드로 20+ 섹션 일괄 전파(지렛대), FinancialsChart hex→토큰, totals useCountUp(FlashValue와 책임 분리), 대시보드 가드(task#102/#104) 무접촉. 병렬 3 에이전트 파일 스코프 분리 충돌 0.
- Divergences: ① (계획 갭) **추천·비교 화면이 3·4파트 어느 슬라이스에도 없었음** — Goal "전 하위 화면"에 따라 현장 편입. ② (리뷰 포착) useCountUp 원샷 플래그가 데이터 도착 전 0→0으로 소진돼 실제 카운트업이 안 보임 → `hasFetched` 게이트. ③ 스모크 fail 1건(/api/events 502)은 로컬 preview 하니스 아티팩트 — curl 재현으로 앱 무결 확정.

## Learnings
- Do differently next time: **"첫 진입 1회" 모션은 '마운트 1회'가 아니라 '첫 유효 데이터 도착 1회'로 게이트** — 비동기 화면에서 마운트≠데이터(0→0 소진). **파트 분할 계획은 화면 인벤토리를 exhaustive하게 나열**(집합 표현 "전 하위"는 슬라이스 목록과 대조 검증). 스모크 fail은 라이브/curl 대조 전 앱 결함으로 단정하지 않기.
- 공용 컴포넌트 1곳 업그레이드→다수 화면 전파는 리디자인의 최적 지렛대(SectionTitle 사례).

## Doc updates
- CONTEXT.md promotion: none.
- ADR added: none.

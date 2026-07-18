# 2026-07-18 — 비교 탭 하단 고정 선택바 (task#200)

## Plan vs actual

- What went as planned: S1(선택바 구현·vitest 91 green)·S2(빌드·배포·라이브 프로브 exit 0) 전부 계획 구조대로. retro#195/#196의 함정(조상 transform·프로브 표준)을 계획 단계에서 미리 반영한 덕에 막힌 곳 없음. 커밋 2802875.
- Divergences (경미 재량 2건): ① CSS를 mobile.css/pc.css가 아닌 신규 `Compare.css`로(컴포넌트 CSS 관례 — LoginPage.css 등 기존 선례). ② full-width 바 대신 플로팅 라운드 카드(max-width 680) — tabbar flush 정렬 이슈 회피, 모바일/데스크톱 공용에 자연스러움.

## Learnings

- 과거 retro의 재발 방지 규칙(fixed 조상 transform 금지, 스크롤 전후 rect 불변 프로브)을 그릴링 때 계획의 Source of truth에 명시해두면 실행이 순탄하다 — 규칙이 실제로 작동한 사례로, 새 학습은 없음.

## Doc updates

- CONTEXT.md promotion: none (도메인 용어 아님).
- ADR added: none (비가역 결정 없음 — 가역적 UI 스타일 재량).

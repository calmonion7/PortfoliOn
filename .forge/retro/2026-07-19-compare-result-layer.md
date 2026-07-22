# 2026-07-19 — 비교 탭 결과 레이어(모달) 전환 (task#202)

## Plan vs actual

- What went as planned: S1(모달 전환·인라인 제거·락 훅 배선)·S2(배포·라이브 프로브 exit 0) 전부 계획대로. 커밋 522c9e2.
- Divergences (경미): `compare-race.test.jsx`가 인라인 표를 단언해 파손 — 계획의 "필요 시 마이그레이션" 범위 내에서 "비교 보기" 클릭 후 단언으로 수정.

## Learnings

- UI 표면을 옮기는 작업(인라인→모달)은 그 표면을 단언하는 기존 테스트 파손이 *예상 결과*다 — 그릴링 때 "필요 시 마이그레이션"을 DoD에 미리 적어두면 실행 중 파손이 괴리가 아니라 계획 내 처리로 정리된다.
- retro#195(모달 커버 프로브)·#196(공용 락 훅) 규칙이 이번에도 그대로 적용돼 순탄 — 기존 규칙 재사용, 신규 학습 없음.

## Doc updates

- CONTEXT.md promotion: none. ADR added: none.

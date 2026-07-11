# 2026-07-11 — 디자인 리뉴얼 2/5: 앱 골격 — 좌측 사이드바 + 개별 라우트 승격 (task #172)

## Plan vs actual

- What went as planned: S1~S4 전부 MET — Sidebar 5섹션(접이식·권한 게이트·활성 하이라이트)+TopNav 폐지, 13라우트 승격+구 URL 리다이렉트+딥링크 소비처 전수 갱신(task#131 계약 보존), MobileNav 프리픽스 그룹 활성 판정, 라이브 스모크(PC+모바일) 통과. 적대 리뷰 2렌즈 확정 결함 0, vitest 69 green. "중간 빌드 금지" 하드 규칙 준수(빌드는 메인 세션 최종 1회).
- Divergences (경미, 전부 실행 재량 결정):
  - 허브 이관은 얇은 공용 래퍼 `ResearchShell`(모바일 필 nav 집중, PC 필 숨김) + 라우트가 탭 컴포넌트 직접 렌더. `Research.jsx` 삭제.
  - 모바일 하단바는 5키+admin 유지(동선 보존 선택) — 리서치 탭 필 7개가 일정·인컴 3화면까지 커버(동일 research 권한이라 정합).
  - PC에서 `nav_research` 이벤트 발화처 소멸(사이드바는 항목 단위 tab_* 발화, 모바일 하단바는 유지) — 화이트리스트 위반 아님, 집계 해석만 미세 변화.
  - **(스모크 오탐 2건)** "사이드바 12링크 전부" 하드코딩 단언이 settings 권한 없는 테스트 계정에서 실패 — 실은 권한 게이트 정상동작. `/api/auth/me` 대조로 오탐 판정.

## Learnings

- Do differently next time:
  - **권한 게이트 UI의 스모크는 계정 실권한으로 기대값을 유도하라** — 전 항목 노출을 하드코딩 단언하면 권한 제한 계정에서 오탐이 난다. `/api/auth/me`를 먼저 읽어 기대 링크 집합을 계산하고, 권한 없는 항목은 "숨김"을 정단언(게이트 검증을 겸함). fixture-pass-live-fail 가족의 스모크판(계정-종속 기대값).
  - **강결합 슬라이스(같은 파일을 여럿이 만짐)는 병렬 분할 대신 단일 구현 에이전트로 묶기** — S1~S3이 전부 App.jsx 중심이라 단일 에이전트 순차 처리가 충돌 0·핸드오프 비용 0으로 적중. 워크플로우 설계 시 슬라이스 경계보다 파일 접촉면으로 병렬성을 판단.
  - **열린 follow-up(경미)**: ① GlobalSearch.jsx:12 stale 주석(삭제된 TopNav 언급) ② route-redirects.test.jsx가 App.jsx 라우트 테이블을 import하지 않고 매핑 로컬 재현(회귀보증 불완전) ③ 3/5 진행 시 `.util-bar`·ResearchShell PC 헤더는 재스타일 대상에 포함.

## Doc updates

- CONTEXT.md promotion: none (스모크 기대값·에이전트 묶기 — 프로세스 학습).
- ADR added: none (방향 결정은 ADR-0025에 기록돼 있고 이번은 그 실행).

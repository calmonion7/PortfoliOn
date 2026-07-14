# 2026-07-14 — 프론트엔드 로깅 규약 문서화 + 이탈 2건 정리 (task#185)

## Plan vs actual
- What went as planned:
  - S1: 순수 이탈 2건 정리 — `Analytics.jsx:281`(마커 `[Analytics]` + 한국어화, graceful라 `.warn` 유지), `PermissionPanel.jsx:66`(마커 `[PermissionPanel]` 추가, 폴백 없는 mutation 실패라 `.error` 유지). `frontend/src` 전체 `console.warn`/`console.error` 10건 모두 `[모듈/훅명]` 마커로 시작(무마커 grep 0 — 봉인 시 재확인).
  - S2: `.forge/codebase/CONVENTIONS.md §4`에 프론트 로깅 하위절 추가(마커=소스 모듈/훅명, 레벨 의미, 자동 가드 부재 명시) + `CLAUDE.md` 로깅 gotcha에 프론트 포인터 1줄.
  - 검증: `npm run build` 클린 · `vitest run` 77 passed · 제어플로 무변경(로그 문자열만). commit 582ee87 push·배포.
- Divergences:
  - 워크플로우 미사용(직접 실행) — 문서 1절 + 코드 2줄 규모라 Dynamic Workflow 과함. fg-run "단일 에이전트 규모면 직접 처리" 제약에 따른 정당 이탈, 슬라이스는 전부 이행.
  - 이탈 건수 3→2 정정 — fg-ask 초기 "3건"은 착오, 순수 이탈은 2건(나머지 8건 이미 준수). 그릴링 단계에서 잡혀 계획엔 2로 반영됨 → 실행 이탈 아님.

## Learnings
- Do differently next time:
  - **프론트 로깅 규약엔 자동 가드가 없다(인수된 갭)** — 백엔드는 `tests/test_no_print.py`가 pytest=검증루프에 들어가 `print` 신규를 자동 차단하지만, 프론트는 `vite build`·`deploy.sh`·CI 어디에도 lint가 안 걸려 eslint `no-console`를 넣어도 죽은 가드다. 그래서 §4는 **관례+리뷰 의존**으로만 강제된다. 향후 강제하려면 "규칙 추가"가 아니라 **lint를 build/deploy/CI에 먼저 배선**하는 게 선행 조건 — 순서를 헷갈리지 말 것.
  - 후속 후보(비착수): `PermissionPanel` 저장실패 시 사용자 토스트 피드백 — 별개 UX 작업. 이번엔 로그 마커만 붙였고 사용자 대면 피드백은 없음.

## Doc updates
- CONTEXT.md promotion: none (신규 도메인 용어 없음 — 구현 관례라 §4가 정본, 글로서리 대상 아님)
- ADR added: none (LOG-ONLY·가역, 백엔드 로깅 규약 task#162/#163의 프론트 미러 — 새 결정 아님)

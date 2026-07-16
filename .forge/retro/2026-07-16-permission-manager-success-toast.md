# 2026-07-16 — PermissionManager 무음 성공 경로 2곳에 success 토스트 (task#189)

## Plan vs actual
- What went as planned: 단일 슬라이스, 워크플로우 없이 직접 실행. `PermissionManager.jsx`의 `saveBulk`·`deleteUser` 성공 경로에 `showToast(msg, 'success')` 추가. 인라인 "저장됨" 2곳·실패 토스트 무변경(Non-goal 준수). commit `a186e61`+push+빌드 라이브, vitest 79 무회귀·빌드 클린.
- Divergences(코드): 없음(계획=실제, 2줄 additive).
- Divergence(검증 기법): 라이브 UAT에서 `page.route` API mock이 안 먹혀 몇 번 반복 진단 필요 → 원인은 PWA 서비스워커(아래).

## Learnings
- Do differently next time:
  - **PWA 서비스워커가 `page.route` mock을 우회한다 — 브라우저 UAT에서 API를 mock하려면 `serviceWorkers: 'block'` 필수**: 이 앱은 vite generateSW PWA라, **SW 활성화 이후 발생하는 fetch**(예: 페이지 마운트 뒤 호출되는 `/api/admin/users`)는 SW가 가로채 Playwright의 `page.route` 인터셉트를 우회하고 실서버로 나간다(그래서 mock 대신 403 실응답이 떴다). 반면 **첫 로드 시점 호출**(`/api/auth/me` — AuthContext가 SW 활성 전에 부름)은 정상 mock된다 → task#188이 auth/me만 mock해서 우연히 안 걸렸던 이유. **해결: `browser.newContext({ serviceWorkers: 'block' })`**(전 요청이 Playwright 라우팅을 타게). 증상 특징: `page.on('request')`엔 요청이 찍히는데 `page.route` 핸들러는 안 불리고 실서버 상태코드(403 등)가 온다. **사실 이 규칙은 `reference-frontend-uat` 메모리에 이미 있었으나 "가상 장중 UAT" 시나리오 하위에 묻혀 있어 못 알아채고 재진단으로 헤맴 → 일반 규칙으로 끌어올려 승급**(API mock UAT는 SW 차단이 기본). 교훈: UAT 짤 때 그 메모리의 SW 항목부터 확인.
  - **파괴적 admin 동작(사용자 삭제·일괄 권한 변경) UAT는 프로덕션 DB에 실행 금지 — 엔드포인트를 mock 성공으로 인터셉트 + 가짜 유저**로 프론트 피드백만 검증한다(실 DELETE는 mock 200, 실데이터 무변경). 순수 프론트 변경(토스트 추가)이라 이 방식이 faithful.
  - **비례 검증**: 2줄 additive 성공 토스트는 앱 전역 프로덕션 success 토스트 17곳으로 렌더 메커니즘이 이미 검증됨 + 같은 파일 대칭이라, 삭제 경로 1개만 라이브 구동하고 벌크는 대칭 커버로 판단(벌크 EditPanel UI 구동은 비용 과다). 단, vitest는 `showToast`를 mock하므로 "실제 토스트가 초록으로 뜨는지"는 못 잡는다(fixture-pass-live-fail) → 라이브 DOM 측정(text+`--color-success` rgb)이 그 갭을 메움.

## Doc updates
- CONTEXT.md promotion: none (신규 도메인 용어 없음)
- ADR added: none (가역 UX·기법, 신규 결정 없음)
- 기타: SW↔page.route 함정을 `reference-frontend-uat` 메모리에 승급(교차세션 UAT 방법에 직접 해당). CLAUDE.md/CONCERNS 승급은 불요(프로젝트 규약이 아니라 UAT 하니스 팁 — 메모리가 적정 홈).

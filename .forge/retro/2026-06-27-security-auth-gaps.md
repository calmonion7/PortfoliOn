# 2026-06-27 — 보안 무인증 엔드포인트 인증 추가 + refresh token 회전 (task#108)

## Plan vs actual
- What went as planned: 6건 모두 증거 기반 인증 매핑대로 수정(①②⑤ get_current_user·③ require_admin·⑥ require_admin_or_api_key·④ consume_refresh_token 1회용). 직접 실행(워크플로우 불필요). pytest 886 green(신규 7건). API_SPEC 6섹션 갱신.
- Divergences (낮음):
  - **기존 자체-app 테스트 3건이 깨짐**(예측된 가토): `test_consensus_router`가 get_current_user override 없어 backfill 401, `test_stocks_router` enrich가 require_admin_or_api_key override 없어 403 → 각 override 추가로 보정.
  - **CLAUDE_COWORK_API.md 무변경**: enrich를 이미 X-API-Key 인증으로 명시 — api-key 경로 불변이라 정확(일반 JWT만 차단). 계획보다 문서 1개 덜 손댐.
  - ④ 구현을 handler-revoke 대신 consume 내부 DELETE로 — 모든 호출자 보호(계획의 두 옵션 중 후자).

## Learnings
- Do differently next time:
  - **엔드포인트에 auth Depends를 추가/변경하면 그 경로를 호출하는 *자체-app 테스트*를 전수 grep해 새 의존성 override를 선제 추가하라.** 다수 테스트가 conftest `client`가 아니라 모듈 상단에서 `FastAPI()`+`dependency_overrides`로 auth 우회(`test_stocks_router`·`test_consensus_router`). conftest는 main.app의 get_current_user만 override → 자체-app엔 안 걸림. additive-mock 오염(CONCERNS §14)의 dependency-override 사촌.
  - **무인증 거부(401/403)는 override 없는 fresh app으로 검증**(`test_security_auth_gaps.py` 패턴) — auth를 우회하는 일반 테스트로는 무인증 경로를 못 탄다.
  - **인증 레벨은 호출처가 결정**: UI 버튼(일반 사용자)=get_current_user, UI 없는 유지보수=require_admin. 보안 수정 = 무인증 막기지 권한 등급 상향(UX 변경) 아님 — fg-ask에서 프론트 grep으로 호출처를 먼저 확인해 레벨을 못박은 게 효과적이었다.

## Doc updates
- CONTEXT.md promotion: none (새 도메인 용어 없음)
- ADR added: none (인증 추가는 쉽게 가역 — 결정 아님)
- CLAUDE.md: additive-mock 가토 옆에 "auth Depends 추가가 자체-app 테스트 깨뜨림 — override 전수 보정 + 무인증은 fresh app 검증" 가토 추가(task#108).

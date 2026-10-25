<!-- forge-run: lens-source-disclosure-affordance -->
# RUN — 렌즈 원자료 접힘 어포던스 (task#407)

실행 방식: fg-run 워크플로 없이 직접 구현(커밋 5346315, dev). 승격 시점에 구현이 이미 끝나 있어 재실행하지 않고 검증만 기록했다.

## 슬라이스 결과
- S1 `InputsTable` summary → `출처 보기 · 원자료 N건 ⌄/⌃`, 「상세」와 같은 글자 스타일, minHeight 44, `<details onToggle>` — ✅ as planned
- S2 vitest 단언 추가(문구·`⌄`→`⌃`, `details.open=true` 후 toggle 직접 dispatch) — ✅ as planned
- S3 dev 커밋+push, Deploy run 40175164826 headSha=5346315 success, 360px 스크린샷 2장(`screenshots-task407/closed.png`·`open.png`) — ✅ as planned
- S4 dev→main PR — ⚠ 미실시(사람 몫으로 합의; PR 생성·머지는 사람이 한다)

## DoD baseline → after
- 1. AnalystReport+lens10 vitest: 53/53(새 단언 없음) → 62 passed(새 단언 포함)
- 2. dev 360px 스크린샷: 없음 → 2장. summary·「상세」 모두 fontWeight 600, rgb(90,81,66), 높이 44, 넘침 없음. 펼치면 `⌃`
- 3. PR URL 전달: 미완(S4)
- 회귀: 프론트 전체 1144 통과, 백엔드 2629 통과

## 분기
- fg-run/워크플로를 거치지 않고 fg-loop 안에서 직접 구현함(절차 이탈, 결과는 동일).
- 화살표 `⌄`가 육안으로 「상세」와 같은 모양인지는 사람 확인 몫.

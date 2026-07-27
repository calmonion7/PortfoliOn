# 2026-07-27 — 자동 발행 대상 관리 전역 지정 목록 노출·해제

일괄 승급 회고(2026-07-28) — 학습 출처: 아카이브된 `run.md`.

## 계획 대비 실제
- 계획대로: `GET /api/admin/analyst-targets`(전역, `require_admin`) 신설 + 프론트가 파생(`stocks.filter`) 대신 이 API로 목록을 채우고 `미보유` 라벨 교차 판정. pytest 1333 · vitest 126 · 배포 후 401/403/401 게이팅 확인.
- 이탈 3건 — 아래 학습 참조. 남은 것: **S3 라이브 검증은 admin 계정 필요(사용자 조작)**.

## 학습
- **계획 단계에서 README DoD를 놓쳤다** — 목록이 "보유·관심 지정"에서 "전역 지정"으로 바뀌자 README 123행이 stale해졌다. 프로젝트 규칙(기능 표면 변경 시 README 해당 절 갱신)은 Source of truth에 API_SPEC만 적어도 걸린다. **화면 문구·범위를 바꾸는 슬라이스는 계획에 README 절을 명시**할 것.
- **catch-all mock은 신규 엔드포인트를 조용히 삼킨다** — vitest `beforeEach`가 "특정 URL이 아니면 전부 STOCKS 반환"이라, 신규 `/api/admin/analyst-targets` 호출이 STOCKS를 받아 목록에 엉뚱한 2행이 뜨고 `getByText('해제')`가 다중 매치로 깨질 상태였다(사전 포착) → URL 분기 헬퍼로 교체. CLAUDE.md "엔드포인트 추가는 호출 시퀀스도 늘린다" 가토의 **프론트 mock판**: 프론트에 fetch를 추가할 땐 기존 mock의 fallback 분기를 먼저 볼 것.
- **자체-app 테스트의 auth override는 의존성 종류별로 필요하다** — 기존 파일이 `require_admin_or_api_key`만 override하고 있어 신규 `require_admin` 엔드포인트가 401로 깨질 상태였다(CLAUDE.md auth-override 가토 그대로 재현).

## 문서 갱신
- **CLAUDE.md Gotchas 승급**: admin 표면 UAT 제약(사용자 승인, 일괄 승급 2026-07-28 — #214와 공동 사례).

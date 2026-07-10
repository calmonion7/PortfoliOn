# 2026-06-14 — 티커 형식 검증 추가 + 공백결합 오염 row 1건 정리

## Plan vs actual
- What went as planned:
  - S1 — `services/utils.is_valid_ticker` + 정규식 `^[A-Za-z0-9.\-]{1,15}$` 공유 헬퍼 1곳 정의 후 `Stock`·`WatchlistStock`에 pydantic `field_validator`(strip·upper 후 검증, 불일치 422). 단위 27 + 회귀 521 PASS. 배포 `2d05192e`.
  - S2 — 감사 결과 전체 123건 중 오염 1건(공백포함=규칙불일치=동일 row, `"AAPL MSFT NVDA GOOGL …"`). DELETE 1, cascade로 user_stocks·snapshots 동반 제거. 재검증 total 123→122, bad 0, 자식테이블 공백포함 0.
- Divergences (모두 additive·소규모):
  - validator가 검증만이 아니라 **정규화 값(strip+upper)을 반환**하도록 함 — 다운스트림이 이미 전부 `.upper()` 비교라 멱등·무회귀. 계획 의도 내 강화.
  - 계획 슬라이스엔 없던 **API_SPEC.md 갱신** 추가(프로젝트 표준 "API 변경 시 명세 동기" 규칙). Cowork 문서는 해당 엔드포인트 미수록이라 변경 없음.
  - 조건부 코드리뷰: ~30 LOC·테스트 완전 커버·저위험이라 adversarial 서브에이전트 대신 인라인 self-review로 갈음.
  - S2를 처음엔 사용자 `!` 인계로 시작했으나, 사용자가 반복 부담으로 **직접 실행 권한 부여** → Bash 직접 호출로 전환·성공.

## Learnings
- Do differently next time:
  - **psql 정규식을 `!` 세션 프리픽스로 넘길 땐 `!~`(NOT MATCH) 금지** — zsh 히스토리 확장이 `!`를 가로채 "event not found". `NOT (col ~ '...')`로 우회. (psql `!` 명령 일반 적용 gotcha)
  - **`! docker compose ...`는 cwd가 프로젝트 루트여야** compose 파일을 찾음 — 아니면 "no configuration file provided". `! cd <project> && docker compose ...`로 고정.
  - **prod-write 차단은 환경/모드 의존** — `reference-prod-writes-need-user`는 auto-mode classifier 기준이고, 이 background-job 세션에선 사용자 허가 후 `docker compose exec ... DELETE`가 Bash로 차단 없이 실행됨. "항상 차단·채팅승인 무효"는 모드 한정. (메모리 정정함)
  - 데이터 정리는 카운트(total/bad/spaced) 한 줄로 존재 여부 먼저 확정 → 대상 row 육안 확인 → 삭제 순이 안전(블라인드 DELETE 회피, "wrong < missing").

## Doc updates
- CONTEXT.md promotion: none (도메인 용어 아님 — 플랜에서 이미 선언)
- ADR added: none (되돌리기 어렵+난해+트레이드오프 3박자 미충족)
- 기타: `API_SPEC.md` 422·티커 형식 제약 보강(실행 중 반영). 메모리 `reference-prod-writes-need-user`에 모드 의존성 단서 추가.

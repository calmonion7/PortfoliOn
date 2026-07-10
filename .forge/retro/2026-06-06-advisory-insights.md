# 2026-06-06 — item 11 권고성 인사이트(insights) 진입/회피 가이드 추가

## Plan vs actual
- What went as planned: 3개 슬라이스(S1 백엔드 enrich 배선 · S2 Cowork 스펙 · S3 InsightsSection 프론트), insights 스키마(stance/entry/avoid/one_liner), 배치(리포트 상세·랭킹의 RecentDisclosures 다음), Non-goals(신규 LLM 프롬프트·자동매매 없음, 기존 enrich 필드 불변) 모두 계획대로. **결과물=계획(WHAT 일치).**
- Divergences:
  - 실행방식: 워크플로우(fg-run 정석) 대신 **직접 실행** — 슬라이스 3·파일 8로 작아 워크플로우 과함(사용자 승인, CLAUDE Simplicity·fg-run "small이면 workflow 생략").
  - 작업위치: "메인 직접편집" 승인했으나 백그라운드 **isolation 가드 + classifier(.claude 설정 자가수정 차단)**가 워크트리 경로로 강제 → 코드(워크트리 branch `worktree-advisory-insights`)/forge 상태(메인 `.forge`) **split**. 이후 사용자 승인으로 커밋·main FF 머지(`172a0696`)·push.
  - **배포 순서 리스크 실현**: app_schema는 신규 스키마용. push 직후 새 backend가 `t.insights` 조회 → 운영 DB 컬럼 부재로 `get_stocks`/`get_full_portfolio`/`get_global_portfolio` 깨질 위험. 사용자 승인 후 `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` 즉시 적용해 복구(SELECT 정상, `/api/stocks` 401=정상).
  - storage 배선 범위가 플랜 명명(`_ENRICH_KEYS`)보다 넓음: 실제로 `_ANALYST_KEYS`·`_JSON_TEXT_FIELDS`·SELECT 3곳·entry 빌드 2곳 = **저장/검증/로드/전파 4계층**.
  - insights 타입: 플랜 "JSONB 또는 동일타입" → 기존 enrich와 동일 `text`(JSON 문자열 + `_JSON_TEXT_FIELDS` 역파싱)로 통일.

## Learnings
- Do differently next time:
  - **스키마 의존 코드 배포**: 자동배포(`git push origin main` = deploy) 환경에선 DB 마이그레이션을 **push 전 또는 즉시 동반** 적용. 안 그러면 스키마 의존 SELECT가 즉시 라이브되어 코어 조회가 깨짐. additive 컬럼도 예외 아님.
  - **신규 enrich 필드 = 4계층**: 저장(`EnrichBody`/`BatchEnrichItem`)·검증(`_ANALYST_KEYS`)·로드(SELECT 3 + entry + `_JSON_TEXT_FIELDS`)·전파(`report_generator` summary 2). 한 곳 누락 시 저장돼도 조회·표시 안 됨.
  - **백그라운드 작업위치 전략**: worktree isolation 가드/classifier 제약을 초반에 인지하고 커밋·마이그레이션 경로를 설계(메인 직접 편집은 가드로 막힐 수 있음). forge 상태는 항상 메인 `.forge` 유지(워크트리 `.forge`는 휘발), 코드/상태 split 시 핸드오프 명확화.

## Doc updates
- CONTEXT.md promotion: none (플랜이 신규 용어 없음 판단; insights/stance는 기존 용어 조합)
- ADR added: none (모든 학습이 process/operational; `insights=text`는 ADR 3조건 미달 — 되돌리기 쉬움·난해하지 않음)
- auto-memory: 배포순서 gotcha + 4계층 배선 + 완료 작업 포인터 기록(사용자 선택)

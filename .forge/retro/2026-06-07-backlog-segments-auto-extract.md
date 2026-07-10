# 2026-06-07 — 다중엔티티 수주잔고 segment 자동추출 + pending 보존 가드 (task 15)

## Plan vs actual
- **계획대로**: 직접 인라인 TDD(단일 파일 `backlog.py`, Dynamic Workflow 미사용). `_segments_from_susu`+`_auto_backlog_multi`(연결 요약표 회사×사업×수주잔고 분해 + `Σ==합계` 상대1% 검산) / `_upsert` segments(JSONB) + 다중엔티티 분기 / `_save_pending`(추출 실패 시 기존 amount 보존) 전부 RED→GREEN. 393 passed. push `934a287e`. admin `refresh-all` 실프로덕션 재적재로 DoD 4항 전부 확정(한화에어로 6분기 dart+segments·Σ==합계 6/6, HD현대중공업·현대차 결손 llm 보존, 단위이상 0).
- **Divergences**:
  - 신규 fixture 불필요 — 기존 `fixtures/backlog/012450.html`(연결 116조) 재사용.
  - 기존 pending 테스트 2건을 `_upsert`→`_save_pending` 경로로 갱신(저장 경로 이동 반영).
  - **S4 재적재 UAT 방식 전환** — 처음엔 로컬에서 운영 postgres에 직접 붙어 `fetch_all_backlog`로 mass-write하려 했으나 **classifier가 "프로덕션 직접 mass-write"로 차단**. 읽기전용 실DART 로직 검증으로 1차 확정 후, **사용자가 admin 설정화면에서 `refresh-all`을 트리거**해 실프로덕션 재적재를 완수(읽기전용 공개 GET으로 결과 확인).

## Learnings
- Do differently next time:
  - **정정본 보고서 셰도잉은 `if raw_text:` 가드가 자가치유한다(실데이터 확인).** `_get_recent_reports`는 같은 분기에 `[첨부정정]사업보고서`(수주블록 비어 raw_text="")를 본 `사업보고서`보다 먼저 줄 수 있는데, `fetch_and_save_backlog`가 `if raw_text:` 안에서만 `seen_quarters.add`하므로 빈 정정본은 건너뛰고 본 보고서를 채택. 다중엔티티 같은 분기 다중 보고서 케이스에서 셰도잉 걱정은 불필요(단, 정정본이 수주블록을 *비지 않게* 갖고 오면 다를 수 있으니 주의).
  - **운영 postgres 직접 접근(docker exec / 외부 DSN mass-write)은 가드로 차단된다.** 데이터 적재/변경은 admin 엔드포인트(`refresh-all`)나 배치(주간 cron)로, 검증은 읽기전용 실DART + 공개 GET으로 분리. 데이터 파싱 작업의 "배포 후 재적재 UAT"는 **사용자(admin) 트리거 + 내가 읽기전용 확인** 조합으로 설계할 것.
  - **재실행이 기존 값을 파괴하지 않는가**를 데이터 적재 변경마다 점검. pending upsert가 `ON CONFLICT DO UPDATE`로 llm/dart 값을 `amount=null,source=pending`으로 매주 덮던 **잠재버그를 segment 작업 중 발견·동반 수정**(`_save_pending`: amount를 SET에서 제외 + `CASE WHEN amount IS NULL` 가드). "wrong<missing"의 짝 — "재실행이 기존 good 값을 destroy하지 않게".
  - **재적재 UAT가 또 결정적이었다(반복 교훈 재확인).** fixture+로직 GREEN 너머를 실프로덕션 재적재가 확정(Σ==합계 6/6·보존·단위이상 0). backlog 계열 retro에서 매번 반복되는 교훈 — 데이터 파싱 작업 DoD에 재적재 UAT를 항상 둘 것.
- 후속(이번 루프 밖, ADR-0005 비목표): 포트폴리오 합산 이중계상(한화에어로 연결↔한화오션 별도)·단일엔티티 다부문 분해·무형자산 '수주잔고' 중의성(현대건설).
- **후속 3건 추가 검토 결과(2026-06-07, fg-ask 순차) — 전부 defer(재탐색 금지)**:
  1. **이중계상 = moot**: 코드 전역에 포트폴리오 레벨 수주잔고 합산이 없음(BacklogChart는 per-stock). 합산 기능이 생길 때만 의미.
  2. **단일엔티티 다부문 = defer**: 복수 사업 종목은 010140(조선해양/토건)·329180(조선/해양플랜트/기타) 2개뿐. 005380(철도43)·034020(발전37)은 품목=개별계약이라 분해 시 수십 막대 무용. `Σ품목==합계` 검산은 사업/계약을 구분 못 함(둘 다 합산 통과) → brittle 임계값만 남아 비용>가치.
  3. **무형자산 중의성 = 전제 거짓 → defer**: 현대건설 백만원 라인은 무형자산이 아니라 진짜 '건설계약 수주잔고' 문장(무형자산 표는 _classify_table=None으로 이미 제외). reframe한 "건설 문장형 추출"도 빈도 스캔 결과 2종목×1분기(현대건설 2024Q4·삼성E&A 2025Q4, 연간만)뿐 — 고립 단일막대 2개·검산 부재·ADR-0002/0004 역행이라 비용 과다.
  - 교훈: **실데이터 빈도/구조 검증이 저가치 brittle 기능을 3건 연속 걸러냄**(fg-ask "explore, don't assume"의 효과). 향후 이 3건 재제안 시 위 사유로 다시 defer.
- 관측: 한화에어로 수동 llm 6분기가 이번 재적재로 `dart`+segments로 전환돼 **이제 매주 배치가 자동 유지**(수동 PUT 불필요).

## Doc updates
- CONTEXT.md promotion: none (수주잔고=연결 정본·[[사업부문 분해]]는 fg-ask 그릴링에서 이미 반영, 실행 중 신규 용어 없음).
- ADR added: **ADR-0006**(기동 시 idempotent 마이그레이션 `ADD COLUMN IF NOT EXISTS` 패턴). ADR-0005(다중엔티티 자동추출·Σ검산·pending 보존)는 fg-ask 단계에서 기작성.

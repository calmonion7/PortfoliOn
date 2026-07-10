<!-- forge-slug: recommendation-quality-1of2 -->
# 2026-07-02 — 추천 깔때기 커버리지 수리 (task#130, part 1/2)

## Plan vs actual

- 계획대로: S1~S4 전 슬라이스 TDD(red 실확인→green)로 충족. Dynamic Workflow 6 에이전트 직렬(S1→S2→S3→S4→Verify→Review, 전부 sonnet+ECO, ~485k 토큰, ~17분). 전체 pytest 1001 green(메인 세션 독립 재실행 포함), 적대 리뷰 must-fix 0. 커밋 157638c1 push→자동배포. Stage-1 개정(US 전량·tracked 무조건 통과·KR만 시총 컷), US 목표가 보강은 기존 consensus_pipeline(upsert_raw_reports→refresh_mart) 재사용으로 정본 일원화(ADR-0008) 유지, 이름 백필은 guru 캐시 carry+read COALESCE+결측분만 yfinance 1회.
- Divergences:
  1. **기동 마이그레이션 누락 — 메인 세션이 배포 전 보정**: S3가 `stock_recommendations.name TEXT`를 app_schema.sql·store INSERT에만 추가하고 `main.py _migrate`의 idempotent ALTER를 빠뜨림. 적대 리뷰도 놓침(리뷰 렌즈가 services/recommendation·registry로 좁아 배선 계층 밖). 미보정 시 배포 직후 배치 INSERT 파손. → CLAUDE.md 가토 승급.
  2. S3 범위 확장(양성): 저장 name 컬럼 신설(스키마+INSERT 인덱스 시프트)까지 — 계획의 함의, 기존 store 테스트 3건 인덱스 갱신으로 흡수.
  3. S4 registry 무수정(대조 결과 이미 정합 — 계획이 "필요시만" 허용).
  4. 리뷰 minor 4건 잔존(비차단, eco 원칙상 미수정): 람다 patch 죽은 테스트(`test_fetch_guru_tickers_returns_name_map`), S2 테스트 상단 noop `with patch... pass`, `_backfill_us_consensus` docstring-구현 미세 불일치(get_asof 예외가 외부 핸들러 의존), registry에 mart-write side effect 미문서화.
- 라이브 UAT: TDD 결정론 게이트로 verified: yes. 라이브 효과(발굴 다양성·COST/QQQ 점수·name null 0·목표가 결측 감소)는 배치 재계산 후 관측(배치-precompute 클래스, 06-18/19 리트로 선례와 동일 분리).

## Learnings

- Do differently next time:
  1. **신규 DB 컬럼 슬라이스는 "app_schema.sql + main._migrate 쌍"을 완료기준에 명시** — 에이전트 재량에 맡기면 스키마 파일만 고치고 기동 마이그레이션을 빠뜨린다(low_liquidity·exchange 선례는 지켰던 쌍). 배포파손급·컬럼 추가 task마다 재발 가능 → CLAUDE.md Gotchas 승급(사용자 확인).
  2. **적대 리뷰 렌즈에 "배선 계층"을 포함시킬 것** — 리뷰 범위를 변경 파일(services/*)로 좁히면 그 파일들이 의존하는 배선(main._migrate, include_router, batch_registry)의 누락을 못 본다. 리뷰 프롬프트에 "이 변경이 요구하는 배선/마이그레이션이 전부 있는가" 렌즈를 상시 추가.
  3. 직렬 단일-파일-소유 에이전트 체인(S1→S4 모두 funnel.py 공유)은 충돌 0으로 작동 — 병렬 불가한 같은 파일 작업의 안전한 기본형.
- 관찰(후속 후보, 차단 아님):
  - 리뷰 minor 잔재물 3건(죽은 테스트·noop 블록·docstring) 정리 — fg-quick 감.
  - 첫 US 재계산은 이름·목표가 초회 fetch로 러닝타임 증가 예상 — elapsed 로그로 관찰, 허용 불가면 K 다이얼 재도입(ADR-0021 롤백 경로).
  - 보유 액션 임계 재설계는 재계산 후 점수 분포 관찰 선행(그릴링 합의로 이연).

## Doc updates

- CONTEXT.md promotion: none — [[발굴 유니버스]] Stage-1 의미는 그릴링 단계에서 이미 개정(ADR-0021 반영).
- ADR added: none — ADR-0021이 그릴링에서 작성됨. 이번 실행은 그 결정의 구현·가드 고정.
- CLAUDE.md: **"신규 컬럼 = app_schema.sql + main._migrate 쌍" 가토 추가**(사용자 확인, 배포파손급 재발 클래스).

<!-- forge-slug: recommendation-exchange-accuracy -->
# 2026-06-19 — 딥다이브 exchange 정확도: KR 추천 종목 KS/KQ 구분 (task#70)

## Plan vs actual
- What went as planned:
  - S1~S7 전 슬라이스 충족. 순수 additive `exchange`(KR=KS/KQ, US='') 관통 — 스키마/마이그레이션 → universe `_merge_universe._add` → funnel scored row → store write/read → router 3섹션 `_item`+fallback 2 → 프론트 RecCard → API_SPEC. 데이터 변환 0(Naver `stockExchangeType.code`가 이미 KS/KQ 제공, universe가 드롭하던 값 보존만).
  - Dynamic Workflow(4 에이전트, ~268k 토큰, ~7분): 백엔드 TDD 1(high) → 프론트+문서 병렬 2(low) → 적대적 리뷰 1(high). pytest **830 passed/0 failed**(신규 TDD 5 + 기존 additive 마이그레이션 4), 적대적 리뷰 **clean**(blocking 0). 커밋 2fe7e73e push.
  - UAT verified: yes — 배포 라이브(GET 응답에 exchange 키 전 섹션 존재) + KOSDAQ 247540 딥다이브 왕복(watchlist `exchange='KQ'` 정확 저장·DELETE 복원) + npm build 통과.
- Divergences (전부 양성/사소):
  1. **계획서 경로 오기**: `recommendation/{universe,store,funnel}.py`로 적혔으나 실제 `backend/services/recommendation/...`. 실경로로 진행(동작 무관).
  2. **call_args 가토 무관 확인**: S3/S5가 우려한 read 3회 호출 시퀀스 가토는 SELECT 컬럼 additive(호출 수·인자 불변)라 실제 무관 — 기존 endpoint 호출수/`call_args_list` 단언 4건 그대로 green, 추가 마이그레이션 불필요. 엔드포인트 테스트는 read를 통째 mock하므로 컬럼 추가에 무영향.
  3. **store 테스트 단언 완화**: 신규 store 테스트가 INSERT `ON CONFLICT SET`절 컬럼 정렬 공백(`exchange      = EXCLUDED.exchange`)까지 exact 단언했다 처음 실패 → `EXCLUDED.exchange` 부분문자열로 완화. 코드 SQL은 `low_liquidity` 선례 정렬 스타일 유지.
  4. **S6 더 간단**: `MarketBadge`(ui/Badge.jsx)가 이미 `exchange` prop을 소비(KS→KOSPI/KQ→KOSDAQ, else KR) → 컴포넌트 무수정, prop 전달 + 딥다이브 폴백 2 edit만. 계획이 예상한 MarketBadge 수정 불필요.
  5. **프론트 검증=빌드+라이브 UAT**: vitest/jest 하니스 부재라 S6는 단위 테스트 없이 빌드+라이브 UAT(추천 part2~4 패턴 연장, 계획적 divergence).
- 리뷰 nit(비차단): `test_run_batch_scored_rows_carry_exchange` docstring이 "KR=KS/KQ AND US=''" 검증을 주장하나 `run_recommendation_batch('KR')`이 US 후보를 걸러 005930(KS)만 단언. US='' 경로는 `test_merge_universe_carries_exchange`가 커버 → 동작 결함 아님.

## Learnings
- Do differently next time (추천/발굴 영역 후속이 직접 쓸 fuel):
  - **계획서 파일 경로는 fg-ask 단계에서 실경로로 확정**: 같은 영역 후속 계획은 처음부터 `backend/services/recommendation/...`로 적을 것(이번엔 `recommendation/`로 적혀 에이전트가 정정).
  - **공유 컴포넌트가 이미 prop을 받는지 grep 먼저**: MarketBadge가 이미 `exchange`를 소비해 S6가 2줄로 끝남. 계획 단계에서 대상 컴포넌트 시그니처를 먼저 읽으면 슬라이스 규모를 과대 추정하지 않는다.
  - **SQL 단언은 포맷(정렬 공백)에 결합 금지**: store/INSERT 테스트는 컬럼 정렬용 공백까지 exact 단언하지 말고 `EXCLUDED.<col>` 부분문자열(또는 공백 정규화)로 — 코드의 가독성 정렬을 깨지 않으면서 단언 안정.
  - **call_args/call_count 가토는 "호출 추가" 때만 경보**: SELECT 컬럼만 additive(호출 수·인자 불변)면 가토 무관. 슬라이스마다 가토 경보를 달지 말고 *신규 read/외부호출 추가* 케이스에만 한정(이번 plan이 모든 슬라이스에 가토 주의를 달았으나 실제 적용은 0건).
  - **배치-백킹 additive 컬럼은 deferred-to-live-uat 그대로**: discovery에 뜨는 실제 KS/KQ 값은 백필(KR 배치 refresh) 의존. 코드 라이브(응답 키 존재) + 딥다이브 왕복 저장으로 즉시 검증하고, 값 채움은 다음 일배치(`recommendation_kr`)/admin 수동 refresh에 위임 — 같은 영역 후속도 동일.
- 관찰(후속 후보, 차단 아님):
  - 기존 행 백필: 배포 직후 `stock_recommendations.exchange`는 NULL → 다음 `recommendation_kr`/`recommendation_us` 일배치가 KS/KQ/''로 채움. 백필 전엔 discovery 전 종목 exchange='' → 프론트 폴백으로 KR 표시(KOSDAQ 시각 구분은 백필 후). admin 수동 refresh로 즉시 백필 가능.

## Doc updates
- CONTEXT.md promotion: 없음 — [[거래소 코드]](Exchange Code)는 fg-ask 그릴링 단계에서 이미 등록됨(CONTEXT.md §거래소 코드). 이번 회고에서 추가 승급 없음.
- ADR added: none — additive 컬럼·passthrough라 가역적이고, funnel→store→read 경계는 ADR-0015가 이미 규정(놀랍지 않음), 진짜 트레이드오프 있는 대안 선택 아님 → ADR 3조건 미충족.

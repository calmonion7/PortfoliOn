<!-- forge-slug: recommendation-4of4-holdings-action -->
# 2026-06-18 — 추천 보유 액션 섹션: 추매/익절/홀딩 (task#67, part 4/4)

## Plan vs actual
- What went as planned: 3 슬라이스 전부 충족, 발산 거의 없음. Dynamic Workflow(3 에이전트, ~205k 토큰, ~8.8분) — 구현 직렬 2(S1+S2 백엔드 TDD → S3 프론트+명세) + 적대적 리뷰(high) 1. 의존 사슬(S1→S2→S3)이라 병렬 없이 직렬.
  - **S1** 신설 `backend/services/recommendation/actions.py` — `derive_holding_action(score, weight_pct, pnl_pct)` 순수 함수, 상수 `HI_SCORE=70`/`LO_SCORE=40`/`ADD_WEIGHT_CAP=10`/`TAKE_PROFIT_PNL=15`. 추매=score≥70∧weight<10(strict), 익절=score≤40∧pnl≥15, 그외 홀딩, None→홀딩+["데이터 부족"]. TDD red→green, `__init__.py` re-export. 신규 13건(경계 70/69·9.9/10.0·40/41·15/14.9 + 결측).
  - **S2** `GET /api/recommendations`에 `holdings` 키 **additive** — `get_full_portfolio` holdings → `read_recommendations(only_tickers=...)`(세 번째 read, holdings_tickers 비면 생략) + `_latest_snapshot`(저장 EOD price)·`_usdkrw_rate`(저장 FX) 재사용. 2-pass(①종목별 KRW 환산가치·pnl ②total 분모로 weight) → derive_holding_action. discovery/watchlist/as_of 불변, 요청경로 외부호출 0.
  - **S3** `Recommendations.jsx` 섹션 순서 보유→관심→발굴 재배치, 보유 섹션 최상단 RecCard+footer(액션 배지+포지션 한 줄). 신규 `ACTION_STYLE`(추매 초록/익절 앰버/홀딩 회색, 가격토큰 금지). API_SPEC 3섹션 최종형 + README 추천 행 갱신, npm build 통과.
- 검증: pytest 807 passed(메인 세션 독립 재실행) · 적대적 리뷰 critical/major 0(8 minor 전부 isReal=false) · 라이브 UAT(배포 localhost:80, test 계정): CFRHF(92.6) holding 왕복 — holdings 섹션에 action=홀딩·reasons·pnl_pct=129.05·weight_pct=100.0 전 키 populated, 정합(고점수+풀투자 100%≥10%라 추매 아님→홀딩), DELETE 복원. verified: **yes**. 커밋 35ccf83d.
- Divergences(전부 사소·additive·가역):
  - `reasons` 필드를 holdings item에도 노출(계획 S2 item은 `{action,pnl_pct,weight_pct}`만; S1이 산출하는 reasons를 함께 실음 — 일관된 additive 확장, 두 섹션 무영향, API_SPEC도 포함 갱신).
  - 2-pass weight 계산(분모 Σ KRW 환산가치 위한 선계산 — 계획 미명시 구현 디테일, division 가드 포함).
  - footer 결측 graceful 표기(둘 다 null="데이터 부족", 한쪽 null="—" — graceful DoD에 맞춘 구현).

## Learnings
- Do differently / 패턴 확립:
  - **part3 회고의 예측이 fg-run을 거쳐 part4에서 정확히 방어됨** — part3 회고가 "세 번째 read가 `call_args`(마지막 호출) 단언을 오염시킨다, fg-run이 흡수하라"를 남겼고, part4 워크플로우가 그대로 처리했다: `test_..._excludes_caller_tracked`의 discovery 단언을 `call_args_list[0].kwargs`로 마이그레이션 + `_latest_snapshot`/`_usdkrw_rate` patch로 hermetic화, 빈-stocks 기존 테스트는 세 번째 read 미발화로 보존, 신규 `..._empty_holdings_no_third_read`가 `call_count==2`로 못박음. **회고→다음 part 설계 주입→실제 회귀 차단**의 루프가 작동.
  - **두 번 검증된 함정이라 이번에 CLAUDE.md로 승격** — part3는 "범용 pytest 지식, fg-run이 흡수"로 미승격했으나 series가 끝나 더는 다음 part로 전달 불가. watchlist(task#66)→holdings(task#67) 순차 additive read로 두 번 재현·검증됐고 *다른 엔드포인트에서도 재현 가능*한 패턴이라, 비-additive reshape 가토의 "테스트판 사촌"으로 한 줄 승격(아래 Doc updates).
  - **공유 컴포넌트 추출이 회고→다음 part로 이어진 흐름 완결** — part2 회고가 RecCard 추출을 제안→part3가 추출→part4 보유 섹션이 RecCard+footer(액션 배지)로 그대로 재사용. FLAG_STYLE과 별개의 ACTION_STYLE로 KR 가격토큰 반전 트랩(b288f494) 회피.
- 관찰(후속 후보, 차단 아님):
  - **발굴 저유동성 OTC 1위 — 4파트 누적 관찰** — CFRHF(92.6)가 라이브 UAT에서도 발굴 1위. 유동성/주거래소 필터 후속 튜닝 필요(part1부터 누적).
  - 보유 N개당 `_latest_snapshot` DB 쿼리 N회 직렬 read(외부 API 아님, 기존 대시보드와 동일 패턴이라 회귀 아님). 보유 다수 시 요청당 DB 왕복 증가는 후속 관찰.
- 마일스톤: **task#67 part4/4 = 추천 기능(엔진·발굴·관심 재정렬·보유 액션) 4부작 완료.** 발굴(part1/2)·관심 재정렬(part3)·보유 액션(part4) 세 섹션이 ADR-0015 §6 per-user partition으로 한 엔드포인트에서 완성.

## Doc updates
- CLAUDE.md: **승격 1건** — "엔드포인트에 read/외부호출을 additive로 추가하면 `mock.call_args`(마지막 호출) 단언 테스트가 조용히 오염된다" 가토(비-additive reshape 가토 바로 뒤, 대응 3종: call_args_list[i] 마이그레이션 / 입력 비면 호출 생략 / call_count 못박기). task#66·67 두 번 검증 근거 명기. **CLAUDE.md는 tracked라 commit+push로 영속화**(폴러 wipe 방지).
- CONTEXT.md promotion: none ([[보유 액션]]은 이미 142행에 정의 — 이번 작업은 그 구현, 새 용어 없음).
- ADR added: none (2-pass weight·reasons 노출·graceful footer 모두 가역적 구현; 설계 경계는 ADR-0015 §5/§6이 전부 커버).
- 후속 후보: ① 발굴 유동성/주거래소 필터(part1부터 4파트 누적 관찰) ② 보유 다수 시 `_latest_snapshot` N회 직렬 read 배치화 검토.

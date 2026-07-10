# 2026-06-13 — 키움 KR 수급 대체 (Phase 2 part 3/3)

## Plan vs actual
- What went as planned: 2 슬라이스(ka10059+ka10008 병합 → fetch_trend 키움 우선+Naver 폴백) 구조대로. market_investor_trend 스키마·upsert·백필 커서 인터페이스 불변. 전체 491 테스트 통과, main 7d959055 배포. 라이브 보유율 키움=Naver 정확 일치.
- Divergences (낮음~중간):
  - **plan의 단위 spec 오기 교정** — plan은 ka10059 `amt_qty_tp=1(금액)`·"백만원→원"이라 적었으나, 기존 `market_investor_trend.foreign_net`은 Naver `foreignerPureBuyQuant`= **주식 수량(주)**. 라이브 교차검증(키움 수량 2.9M ≈ Naver 2.88M / 금액은 971,587백만원으로 전혀 다른 스케일)으로 확인 → `amt_qty_tp=2(수량)`·`unit_tp=1`로 구현.
  - **ka10008은 date 파라미터가 없음** — 외국인 보유율 백필을 cont-yn 페이지네이션(`max_items=400≈18개월`)으로. 그보다 오래된 백필 날짜는 보유율 None(순매수는 채워짐).
  - **part 2(랭킹)는 실행 중 취소** — 키움 랭킹 TR이 시가총액·ETF구분을 미제공해 UI 회귀. Naver marketValue가 더 풍부·안정이라 미채택(KIWOOM_API.md 매핑에 기록, `done/...-rankings-cancelled/`).

## Learnings
- Do differently next time:
  - **"기존 데이터가 무슨 단위/의미인가"를 새 소스 붙이기 전에 incumbent 응답으로 확정** — Phase 1의 "현직 소스 교차검증" 교훈을 값 단위/의미(수량 vs 금액)에까지 적용. 필드명(`...Quant`=수량)과 스케일을 같은 날짜로 1:1 대조하면 plan의 spec 오기를 코딩 전에 잡는다. (금액으로 갔으면 foreign_net이 ×수백 스케일로 오저장될 뻔.)
  - **키움 시계열 TR 중 date 파라미터 없는 것(ka10008 등)은 cont-yn 페이지네이션으로만 과거 도달** — dt로 점프 가능한 TR(ka10059/ka1008x 차트)과 섞어 병합할 때, 점프형은 깊은 과거를 바로 주지만 페이지네이션형은 max_items 깊이까지만. 미달 구간은 None으로 두고('wrong<missing') 핵심 소비처(스크리닝=최신일)는 항상 커버되게.
  - **키움이 항상 기존 소스보다 낫지 않다 — 대체 전 실제 응답 필드로 cost/benefit을 따져라** — 랭킹은 Naver가 시총·ETF구분까지 한 응답에 주는데 키움 순위 TR은 그걸 안 줘서 오히려 회귀. "공식 소스=무조건 대체"가 아니라 **필드 커버리지 비교**가 판단 기준. (part 1 OHLC·part 3 수급은 키움이 동등+안정이라 채택, part 2 랭킹은 미채택.)

## Doc updates
- CONTEXT.md promotion: none (새 도메인 용어 없음, [[키움 시세 소스]] 유지)
- ADR added: none (part 2 취소는 되돌리기 어렵지 않아 ADR 게이트 미달 — KIWOOM_API.md 매핑에 tracked로 기록함)

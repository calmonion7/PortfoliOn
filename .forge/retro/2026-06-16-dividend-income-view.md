# 2026-06-16 — 배당 트래킹 income 뷰 (task #52)

## Plan vs actual

- **계획대로**: S1~S7 done, 적대적 리뷰 PASS. dividends.py(US=yfinance dividendRate/yield·KR=DART alotMatter 주당배당·시가배당률, corp_code 재사용)·stock_dividends(ticker PK dedup·_migrate 런타임·app_schema)·dividend_fetch 주배치(공통·weekly)·대시보드 income 확장(yield_on_cost·expected_annual_income·포트 총계 KRW 환산, 요청경로 외부API 0). TDD, backend pytest 676, npm build OK, 라이브 DART 스모크(삼성). 19배치. Dynamic Workflow 4에이전트.
- **Divergences**:
  - **(중요·메인 세션이 포착·수정) 대시보드 응답 형태 비-additive 변경의 두 번째 소비처 회귀**: 응답을 배열→`{holdings,totals}`로 바꾸자 백엔드가 "소비처 usePortfolioData·Analytics 둘 다 갱신 필요"라 divergence로 짚었으나, **프론트 에이전트는 usePortfolioData/Portfolio/DashboardCard만 고치고 `Analytics.jsx`(상관관계 탭, 훅과 별개로 `/api/stocks/dashboard` 직접 fetch)를 누락** → `setCards(r.data)`가 객체를 배열로 취급, `cards.length`=undefined → 상관관계 탭 항상 "보유종목 없음". **적대적 리뷰도 "US 대시보드 회귀"를 좁게 봐 놓침.** 메인 세션 교차검증(`grep stocks/dashboard frontend/src`)이 포착 → `setCards(r.data?.holdings ?? r.data ?? [])` 수정·npm build 재확인.
  - yfinance `dividendYield`는 percent 스케일(fraction 아님) → ×100 없이 저장·렌더(0.02% 오표시 회피).
  - US 보유는 저장 FX 없으면 KRW 총계 제외(달러를 원에 안 섞음). DART bsns_year April-경계 휴리스틱.

## Learnings

- **Do differently next time**:
  - **(CLAUDE.md 승격) 비-additive 응답 형태 변경 → 그 엔드포인트의 모든 프론트 소비처 전수 grep**. 워크플로우(프론트 에이전트)는 훅 소비처만 고치고 독립 fetcher(Analytics.jsx)를 놓쳤고, 적대적 리뷰도 미포착 — 이번 회귀는 **메인 세션 교차검증의 엔드포인트-grep이 유일한 안전망**이었다. [[configurable-batch-schedules]]의 "writer 은퇴→reader 전수 감사" 교훈의 **프론트 계약 소비처판**. 교훈 2겹: ① reshape보다 additive(필드 추가) 선호 ② 불가피하면 `grep -rn '<경로>' frontend/src/`로 소비처 전수 감사를 DoD에. 또 **워크플로우 divergence 노트가 "소비처 2곳 갱신 필요"라 명시했는데도 에이전트가 1곳만 처리** → 워크플로우/리뷰가 자기 divergence 노트를 끝까지 follow-through 못 할 수 있으니 메인 세션 교차검증에서 그 노트의 항목을 체크리스트로 검증할 것.
  - **적대적 리뷰 프롬프트에 "변경된 계약의 *모든* 소비처 grep"을 명시**해야 — 이번 리뷰는 "US 경로 회귀"를 좁게 검증해 두 번째 프론트 소비처를 놓쳤다. (다음 reshape류 작업의 리뷰 항목으로.)
- **검증 게이트**: 자동 게이트 pytest 676·TDD·적대적 리뷰 PASS·라이브 DART 스모크에 더해, **메인 세션 교차검증이 리뷰가 놓친 회귀를 잡은 게 결정적**(`verified: yes`는 그 수정 포함). 커밋 8cf25a46 push. 배포 후 글랜스: 대시보드 배당·상관관계 탭 정상.

## Doc updates

- CONTEXT.md promotion: none.
- ADR added: none (reshape는 가역적, 기존 패턴 내 — ADR 3조건 미충족).
- **CLAUDE.md: "비-additive 응답형태 변경 → 모든 프론트 소비처 전수 grep" gotcha 추가**(line 171 인근, 이 회고 학습 #1 승격). dividends 서비스 gotcha는 실행 중 docs 에이전트가 작성.
- 코드: commit 8cf25a46(기능, main push). 회고 CLAUDE.md gotcha는 별도 커밋 예정.
- **follow-up(없음)**: Analytics 회귀 수정 완료. yfinance dividendYield percent 단위는 retro에만(좁음).

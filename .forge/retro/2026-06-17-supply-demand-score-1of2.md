# 2026-06-17 — 수급 종합 스코어 백엔드 (배치·저장·API, task#59 1of2)

## Plan vs actual
- What went as planned: 6/6 슬라이스 모두 completion 충족(verdict.overall=true). `stock_supply_score` 테이블(app_schema.sql+main.py `_migrate()` 양쪽), `compute_band` 순수함수(최근5 vs 직전20 상대비교, 경계4·우호2 플래그→favorable/neutral/caution, graceful degrade, TDD 8→11 통과), investor_trend 커버리지 랭킹∪user_stocks(ADR-0014), supply_score_fetch 배치(19:00)+batch_registry+auto/manual job_runs+admin refresh, 대시보드 additive `supply` 필드+`/{ticker}/supply-score`(저장값만), API_SPEC/README. backend pytest 710. Dynamic Workflow 11에이전트(웨이브+적대적 리뷰+계획검증).
- Divergences:
  - **(적대적 리뷰 FIXED · HIGH)** 외인/기관 동반 순매수/매도 신호만 plan의 "최근5 vs 직전20 **상대 비교**" 규정을 어기고 직전20 윈도를 버린 채 최근5 **절대합**을 고정임계(100,000주)와 비교 → 평탄 매수 종목이 영구 우호 발화 + 비정규화로 대형주 변별력 붕괴. 계산-정확성 리뷰가 probe로 재현, `shift = r-p`(일평균 변화) 상대비교로 통일·임계 20,000주/일로 교체·회귀테스트 2건 추가. 픽스처 갭(윈도 플립만 테스트해 절대-vs-상대 미핀)도 메움.
  - **(LOW 잔존)** 직전평균 0이면 `pa>0`(잔량 `pb>0`) 가드 탓에 0→급증 전환 미탐. 실데이터 저빈도, 문서화 후 잔존(follow-up 후보).
  - **(LOW 잔존)** `read_score` 무가드 query() — 테이블 부재 시 500 가능하나 `_migrate` 서빙 전 생성 + KR 게이트 + sibling `dividends.get_dividend` 동일 패턴이라 신규 회귀 아님. surgical 범위로 미수정.
  - (정당) S6 CLAUDE_COWORK_API.md 미수정(dashboard는 Cowork 표면 아님), README는 배치 id 비열거 overview 구조라 서비스·테이블 목록만 갱신.
- 라이브 UAT: 사용자 admin이 supply_score_fetch 실행(manual success) → `/supply-score` 실 밴드 반환 → **검산 통과**(005930 caution 3플래그가 recent5 vs prior20 시계열로 정당: 공매도비중 4.09/2.61=1.57×, 잔량 2.20×, 외인보유율 -0.746pp). 밴드 규칙(경계≥2→caution, 1→neutral) 정확.

## Learnings
- Do differently next time:
  - **plan의 정성 규정("상대 비교·가중치 없음" 등)은 *신호별로* 강제·검증돼야 한다.** 전체 알고리즘만 "상대비교"로 맞추면 한 신호가 절대합으로 새는 걸 놓친다 — 계산-정확성 적대적 리뷰가 신호별 대조로 이걸 잡았다(probe로 재현). 다신호 판정 로직은 신호마다 같은 척도(여기선 윈도 상대비교)인지 리뷰 체크리스트화.
  - **프로덕션 배치 쓰기는 사용자 경유**(재확인 [[reference-prod-writes-need-user]]): supply/investor refresh POST는 분류기 차단(테스트 계정 비-admin도 403). 종단은 사용자 admin 즉시 실행 + 검산을 내가 read-only로 대행.
  - anti-poison(산출 None→저장 생략·로깅)·coverage 확장(ADR-0014)은 의도대로 동작 — [[kr-sector-precompute-fix]] 3원칙 적용이 정착.
- 검증 게이트: pytest 710·TDD(11)·적대적 리뷰(HIGH 1 FIXED)·계획검증 6/6·라이브 배치→검산으로 verified: yes. 커밋 57e92c9f push.

## Doc updates
- CONTEXT.md promotion: none ([[수급 스코어]]·[[공매도 추이]] 등 fg-ask 때 등재).
- ADR added: none (boundary는 ADR-0014 기존, 버그픽스·anti-poison은 ADR 3조건 미충족).
- CLAUDE.md: none (이 작업발 gotcha는 2of2 retro의 KR 색 토큰 건).

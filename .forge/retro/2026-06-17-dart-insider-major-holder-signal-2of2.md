# 2026-06-17 — DART 내부자·5% 지분공시 신호 프론트 (task#63, 2of2)

## Plan vs actual
- What went as planned: S1~S4 met. `InsiderTradesSection`(self-fetch, 심층분석 탭), `InsiderBadge`(전용색), 대시보드 카드 배지, 다이제스트 라인, README. Dynamic Workflow 5에이전트(Section+Badge 단일→Digest+README 병렬→색 적대적+npm build+계획검증). npm build OK, 색 검증 issues 0. **3노출면 전부 사용자 육안 확인**: ①005930 심층분석 섹션 ②대시보드 배지/전용색 ③다이제스트 '내부자 지분공시' 라인.
- Divergences:
  - **InsiderBadge 신설**(SupplyBadge 직접 재사용 아님) — direction(buy/sell/neutral)≠band 의미라 동형 전용 컴포넌트. 색 규약(순매수=녹#4caf50·순매도=주황#f57c00, `--up`/`--down`·success/danger 미사용)은 충족.
  - **(범위) 배지가 대시보드 카드 1곳만** — plan S2 "목록·랭킹·대시보드"였으나 Part 1 additive `insider` 필드가 `/api/stocks/dashboard`에만 존재, 인용 선례 SupplyBadge도 ranking/list 배지 없음(grep 확인). ranking/list는 backend 필드 확장 필요(Non-goals: 새 fetch 금지) → 수급 선례 수준으로.
  - **(관찰) 다이제스트 인사이더 = 보유종목 한정**(S6 설계) — watchlist 위주 사용자엔 거의 안 뜸.
  - README 배치 id 미열거(정당 — 배치는 `/api/batches` 동적 노출+services 목록 overview, DART_API_KEY 재사용이라 env 무변경).
  - **(UAT 중 발견, insider 무관) 다이제스트 생성 500** — yfinance NaN 종가 보유 시 total_value=NaN → 응답 직렬화 실패. 선존 버그라 별도 커밋 8cd70a42로 수정 후 재생성→다이제스트 라인 정상.

## Learnings
- Do differently next time:
  - **KR 색 함정은 전용색 명시로 회피, 리뷰는 토큰 실제값 대조**(기존 gotcha 적용) — InsiderBadge 색을 SupplyBadge와 바이트 동일하게, 색 적대적 차원이 `--up`/`--down`·success/danger 미사용을 grep 검증. variant 통념(success=녹) 아닌 토큰 실제값(success=빨강) 기준.
  - **additive 필드의 *노출 범위*는 그 필드가 실린 엔드포인트로 제한된다** — plan이 3표면을 적었어도 backend가 1엔드포인트(/dashboard)에만 필드를 추가했으면 프론트 배지도 1곳. 다표면 배지는 Part 1에서 해당 엔드포인트들에 필드를 additive로 깔아야(선례 SupplyBadge도 동일 한계). 프론트 plan은 backend가 깐 표면과 정합 확인 필요.
  - **프론트 라이브 UAT는 계정 데이터에 의존** — 테스트 계정(보유 0·리포트목록 하니스 로딩 미완)으론 대시보드 배지/다이제스트 자동캡처 불가, 사용자 본인 계정(005930 보유) 육안이 결정적. Playwright는 섹션 존재/색까진 잡으나 데이터 의존 화면은 한계.
  - **UAT가 인접 선존 버그를 드러낸다** — 다이제스트 라인 검증하려다 NaN 직렬화 500(insider 무관)을 발견. 신규 표면이 기존 경로를 처음 강하게 운동시키면 잠복 버그가 노출됨.
- 검증 게이트: npm build·색 적대적(issues 0)·계획검증 S1~S4 met·3노출면 사용자 확인 → verified: yes. 커밋 add68ca3 push.
- 후속 후보: ① 다이제스트 인사이더에 watchlist 포함 검토(fg-ask 재그릴링) ② ranking/list 배지(backend insider 필드 확장) ③ 005930 등 이름 미해결 backfill(사용자 직접 실행 예정).

## Doc updates
- CONTEXT.md promotion: none.
- ADR added: none (표시 전용, plan 명시).
- CLAUDE.md: **다이제스트 NaN 직렬화 gotcha 1건 승격**(UAT 중 발견 — yfinance NaN 종가/usdkrw → total_value NaN → starlette `allow_nan=False` 500; DB/파일 폴백이 다르게 가림. 수정 커밋 8cd70a42).

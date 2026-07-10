# 2026-07-08 — 리포트 생성·시세 적대적 감사 버그 수정 (task#161, TDD)

## Plan vs actual
- What went as planned:
  - 계획 4슬라이스(S1 US NaN price·S2 RSI 타점 KRX·S3 sub-TTM PER/PSR·S4 backfill 오늘 제외) 그대로, 전 슬라이스 test-first(red→green). pytest 1229 green, 배포·라이브 스모크.
  - 라이브: 005930 RSI 타점(189k/486k)이 price 277,500(KRX)과 동일 스케일 — S2 실증. per/psr 정상·NaN 없음.
- Divergences (낮음):
  - S2가 KR daily RSI도 KRX daily_df 재사용으로 확장(계획은 "regular 파라미터 추가"만) — 의도 강화.
  - S1/S3 버그-트리거는 라이브 결정적 재현 어려워 단위테스트가 주 증거.

## Learnings
- Do differently next time:
  - **스케일 불변 지표가 스케일 의존 파생출력을 낼 수 있다 — "정규화라 기준 무관"을 값에서 파생출력으로 무비판 확장 말 것.** RSI 값은 NXT/KRX 무관이지만 RSI 타점(`cur_price+delta`)은 절대가라 기준 의존. ADR-0020의 "RSI 정규장 제외"가 이 함정에 걸렸었다. 앞으로 정규화 지표에서 *절대가/금액*을 파생하면 시세 기준(KRX)을 따르는지 점검(ADR-0020 amendment로 원칙화).
  - **서브시스템별 독립 적대적 리뷰어(문서화 가토 제외 조준)가 구현자가 놓칠 버그를 잡는다** — 이번엔 KR시세+리포트 2리뷰어가 4 MED를 CONFIRMED로. #160의 "독립 리뷰로 확증편향 상쇄" 재확인. 리뷰어에 CONCERNS/기존 가토를 미리 줘 재보고를 막고 신규만 조준한 게 신호대잡음 좋았음.
  - **적대적 감사→fix-forward→TDD가 잘 맞물림**: 각 finding의 실패 시나리오가 그대로 재현 실패테스트가 됨(S1 NaN·S3 <4분기·S4 오늘포함).

## Doc updates
- CONTEXT.md promotion: none.
- ADR: **ADR-0020 amendment(2026-07-08, task#161)** — "절대가 파생출력(RSI 타점 등)도 KRX 기준을 따른다" 범위 명시 + 일반 원칙(스케일 불변일 때만 정규장 제외 유효). 새 ADR 아님(기존 결정의 범위 정정).

# 2026-06-19 — 거대 파일 분리 (2/2) market.py → services/market/ 패키지

## Plan vs actual
- What went as planned: 6 slice 전부 계획대로. byte-identical 순수 이동 + re-export(format·kr·us + __init__), 구 market.py 삭제. pytest 835 passed(베이스라인 동일), 외부 직접-import private 5종 전수 해석, `yf` 공유객체 True. 커밋 c0161ebe.
- Divergences: S4가 plan 예시 `from .kr import *` 대신 **명시 named import** 사용 — `*`는 underscore private(`_norm_sector`·`_yf_sym`·`_NAVER_*`)을 누락하기 때문(아래 L1). 같은 결과, 더 견고. 그 외 차이 없음.

## Learnings
- Do differently next time: re-export 패키지 계획은 처음부터 **명시 named import 전제**로 slice를 적을 것(plan이 `import *`를 예시하면 실행자가 매번 교정해야 함). 시세 크리티컬 경로라도 순수 이동이면 pytest 835 + 심볼 전수 해석이 충분한 검증 — 별도 코드리뷰 불요.

## Doc updates
- CONTEXT.md promotion: none
- ADR added: none (ADR-0017 Consequences에 L1 "명시 re-export — import *는 underscore private 누락" 1줄 보강, task#73·74·75 공통)

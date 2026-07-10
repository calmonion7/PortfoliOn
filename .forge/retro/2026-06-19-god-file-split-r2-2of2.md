# 2026-06-19 — 거대 파일 분리 R2 (2/2) storage.py → services/storage/ 패키지

## Plan vs actual
- What went as planned: 7 slice 계획대로. byte-identical 순수 이동(portfolio·names·schedule·dates + __init__), 구 storage.py 삭제. pytest 835 passed, 27심볼 전수 해석, direct-symbol import 0(외부 전부 `storage.X` 모듈-속성), 변경 테스트 정확히 2개. 커밋 6d95dcb9.
- Divergences: patch-site 실제 수가 plan 추정(~22)보다 많았음(~30: test_storage 12 + test_market_split_report 18). 분류 원칙은 계획대로 정확히 적용 — 내부호출 patch는 호출 함수의 서브모듈로 이전(`services.storage.query`→`portfolio`/`schedule`, `storage.{_now_kst,get_batch_schedule}`→`storage.dates`), 외부소비처 제어 patch(scheduler/라우터가 `storage.X`로 조회)는 무변경 보존.

## Learnings
- Do differently next time: **patch-site는 plan의 추정치를 믿지 말고 grep로 실측·분류부터** — `from services.X import`(직접) / `monkeypatch.setattr(X, …)` / `patch("services.X.…")`를 전수 grep해 "그 mock을 봐야 하는 호출자가 패키지 *안*(→서브모듈로 이전)인지 *밖*(→루트 보존)인지"로 가른다. **sibling import한 심볼(예: dates가 `from .schedule import get_batch_schedule`)은 호출 모듈(dates) 네임스페이스로 patch**해야 도달 — 루트 patch는 안 닿음(standalone 테스트로 입증). 부가: `__init__`이 `query`/`execute`/`get_connection`을 db에서 re-export해 구 단일파일의 속성 표면까지 byte-identical 유지(외부 참조 0이라 surface-only).

## Doc updates
- CONTEXT.md promotion: none
- ADR added: none (ADR-0017 Consequences에 L1 명시 re-export 1줄 보강 — task#73·74·75 공통)

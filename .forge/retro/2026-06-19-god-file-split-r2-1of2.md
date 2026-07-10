# 2026-06-19 — 거대 파일 분리 R2 (1/2) scheduler.py → scheduler/ 패키지

## Plan vs actual
- What went as planned: 5 slice 정확히 계획대로. byte-identical 순수 이동(_state·jobs·schedule + __init__), 구 scheduler.py 삭제. pytest 835 passed, **테스트 patch 경로 이전 0건**(계획대로 테스트 무변경), `_scheduler` 단일객체·`_JOB_FUNCS` 23개·외부 심볼 해석 확인. 커밋 05b0809f.
- Divergences: 없음.

## Learnings
- Do differently next time: **lifecycle 함수(`start`/`stop`/`reload`)는 반드시 `__init__.py`에 둘 것**(서브모듈 금지). 이유(L2, 검증됨): `test_scheduler_rankings`/`_investor`가 `monkeypatch.setattr(scheduler, "_seed_*"/"_check_missed_report", …)` 후 `scheduler.start()`를 호출하는데, `start()`가 `__init__` 네임스페이스에 있어야 monkeypatch가 rebind한 이름을 같은 네임스페이스에서 해석해 도달한다(ADR-0017 분류 ③). 서브모듈에 뒀다면 patch가 안 닿아 깨졌을 지점. 이 덕에 patch 경로 이전 0이 옳았음.

## Doc updates
- CONTEXT.md promotion: none
- ADR added: none (ADR-0017 Consequences에 L1 명시 re-export 1줄 보강 — task#73·74·75 공통. L2는 ADR-0017 분류 ③의 검증 사례라 이 회고에만 기록)

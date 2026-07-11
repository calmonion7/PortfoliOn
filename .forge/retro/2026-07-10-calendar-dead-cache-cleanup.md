# 2026-07-10 — 캘린더 dead 파일 캐시 정리 (task#167)

## Plan vs actual
- 계획대로 된 것: `calendar.py`의 `_CACHE_DIR`·`_cache_path`·파일 glob 루프·`Path` import 제거, `clear_cache` DB DELETE만 존치. 테스트 patch 제거, CLAUDE.md 3곳 갱신. grep 잔존 0·pytest 1256 green·push `1e8da3b`.
- Divergences (미미): 계획 "10곳" → 실제 11곳. `Edit(replace_all)`이 동일 들여쓰기(`         patch(...`) 10곳만 잡고, 체인 첫 줄 `    with patch("...._CACHE_DIR"...)` 1곳(들여쓰기·prefix 상이)을 놓침 → 첫 pytest에서 AttributeError로 드러나고 re-grep으로 포착·개별 수정.

## Learnings
- Do differently next time:
  - **심볼 제거 후 `replace_all`로 patch/참조를 지울 땐, 반복 라인이 "체인 첫 줄(`with patch(`)"과 "연속 줄(`patch(`)"로 들여쓰기가 갈릴 수 있다** — replace_all은 한 리터럴만 지우므로 첫 줄 변형을 놓친다. 제거 직후 `grep -rn <심볼> backend/`로 잔존 0을 반드시 재확인(이번엔 이 게이트가 즉시 포착). 기존 "심볼 변경 시 grep 재확인" 가토의 실행 세부.
  - 미사용이 된 `tmp_path` fixture 파라미터는 존치(pytest 제공·무해, surgical — 시그니처까지 안 건드림).

## Doc updates
- CONTEXT.md promotion: 없음
- ADR added: 없음

# 2026-07-09 — 백엔드 print→logger 전수 스윗 + zero-print 가드 (task#163, part 2/2)

## Plan vs actual
- What went as planned:
  - S1(test-first) `tests/test_no_print.py`(ast로 print() 탐지, 앱코드 0건 단언) 작성 → 스윗 전 red → 스윗 후 green.
  - S2 Dynamic Workflow(21 에이전트·sonnet·eco·병렬, 0 에러)로 21파일 **135 print → logger** 이전. logger 없던 14파일에 배선, 마커 PascalCase 정규화. 앱코드 `print(`=0.
  - 검증: 전체 pytest **1230 passed**, zero-print 가드 green, add-only diff 확인(제거=print(·orphan import sys, 추가=logger/import logging). commit d5539427 push·배포.
- Divergences:
  - **스윗이 기존 테스트 6개를 깨뜨림(예견 가능·DoD 내)**: `print(file=sys.stderr)`/stdout을 `capsys.readouterr()`로 검사하던 6 테스트(funnel 2·kr_sector 3·backfill 1)가 emission이 logging으로 이동해 FAIL. 메인 세션이 `capsys`→`caplog`+`set_level`(warning→WARNING, funnel 배치요약 info→INFO)로 마이그레이션. 로깅 자체는 정상(pytest "Captured stderr"에 표출)이라 검사 위치만 교정.
  - **마커 충돌 통일(스코프 확장)**: touched 파일의 기존 logger 마커까지 손봄 — `us_supply.py [us_supply]→[UsSupply]`(2), `market/kr.py [quote]→[Quote]`(1). §4.3 "개념당 1스펠링" 유지.
  - **오탐**: `report_generator.py:295 [quote]`는 리스트 리터럴이지 마커 아님(무변경).
  - **미수정 deferred nit**: `kis/quote.py [KIS Quote]`(공백·비-Pascal, print 없는 untouched 파일 → 스코프 밖).
  - orphan `import sys` 4파일 제거, 잔여 `sys.` 0 확인.

## Learnings
- Do differently next time:
  - **print→logger(방출 메커니즘 전환) 스윗은 `capsys` 기반 로그-assert 테스트를 깨뜨린다** — grilling/인벤토리 단계에서 "capsys로 stderr/stdout을 검사하는 테스트"도 함께 grep해 caplog 마이그레이션을 슬라이스에 미리 넣을 것(이번엔 실행 후 6건 사후 수복). #127/#128(silent-except→logger)은 print를 assert하던 테스트가 없어 이 트랩을 안 밟았음 — **print를 소비/검사하던 테스트가 있는 스윗**이 이번 신규 위험. → CONVENTIONS §4.1로 승급(사용자 승인).
  - **기계적 스윕 워크플로 템플릿이 또 스케일**(#127 3파일→#128 25파일→이번 21파일): Explore/사전 인벤토리 → 파일당 병렬 에이전트 → baseline/verify pytest 브래킷 → add-only diff. eco sonnet 캡으로 subagent ~1.65M 토큰. 다음 대규모 기계적 변경에 재사용.
  - **마커 정규화는 print 라인에 안 갇힌다**: touched 파일의 기존 logger 마커와 충돌하면 그것도 함께 통일해야 grep 핸들이 일관. 스코프에 "touched 파일 마커 충돌 정리" 포함할 것.
- 후속 backlog 후보:
  - ① 전역 마커 정규화(`[KIS Quote]→[KISQuote]` 등 untouched 파일의 비-Pascal/중복 마커) — fg-quick 급.
  - ② fg-map 갱신: CONCERNS §9(silent-except)에 이어 print/logger 지형이 크게 바뀜(map `last_mapped_commit` 뒤처짐).
  - ③ 프론트 silent catch 로깅(#128부터 잔존).

## Doc updates
- CONTEXT.md promotion: none
- ADR added: none (log-only·가역)
- 기타: **CONVENTIONS §4.1에 caplog 규칙 1줄 승급**(사용자 승인 — map 문서지만 이번에 만든 §4의 직접 연장). §4.3에 `[KIS Quote]` 잔여 nit 명기.

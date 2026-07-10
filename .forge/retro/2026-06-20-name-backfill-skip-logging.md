<!-- forge-slug: name-backfill-skip-logging -->
# 2026-06-20 — 이름 백필 silent skip 로깅 + 응답 skipped 표면화 (task#88, TDD)

## Plan vs actual
- What went as planned: 3슬라이스 TDD. S1 실패테스트(`tests/test_backfill_names_skip.py`, resolve_name 모킹으로 skipped/updated 분기 + capsys 로그 단언) red 확인 → S2 `routers/stocks.py` 구현 green → S3 API_SPEC 갱신. 신규 2 + 전체 **840 passed/0 failed**. UAT: yes(slice tests green).
- Divergences:
  - **로깅은 `logging` 대신 `print(f"[backfill_names] ...")`** — 프로젝트 진단 관례(kr_sector_service 등)와 CLAUDE.md silent-except 가토에 맞춤. capsys로 테스트.
  - **skip 로그를 워커(`_one`)가 아니라 결과 수집 루프(메인 스레드)에서 emit** — ThreadPool 출력 인터리빙 회피·capsys 캡처 안정.
  - `skipped`는 **티커 목록**으로 노출(count 아님) — "어느 종목을 재조사/재실행할지"가 진단 목적이라 목록이 actionable.
  - `_one` 반환 shape `ticker|None` → `(ticker, bool)` 변경. 외부 노출 없는 내부 헬퍼(grep 소비처 0)·`updated`는 여전히 티커 list라 무해.

## Learnings
- Do differently next time: silent skip 진단화의 최소 정직 패턴 = **응답에 `skipped` additive 추가 + skip마다 `print(f"[tag] ...")` 로그**(재시도보다 싸고 안전). 재시도는 신중히 — `resolve_name`은 조회 실패 시 예외를 삼키고 **티커 자체를 반환**해 '일시실패'와 '실명 없음'을 구분 못 한다. 블라인드 재시도는 무명 종목까지 낭비 재시도하므로, 재시도를 도입하려면 먼저 resolve_name이 실패를 신호하도록 계약을 바꿔야 한다(이번엔 deferred).
- 관찰(후속 후보, 차단 아님): 기존 CLAUDE.md 종목명 백필 gotcha("시세 일시실패 시 재시도 없이 silent skip(updated:0) → 0이면 재실행")가 이제 응답 `skipped` 목록으로 **진단 가능**해졌다 — gotcha 본문에 "skipped로 어느 종목이 빠졌는지 확인" 한 줄 추가가 후보(미강제).

## Doc updates
- CONTEXT.md promotion: none (새 용어 없음)
- ADR added: none (additive 응답 + 로깅 — 되돌리기 쉬움)
- CLAUDE.md: none(이번엔) — 위 종목명 백필 gotcha 보강은 후속 후보로만.

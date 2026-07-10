# 2026-06-12 — 리포트 목표가 표시 정본을 daily_consensus_mart로 통일 (Part 1/2, task 22)

## Plan vs actual
- What went as planned:
  - **S1 get_report**: 목표가 3 + 의견수 3을 `daily_consensus_mart`의 `base_date<=리포트날짜` 최신행에서 as-of-date 주입, mart 목표가 null이면 snapshot 동결값 보존, mart 없으면 consensus_history(date<=날짜)→snapshot 폴백. buy/hold/sell도 최신행→as-of-date 통일. ✓
  - **S2 get_history**: 목표가·의견 시계열을 지표 차트와 **동일 정본 함수** `consensus_svc.get_history`(mart-first)로 교체, mart∪snapshot 합집합으로 dense, price/RSI·has_snapshot은 snapshot join, 오름차순. ✓
  - **S3**: 중복 수집 버튼·`POST /api/consensus/{ticker}`·`consensus.collect()` 제거(백필·폴백·add-flow 유지), API_SPEC 갱신. ✓
  - TDD: red 5건 확인 후 구현 → backend **458 passed**, frontend build ✓. 라이브 UAT(배포 후 curl): 005930 요약==지표 426,000 정확 일치, AAPL 요약==지표 328 일치, 히스토리 005930 271·AAPL 374 포인트로 dense화, 수집 엔드포인트 POST→405.
  - **결과물=계획.** WHAT 무발산.
- Divergences (모두 사소·의도적):
  - 테스트 mocking surface 전환: `routers.report.query` side_effect → `consensus_svc.get_history` patch + snapshot query 분리. get_history가 단일 정본 함수를 부르도록 한 결과(의도된 단일 출처화).
  - **union 폴백 transient**: 아직 mart에 없는 최신 스냅샷 날짜(예: AAPL 2026-06-12)는 snapshot 동결 목표가(312.48)를 표시 — mart 최신(2026-06-11=328)과 1일 어긋나며 익일 파이프라인이 그 날짜를 mart에 넣으면 자가치유. 요약은 as-of-date라 mart 328을 따름(지표 끝점과 일치), 즉 "요약==지표"는 영향 없음.

## Learnings
- Do differently next time:
  - **"두 화면이 같은 값을 보여야 한다"는 같은 함수를 호출하게 만들어 구조적으로 보장하는 게 가장 견고하다.** get_history가 지표 차트와 동일한 `consensus_svc.get_history`를 부르도록 하니 데이터 정합이 코드 구조로 강제됨(값 비교 테스트보다 강력). 동일 패턴을 향후 "같은 수치 다른 화면" 정합에 적용.
  - **as-of-date(`base_date<=date`) 주입은 "최신 화면 일치 + 과거 비교 정상"을 동시에 만족한다.** 최신 리포트는 mart 최신행=지표 끝점과 일치, 과거 리포트는 그 시점 값이라 히스토리 비교 테이블도 살아남. '최신행 무조건'의 함정(비교 0%)을 피한 선택이 라이브에서 확인됨.
  - **US mart 커버리지는 우려보다 충분했다** — AAPL이 mart 373포인트로 dense. Part 2(쓰기 경로 mart 일원화)의 "US raw_reports 커버리지 약화로 이력 회귀" 리스크가 생각보다 작을 수 있다. 단 Part 2 재적재 UAT 때 저커버리지 종목 표본으로 반드시 재확인할 것(섣불리 안심 금지).
  - **public read 엔드포인트(consensus/history/report)는 인증 없이 curl로 라이브 UAT 가능** — Playwright 없이 배포 직후 API 정합을 빠르게 검증. (urllib 기본 UA는 Cloudflare 403, curl은 통과.)

## Doc updates
- CONTEXT.md promotion: none (새 도메인 용어 없음; 정본/목표가는 글로서리 항목 아님)
- ADR added: none (정본=daily_consensus_mart·as-of-date 결정은 fg-ask에서 ADR-0008로 이미 기록; union 폴백은 구현 세부라 3조건 미달)

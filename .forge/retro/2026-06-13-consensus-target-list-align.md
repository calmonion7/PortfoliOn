# 2026-06-13 — 목록·대시보드 목표가를 리포트 상세와 동일 정본(mart as-of)으로 정합 (task 24)

## Plan vs actual
- What went as planned:
  - TDD red→green으로 S1~S3 슬라이스 전부 완료. `consensus.get_asof`/`apply_asof` 공유 헬퍼 추출 후 상세·목록·대시보드 세 화면이 같은 함수를 호출하게 배선(직전 Part 1 교훈 "정합을 코드 구조로 보장"의 적용).
  - 신규 7건 포함 backend **466 passed**, frontend `npm run build` 성공(프론트 로직 무변경).
  - 라이브 UAT(005930·AAPL): 상세=목록=대시보드 target_mean·buy/hold/sell 완전 일치. DoD ①②, WHAT 무발산.
- Divergences (모두 사소·의도적):
  1. **테스트 mocking surface 전환** — 정본 로직을 `services.consensus` 공유 헬퍼로 모으자, get_report 테스트 7건의 mart/history 패치 타깃이 `routers.report.query` → `services.consensus.query`로 이동(snapshot→enriched 2콜 + 헬퍼 쿼리 분리). **Part 1·2·3 연속 3번째 동일 패턴**.
  2. **대시보드 N+1 비용** — A안(종목별 헬퍼 호출)으로 카드당 mart 쿼리 2개 추가. mine 대시보드는 5초·300초 캐시·기존 ThreadPool 내라 무해, admin `scope=all`(캐시 우회)만 종목 수만큼 증가 — fg-ask에서 합의한 알려진 수용 비용(plan 명시, silent cap 없음).
  3. `apply_asof`는 no-row 시 원본 summary를 무복사 반환 — get_report는 직후 `dict(summary)`, list는 ticker별 fresh `_slim_summary`, dashboard는 fresh 리터럴 전달 → 공유 변형 위험 없음(검토 확인).

## Learnings
- Do differently next time:
  - **로직을 라우터→서비스 모듈로 추출하는 리팩터는 "테스트 패치 타깃 이동"을 슬라이스 완료기준에 미리 포함**할 것. 이번까지 3회 연속(Part 1/2/3) 라우터의 `query` 패치를 서비스 모듈의 `query`로 옮겨야 했다 — 다음에 같은 패턴(`consensus`/`*_pipeline` 등 공유 헬퍼로의 추출)이 나오면 비회귀 테스트의 patch surface 조정을 처음부터 작업 항목으로 둘 것.
  - **per-항목 헬퍼 호출(A안)을 대시보드/목록 같은 N개 카드 경로에 넣을 땐 admin `scope=all`(캐시 우회) 비용을 명시**할 것. 이번엔 plan에 적어 silent cap을 피했다 — 향후 배치/N+1 도입 시 "캐시 우회 경로에서 쿼리 N배"를 retro/plan에 항상 적시.
  - 배포 검증 시 **직접 DB 조회는 production-read로 차단**되므로, 라이브 UAT는 API 경로(test 계정에 dense 종목 시드→비교→삭제 원복)로 설계할 것. 005930·AAPL은 스냅샷 공유라 임시 시드만으로 목록·대시보드에 노출됨.

## Doc updates
- CONTEXT.md promotion: none (신규/변경 도메인 용어 없음 — `apply_asof`는 구현 디테일, "정본/목표가"는 글로서리 항목 아님)
- ADR added: none (ADR-0008 "정본=daily_consensus_mart, as-of-date"의 구현 확장일 뿐 — 공유 헬퍼 추출은 가역적·비퍼즐, N+1은 plan 기록 수용 비용 → ADR 3조건 미충족)

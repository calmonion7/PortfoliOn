# 2026-06-12 — 컨센서스 쓰기 경로를 daily_consensus_mart로 일원화 (Part 2/2)

## Plan vs actual
- What went as planned:
  - S1 백필 버튼·S2 add-flow(portfolio·watchlist)를 `_pipeline.backfill`로 repoint, S3 legacy `consensus.backfill/_fetch_kr/_fetch_us` 제거. `get_history` 읽기 폴백·`consensus_history` 동결 보존(Non-goal 준수).
  - TDD(슬라이스별 red→green) 459 passed, `npm run build` 성공, 라이브 스모크(KR 005930·US AAPL) 통과.
  - 직접 실행(다중 에이전트 워크플로우 미사용): 3개 호출처 repoint + 단일 파일 dead code 제거 규모라 단일 컨텍스트가 더 적합.
- Divergences (상세는 run.md):
  - **플랜의 `_fetch_kr_fnguide` 제거 항목이 오류** — 이 함수는 `consensus.py`가 아니라 `consensus_pipeline.py:112`에 있고 파이프라인 라이브 경로(`_fetch_kr_raw`, line 49)가 호출. 제거 시 일일 파이프라인 붕괴 → 보존.
  - S3 완료기준 grep(`_fetch_kr|_fetch_us` → 0)은 literal 충족 불가(파이프라인 자체 `_fetch_kr_raw`/`_fetch_us_raw`, `scheduler._fetch_kr_rankings`까지 매칭) → `consensus(_svc).backfill` 호출처 0 + consensus.py legacy 정의 0으로 해석·검증.
  - S1 응답 shape `{added,entries}` → `{added:int}`(파이프라인 int 반환). 프론트는 `result.added`만 써서 호환. `added` 의미는 'consensus_history 추가 날짜수' → 'raw_reports upsert 행수'로 변화(무해).
  - legacy 경로를 검증하던 테스트 3종 제거→mart 타겟 테스트로 교체. 고아 `MagicMock` import, add-flow 미사용 `market` 변수·`consensus_svc` import 정리.

## Learnings
- Do differently next time:
  - **플랜에 "제거 대상 심볼"을 적을 때는 fg-ask 단계에서 그 심볼의 실제 모듈·호출처를 grep으로 검증**하고 적을 것. 이름이 비슷한 다른 모듈의 라이브 함수(`consensus._fetch_kr` vs `consensus_pipeline._fetch_kr_raw`/`_fetch_kr_fnguide`)를 혼동하면 "제거하면 깨지는" 항목이 플랜에 박힌다.
  - **완료기준 grep 패턴은 모듈/호출처 단위로 정밀하게.** `_fetch_kr` 같은 느슨한 접두사는 `_fetch_kr_raw`·`_fetch_kr_rankings`까지 매칭해 "0건" 검증이 불가능해진다. `consensus.backfill\|consensus_svc.backfill` 호출처처럼 정밀 패턴으로.
  - **API 응답 계약을 줄일 때(필드 제거)는 변경 전 소비자 코드 확인을 완료기준에 넣을 것** — 이번엔 `ConsensusChart.jsx`가 `result.added`만 쓰는 걸 확인해 `entries` 제거가 안전했다. (유지할 패턴)

## Doc updates
- CONTEXT.md promotion: none (정본=mart / 동결 폴백 결정은 ADR-0008이 이미 보유, 신규 도메인 용어 없음)
- ADR added: none (ADR-0008 [[consensus-target-source-of-truth]]가 쓰기 경로 결정까지 커버)

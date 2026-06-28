# 2026-06-28 — 리포트 박제-시 독립피드 게이트 강화 (task #118)

## Plan vs actual
- What went as planned: 게이트(`report_generator.py`)를 다중 독립피드(네이버 retry-once → KIS 폴백, first-available) + ref 전무 시 박제 스킵 + 분기별 loud 로그로 교체. TDD 신규 3분기(네이버 raise→KIS ref / 네이버+KIS 부재→스킵 / ref+5x→스킵) red→green, task#101 기존 5개 게이트 테스트 보존. ADR-0020 amendment·CLAUDE.md 갱신(run S2). 전체 906 passed, 게이트 8/8.
- Divergences (경미):
  - **(medium, in-run 수정)** no-ref 분기 `[Report]` print 초기 누락 → verify 에이전트가 발견·1줄 추가(`report_generator.py:212`). 계획의 "분기별 loud 로깅" 충족.
  - **(nitpick)** `generate_report_with_retry(retries=1)`가 게이트 ValueError도 재시도 → 글리치 시 네이버+KIS 2회·sleep 0.5×2. 심야 비동기 배치라 운영 무영향, retry wrapper 변경은 범위 외(미수정).
  - **(무관)** pre-existing 실패 5건(#111/#117 `from backend.services...`) 그대로.

## Learnings
- Do differently next time:
  - **단일 외부 의존 가드는 "그게 *틀릴* 때"뿐 아니라 "그게 *없을* 때 fail-open되는 방향"을 봐야 한다.** task#101은 단일 네이버 ref의 위험을 "네이버 글리치→false-skip(무해)"로만 봤지만, 실제 재발은 "네이버 *부재*(rate-limit)→검증 생략→glitch false-PASS(유해)"였다. **silent skip-on-failure(`except→None→검증 생략`)는 가드를 조용히 무력화**한다(CLAUDE.md silent-except 가토의 게이트판). 외부 의존 가드엔 ① 다중 독립피드 폴백 ② 전무 시 fail-safe(skip-bake, wrong<missing) ③ loud 로깅을 기본 세트로.
  - **독립피드 교차검증 패턴 4번째 적용** — task#96(NXT self-check)→#98(대시보드 다수결)→#101(리포트 게이트 단일 네이버)→#118(게이트 다중피드+fail-safe). KR 시세 신뢰성은 "단일 피드 못 믿음 → 독립 교차검증"으로 일관 수렴.
  - **열린 follow-up**: ① stale 70k 스냅샷 재생성(게이트 배포 *후*, 프로드·사용자 — fix는 박제값 소급치료 안 함) ② `test_financials_kr*.py` import 5건(`from backend.services...`→`from services...`, fg-quick).

## Doc updates
- CONTEXT.md promotion: none (게이트 메커닉 — 신규 도메인 용어 없음, task#101과 동일 판단).
- ADR added: none (신규 ADR 없음). ADR-0020에 amendment(2026-06-28, task#118) — run S2서 기록(다중피드+no-ref skip 강화·단일피드 무력화 구멍 정정).
- CLAUDE.md: 박제 게이트 문구 갱신(단일 네이버 → 다중 ref+no-ref skip) — run S2서 기록.

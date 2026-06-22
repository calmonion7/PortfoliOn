# 2026-06-22 — 대시보드 첫 로딩 빈 그리드 fix (task#102)

## Plan vs actual
- What went as planned:
  - 근본원인 코드 규명 적중: 헤더(/api/portfolio)·그리드(/api/stocks/dashboard)가 같은 `get_full_portfolio`(fresh DB)를 쓰므로 "holdings=[]" 빈반환이 아니라, `_build_all`의 10워커×카드당 DB read throw→500→프론트 `fetchDashboard` silent catch→빈 그리드. 헤더는 단일 쿼리라 N 정상 → "헤더 N·그리드 빈, 재네비면 정상".
  - 불변식 fix(holdings=N→항상 N카드): 백엔드 `_build_all` graceful(get_quotes_batch try/except + 카드당 `_safe`→`_minimal_card`) + 프론트 DashboardGrid가 stocks>0이면 Skeleton·self-heal bounded 재시도. TDD 백엔드 4종 red→green, 전체 876 passed, 프론트 build green.
- Divergences (낮음):
  - **정확한 throw 지점 미확정**: 콜드 풀 경합(PoolError, CONCERNS §4) 유력이나 운영 로그/콜드 재현으로 확정하진 않음. fix는 원인 불문 불변식이라 확정 없이도 증상 차단(설계 의도).
  - **프론트 검증 = build + 코드검토**: 단위 테스트 프레임워크 없음 + 콜드-로드 레이스는 Playwright 신뢰 재현 불가 → 백엔드 4테스트가 불변식을 구조 증명(holdings 있으면 빈 그리드 불가능)으로 대체.

## Learnings
- Do differently next time:
  - **"헤더 N인데 그리드/하위목록만 빔" 증상 = 같은 소스인데 한쪽만 throw + 그 throw를 silent catch가 삼킴**을 먼저 의심하라. 이번엔 헤더(단일 쿼리)는 통과, 그리드(10워커×카드당 DB read)는 콜드 throw→500, 프론트 catch가 silent(`usePortfolioData`)라 빈상태로만 보였다. 두 경로가 같은 데이터 소스를 쓰는지부터 확인(다르면 staleness, 같으면 빌드/throw 의심).
  - **one-shot self-heal 안티패턴**: 재시도를 `useRef(false)` 한 방으로 막으면, 그 한 방이 *일시적* 콜드 실패에 떨어질 때 재마운트 전까지 영구 stuck한다(task#82가 도입한 dashHealedRef의 잔존 약점이 이번 재발의 일부). 일시 실패 복구는 **bounded 재시도**(상한 카운터)로 — 무한루프는 상한으로, 영구포기는 >1회로 막는다.
  - **원인 불문 불변식 fix가 유효한 경우**: 일시적/콜드 전용 버그라 정확한 throw를 신뢰성 있게 재현·확정하기 어려울 때, "수집(collection) 빌드에서 per-item 실패가 전체를 nuke하지 않는다(holdings=N→N카드, 절대 500-to-empty)"는 불변식으로 *증상*을 구조 차단하면 정확한 원인 확정 없이도 재발이 막힌다. per-item try/except + 일괄 fetch try/except.
  - 같은 증상 2번째 fix(task#82→#102) — #82는 마운트 fetch 누락, #102는 콜드 빌드 throw+silent catch. 시각 증상이 같아도 경로가 매번 다를 수 있으니 코드 규명 우선(task#82 retro 교훈 재확인).

## Doc updates
- CONTEXT.md promotion: none (도메인 용어 아님)
- ADR added: none (graceful-degradation·bounded 재시도는 되돌리기 쉽고 게이트 미충족). CLAUDE.md에 "대시보드 holdings=N→항상 N카드, 500-to-empty 금지" 불변식 가토를 S3 doc-sync로 추가(증상·원인·프론트 가드 명시).
- 후속 후보: DB 풀 sizing 튜닝(CONCERNS §4 — maxconn vs ThreadPool 워커, 이 가드는 증상만 차단하고 풀 경합 자체는 잔존).

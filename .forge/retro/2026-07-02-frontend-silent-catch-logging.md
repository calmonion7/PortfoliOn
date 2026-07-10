# 2026-07-02 — 프론트 무음 catch 로깅화 (task#129, 백엔드 #127/#128의 프론트판)

저이탈 세션. 프론트 순수 무음 catch 7건에 `console.warn`(fallback 앞) 추가 — LOG-ONLY, 제어플로 byte-identical. build 클린·vitest 31 green·커밋 `1f7de649` push·라이브. (봉인 시 회고 skip했다가 사용자 요청으로 사후 작성.)

## Plan vs actual
- 계획대로: 7건 전부 로그 추가, 제어플로 무변경, 빌드/테스트 green. 실행 단계 이탈 없음.
- Divergence(그릴링 단계): 대상 **8→7 정정** — `AdminAnalytics.jsx:63`(`.catch(() => setHistory([]))`)은 **빈값-폴백**이라 §9가 지목한 **"순수 무음 swallow"가 아님** → 제외. 실행 단계 이탈은 아니고 범위 확정 과정의 자기수정.

## Learnings
- **Do differently next time**: "silent catch 정리" 범위를 정할 때 **① 순수 무음 swallow**(`catch {}`/`.catch(() => {})` — 아무것도 안 함)와 **② 빈값-폴백 swallow**(`setResults([])`·`setHistory([])`·`setBacklogData([])`·`setSnapshot*(null)` 등 의도적 폴백 상태)를 구분할 것. 전자만 §9의 대상이고 후자는 판단 필요한 더 큰 별개 범위. **CONCERNS §9의 명시 목록 자체가 권위 있는 범위 앵커** — 목록에 없는 사이트를 임의로 끌어들이지 말 것.
- 제외 클래스(다음에도 동일 적용): 텔레메트리(`analytics.js`, 백엔드 `job_runs` 대응)·프리페치(`Calendar:211`)·캐시삭제(`usePortfolioData:34`)·영구 폴링(15s)·진행률 폴링(바깥 핸들러가 이미 에러 노출)·fire-and-forget 정리(로그아웃). "no silent caps" — 제외 사유를 계획 Non-goals에 명시.
- **맵 stale 후속**: 이 변경이 CONCERNS §9 "REMAINS silent — Frontend silent catches"의 7건을 해소 → `.forge/codebase/CONCERNS.md` §9가 살짝 stale. 다음 `fg-map` 갱신 시 반영(잔존 무음은 이제 프론트 폴링/폴백 계열·`main.py:35` `_warm_market_cache`·`job_runs`/`guru_scraper` 등).

## Doc updates
- CONTEXT.md promotion: none (신규 도메인 용어 없음)
- ADR added: none (백엔드 #127/#128의 프론트 미러 — 새 결정 아님, 저이탈)

# 2026-06-20 — Reports.jsx 필터/정렬 → useReportFilters 훅 추출 + Vitest 하니스 도입 (R4 part 1/2)

## Plan vs actual
- What went as planned:
  - Vitest 하니스(ADR-0019) 도입: vitest@4.1.9·jsdom@29.1.1·@testing-library/react@16.3.2·jest-dom@6.9.1, `vite.config.js` `test` 블록, `"test":"vitest run"`, `src/test/setup.js`, 콜로케이트 `*.test.js`. 스모크 green.
  - `useReportFilters.js`(82줄)로 필터/정렬 파생 로직 verbatim 추출(소유 state sortCol·sortDir·marketFilter·watchlistSub, args=reportList·othersData·activeTab+predicates 3종). Reports.jsx는 훅 소비, state 4개 제거 → **447→391줄**.
  - characterization 16개: _matchSubTab 6분기·시장카운트·marketFilter·정렬 3컬럼+기본정렬 2분기+null·sortArrow. Vitest 17 green(스모크 포함)·build green·신규 lint 0.
- Divergences:
  - **라이브 Playwright UAT 미실행** — 백그라운드 세션이라 분기 전수 characterization 테스트(16 green)+build로 대체. ADR-0019가 단위테스트를 추출 전후 동일성의 1차 기계적 보장으로 지정했으므로 경미. 라이브 회귀는 머지 후 자동배포에서 사용자 확인(feedback-verification).
  - **실행 방식**: fg-run 워크플로우 대신 직접 순차(슬라이스 전부 직렬·한 파일 공유 → R3와 동일 사유, 스킬 single-agent 허용).

## Learnings
- Do differently next time:
  - **vite.config `test` 블록은 import를 `'vite'`로 유지하라(`'vitest/config'` 금지).** `vitest/config`로 바꾸면 `vite build`도 vitest 설치를 요구해, Docker가 devDeps 생략 시 프로덕션 빌드가 vitest 부재로 깨질 수 있다. `'vite'` 유지 시 vite가 빌드 때 `test` 키를 무시 → **빌드-테스트 디커플**(devDep이 빌드에 영향 0, ADR-0019 의도와 합치). 향후 다른 프론트 테스트 추가 시 이 import를 절대 바꾸지 말 것.
  - **VitePWA 등 전체 플러그인 config가 Vitest에서도 로드되지만 무해했다** — test-only config 분기 불필요(스모크로 확인). 향후 어떤 plugin이 test에서 문제되면 그때 `process.env.VITEST`로 분기.
  - **characterization predicate 전략 = 훅 관심 경계를 테스트 경계로.** 순수 predicate(_targetPct/_hasWarning)는 useReportList 정의를 테스트에 그대로 미러(실제 임계값 40·총합≤10 검증), 외부 state 의존 predicate(_isUngenerated←lastScheduledDates)는 단순 플래그 스텁으로 **위임 배선만** 검증. 훅이 책임지지 않는 입력은 스텁, 책임지는 합성은 실제값으로.
  - **renderHook은 act 후 `result.current`를 다시 읽어 단언** — state 변경 시 최신 렌더의 파생/핸들러가 반영된 새 클로저를 잡는다(handleSort 토글·setMarketFilter 후 tabEntries 재계산 검증에 필수).
  - **"신규 lint 0" 입증법**: eslint flat config는 프로젝트 밖 임시파일엔 안 붙어 `git show HEAD:파일`을 떠서 직접 lint해도 무의미 → 대신 **건드린 적 없는 effect 코드의 HEAD 바이트 동일성**을 grep으로 확인해 "기존 부채(set-state-in-effect·stale directive)는 내 변경 무관"을 입증. 파일 축소로 라인번호만 이동.

## Doc updates
- CONTEXT.md promotion: none (`useReportFilters`는 구현 디테일 — 컨텍스트 고유 용어 아님, plan도 "Glossary terms: none" 명시)
- ADR added: none (ADR-0019 Vitest 채택은 fg-ask 단계서 이미 생성·이번 실행이 확인. 추출 자체는 가역적)

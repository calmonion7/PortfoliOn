# RUN — task#402 심층 리포트 문서 복귀 pill → 「← 심층 목록」

실행: 2026-10-22 · fg-loop 드라이브 · 소규모라 워크플로 없이 메인 세션 직접 실행 · 커밋 `1edbdfb` (dev push)

## 슬라이스 결과
- S1 테스트 red — pill 목적지·문구 단언 교체 + 404 에러 링크 단언 신설 → 옛 코드에서 2 FAIL(`'/reports'`) — ✅ 계획대로
- S2 `AnalystReport.jsx` 377·455행 `<Link to="/analyst-reports">← 심층 목록</Link>`, `state={{ ticker }}` 제거, 주석 근거 task#402로 — ✅ 계획대로
- S3 uat215 ⓕ 축 갱신 + CONTEXT(dev)·ADR-0027 개정 노트 5 — ⚠ 범위 확장: ⓕ' 미추적 발행물 축·표본 sentinel 신설, README·상위 `.forge/CONTEXT.md`의 같은 문구도 갱신
- S4 dev push → Deploy run success → dev 스택 uat215 + 육안 스크린샷 — ⚠ 계획은 「배포 후 라이브」였으나 루프 계약대로 **dev 스택(8084)** 대상

## DoD baseline → after
1. AnalystReport.test.jsx: 52/52(옛 단언) → red 2 FAIL/53 → **53/53 통과** (전체 vitest 106 files / 1134 tests green)
2. `grep -c "종목 리포트" AnalystReport.jsx` 2 → **0** · `grep -c "심층 목록"` 0 → **3**
3. uat215 ⓕ 축: 「종목 리포트」·`/reports` → `pillTxt === '← 심층 목록'`·`pathname === '/analyst-reports'` (+ⓕ' 신설)
4. `grep -c "← 종목 리포트" .forge/branch/dev/CONTEXT.md` 1 → **0** · ADR-0027 task#402 0 → **1**
5. dev Deploy run `39775143960` headSha `1edbdfb` success · 세대 `261022-210230-1edbdfb` · `BASE=http://127.0.0.1:8084 node scripts/uat215-deep-report-tab.mjs` **191/191 PASS**(4뷰포트, 미추적 표본 LHX: 카드→문서→pill→`/analyst-reports`) · m350 스크린샷: pill [236,573,330,610] · 탭바 top 639 → 겹침 없음(간격 29px)

## 계획과 달랐던 점
- **사용자 대면 문자열 전역 grep**(루트 CLAUDE.md task#324 규율)에서 계획 밖 히트 2곳 발견: `README.md`(심층 리포트 화면 서술 「거기서 「← 종목 리포트」로 돌아온다」)와 상위 `.forge/CONTEXT.md`(dev CONTEXT와 같은 ⓑ 문장 — task#396도 상위 파일을 함께 고쳤다). 둘 다 갱신. `.claude/skills/live-uat-probes/SKILL.md:175`의 「← 종목 리포트」 pill 언급은 과거 사례 서술이라 남김.
- 계획 S2 주석 문안에 「종목 리포트로 보내면」을 넣었더니 DoD 2(`grep -c "종목 리포트"` → 0)에 걸려 `/reports`로 바꿈 — grep DoD는 주석까지 센다.
- 프로브에 ⓕ'(내 목록 밖 발행물 복귀) 축을 추가했다 — 계획 DoD 5의 「비-admin·목록 밖 종목 → pill → `/analyst-reports`」를 육안 대신 단언으로 박기 위해. 표본 0이면 sentinel FAIL.
- `AnalystReport.jsx`의 eslint `react-hooks/set-state-in-effect` 2건은 선재(344행 부근, 이번 diff 밖) — 손대지 않음.
- prod 라이브 확인은 main 머지 후의 일(사람 몫)로 남는다.

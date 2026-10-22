<!-- forge-slug: deep-report-glossary-links-1of2 -->
<!-- task: 399 -->
<!-- part: 1/2 -->
<!-- tdd: on -->
# 심층 리포트 용어 링크 확대 1/2 — 미연결 필드에 용어집 자동 매칭 배선

## 목표 / 비목표
- 목표: 심층 리포트(`LensReport`)에서 `GlossaryText`가 걸리지 않은 자유 서술 필드 8종에 자동 매칭을 배선해, **접힌 화면에서 용어 링크 0개**인 상태를 없앤다.
  - 배선 대상: 접힌 행 — 요약 `l.summary`, 바뀜 조건 `l.flip`, 조건 목록 `conditions[].when[]`(`FlipConditions`), 대상 위험 `lens.risk`(`BaseRateHead`) · 펼침 — 사례 note(`note.rest`·`note.same`·`note.diff`, `PrecedentRow`), 원자료 근거 `r.rationale`(`InputsTable`), 미산출 사유 `l.na_reason` · 하단 — 구조 축 근거 `ax.rationale`(`StructureAxes`).
- 비목표:
  - **제목(`report.title` 인용문)은 걸지 않는다** — 22px 세리프 결론 문장에 밑줄이 들어가면 산만해진다(사용자 결정).
  - **사례 제목 `p.case`는 걸지 않는다** — `<button>` 안이라 용어 버튼이 중첩된다(무효 HTML).
  - 매칭 규칙(`glossary/match.js`) 변경 없음 — **텍스트당 용어별 첫 등장 1회**를 그대로 쓴다(렌즈 행당·리포트당 중복 제거는 기각: 리포트당은 5~10개로 다시 「적다」).
  - 사전 어휘 추가·서버 계산 라벨 배선은 **2/2**(`deep-report-glossary-links-2of2`)의 몫.
  - `AnalystReport.jsx` 페이지 머리(컨센서스·증권사 행 등)는 범위 밖.

## 정본
- 용어: `.forge/CONTEXT.md` 「주식 용어집」(노출 ① AI 자유 텍스트 자동 매칭) · 「심층 리포트」 · 브랜치 오버레이 「렌즈」
- 관련 ADR: 없음
- 완료 정의(DoD):
  1. `cd frontend && npx vitest run src/pages/AnalystReport.test.jsx` — 신규 테스트가 **배선 대상 8종 각각**에서 `.glossary-term:not(.lens-help)` 버튼 ≥1을 단언하고 통과. **red 선행**: 작성 시점에 8종 모두 0개여야 한다(전진 검사).
     - 작성 시점 사전 상태: 기존 58건 통과(2 파일). 신규 단언은 아직 없음.
  2. 회귀 가드: `npx vitest run src/pages/AnalystReport.test.jsx src/glossary/match.test.js` 기존 58건 무회귀(작성 시점 통과 — 회귀 가드라 선통과가 정상).
  3. dev 스택(127.0.0.1:8084, `portfolion_dev` = prod 복사본 10건) — dev push 후 Playwright로 10건 각각 **접힌 상태** `[data-lens-cell]` 안의 `.glossary-term:not(.lens-help)` 개수를 센다. 작성 시점 노드 실측(dev API 응답에 `matchTerms`를 `SignalList`의 렌더 조건 그대로 적용 — 게이지가 있으면 조건 목록 없음, 조건 목록이 있으면 flip 없음, na면 사유만): 리포트별 기대값 000660 19 · 005380 11 · 005930 22 · CRCL 2 · GOOGL 10 · LHX 8 · LLY 8 · MRVL 16 · MU 6 · SPCX 2(합 104). **사전 상태 = 전 건 0**(접힌 행에는 `GlossaryText`가 한 곳도 없다 — `lens-help` 「?」만 `glossary-term` 클래스를 쓴다). 판정: 10건 모두 기대값과 **정확히 일치**(텍스트 단위 매칭이라 조건 정렬 순서와 무관). 불일치하면 노드 계산과 렌더 조건 중 어느 쪽이 틀렸는지 먼저 가를 것.
     - 「이 단언이 통과하면서도 깨질 수 있는 방식」: 개수는 맞는데 버튼이 줄바꿈·`keep-all`을 깨 행 레이아웃이 무너질 수 있다 → m278·m390·pc1440 **육안 스크린샷 1장씩**(루트 CLAUDE.md ⓐ). 특히 `FlipConditions` `<li>`와 `BaseRateHead` 굵은 위험 문장.
  4. 팝오버 1개 클릭 확인(접힌 요약의 용어) — 앵커 팝오버가 뜨고 행의 「상세」 토글이 같이 눌리지 않는다.

## 작업 슬라이스
- [ ] S1. (red) `AnalystReport.test.jsx`에 배선 대상 8종을 담은 픽스처 + 필드별 `.glossary-term` 단언 추가 — 완료기준: 8종 단언이 **모두 실패**하는 것을 확인(run.md에 기록).
- [ ] S2. `LensReport.jsx` 8곳을 `<GlossaryText text={…} />`로 감싼다(각 자리의 기존 `wordBreak`·`overflowWrap`·색 스타일은 부모 요소에 그대로) — 완료기준: DoD 1·2 통과. (depends: S1)
- [ ] S3. dev push → dev 스택 프로브(DoD 3 계수 + 3뷰포트 스크린샷 + DoD 4 클릭) — 완료기준: 10건 계수가 기대값과 일치, 스크린샷에서 행 모양 무붕괴. (depends: S2)

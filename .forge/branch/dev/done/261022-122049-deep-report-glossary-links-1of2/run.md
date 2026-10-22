# RUN — 심층 리포트 용어 링크 확대 1/2 (task#399)

fg-loop 드라이브 안에서 직접 실행(워크플로 없음 — 한 파일 8곳 감싸기 + 테스트 1블록이라 단일 에이전트 규모).

## 슬라이스
- S1 `AnalystReport.test.jsx`에 8필드 픽스처(필드마다 「영업이익」 1개) + 4개 테스트(접힘 5필드 · 펼침 4필드 · 구조 축/비목표 0 · 팝오버 클릭) — ✅ red 4/4 확인(전부 `expected 0 to be 1`)
- S2 `LensReport.jsx` 10곳을 `<GlossaryText>`로 감쌈(8종 = note가 3갈래라 10곳). 부모의 `wordBreak`·`overflowWrap`·색 스타일은 그대로 — ✅ as planned
- S3 dev push `5a84e3f` → 세대 `261022-121835-5a84e3f` → 프로브·3뷰포트 스크린샷·팝오버 클릭 — ✅ 기대값과 정확히 일치

## DoD baseline → after
1. 신규 단언: 없음 → 4 tests green (8필드 각각 `.glossary-term:not(.lens-help)` == 1)
2. 회귀 가드: `AnalystReport.test.jsx`+`match.test.js` 58 → 62 passed(기존 58 무회귀). 전체 1100 → 1104
3. dev 접힌 계수: 전 건 0 → 000660 19 · 005380 11 · 005930 22 · CRCL 2 · GOOGL 10 · LHX 8 · LLY 8 · MRVL 16 · MU 6 · SPCX 2 (합 104, 기대값과 10/10 정확 일치) — `scripts/loop399-glossary-check.mjs`
   - 3뷰포트(m278·m390·pc1440, 000660) 가로 넘침 0, 육안: `FlipConditions` `<li>` keep-all 유지, `BaseRateHead` 굵은 위험 문장의 밑줄 정상, 행 모양 무붕괴
4. 팝오버: 3뷰포트 모두 접힌 요약 첫 용어 클릭 → `.glossary-popover` 1 · 그 행 `aria-expanded=false`(상세 안 열림)

## 계획과 다른 점
- 「8종」은 필드 종류 수이고 실제 감싼 자리는 10곳(사례 note rest/same/diff 3갈래).
- 「모두 펼치기」 후 용어 종류는 22 → 27(IPO·내부자·밸류에이션·부채비율·잉여현금흐름이 새로 드러남). 기존 22종 손실 0.
- 정지조건 프로브 `scripts/loop399-glossary-check.mjs`를 이 커밋에 함께 넣었다(fg-loop 계약의 독립 checker — 드라이브 중 수정 금지).

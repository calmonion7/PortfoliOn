<!-- forge-slug: analyst-report-m278-overflow -->
<!-- task: 394 -->
<!-- tdd: off -->
# 심층 리포트 화면 m278 모바일 넘침 수정 + uat369 넘침 축 정정

## 목표 / 비목표
- 목표: 폭 278px 모바일에서 심층 리포트 화면(`/analyst-report/:ticker/:date`)의 레이아웃 폭이 278 을 넘지 않게 한다. 지금은 000660 296px·CRCL 314px 다. 모바일 에뮬레이션은 레이아웃 뷰포트를 넓혀 `innerWidth` 도 같이 커지므로, uat369 `no-h-scroll`(innerWidth 기준)이 원리적으로 블라인드인 것도 함께 정정한다(task#393 회고 후속).
- 비목표: 다른 화면의 278 넘침, 백엔드·데이터 변경, 옛 lint 실패 정리, main 머지·prod 배포(사람 몫).

## 정본
- 용어: 없음
- 관련 ADR: 없음
- 실측 원인(2026-10-21, dev 스택 m278): ① `components/reports/SegmentAnalysisSection.jsx:238` 그리드 `minmax(260px, 1fr)` — 사업부문 카드가 260 고정 최소폭이라 278 에서 패딩과 합쳐 넘친다. ② `pages/AnalystReport.jsx` 증권사 행(~166-169) `minWidth:76` 금액 + `flexShrink:0` 날짜 `span.mono`(폭 66)가 줄어들지 않는다. ③ 「← 종목 리포트」 `a.list-pill`(폭 105)·하단 `nav.tabbar` 는 레이아웃 뷰포트가 넓어진 결과(①②가 풀리면 사라지는지 확인).
- 완료 정의(DoD):
  1. 프로브 정정 후, **CSS 수정 전 dev 스택**에서 `BASE=http://127.0.0.1:8084 TICKER=CRCL node scripts/uat369-lens-report.mjs` 가 m278 의 `no-h-scroll`·`no-element-beyond-viewport` 에서 **FAIL**(red — 축의 이빨). run.md 에 그 출력 줄을 남긴다.
  2. CSS 수정 → dev commit·push → Deploy run(headSha == 그 커밋) success → 같은 명령이 CRCL·000660 모두 `FAIL 0` · 총계 == 기대 총계(green).
  3. `cd frontend && npm test` 통과(기준선 1090), 바꾼 파일에 `npx eslint <파일>` 새 오류 0.
  4. m278 라이트 스크린샷 2장(CRCL·000660, 사업부문 카드·증권사 행이 보이게)을 에이전트가 직접 열어 잘림·겹침이 없음을 run.md 에 한 줄로 기록. 경로를 남긴다.
  - 이 단언이 통과하면서도 깨질 수 있는 방식: 카드·날짜를 `overflow:hidden`·`display:none` 으로 숨기면 폭은 맞는다 → `no-element-beyond-viewport`·`content-preserved` 축이 막는다. 9렌즈 옛 판만 있는 dev 데이터라 렌즈 10 구역은 dev 에서 못 잰다(prod 10-21 판 실측: 렌즈 10 은 넘침 원인 아님).

## 작업 조각
- [ ] S1. `scripts/uat369-lens-report.mjs`: `BASE` 를 환경변수로 덮을 수 있게(기본값 prod 유지). `no-h-scroll` 을 설정 `viewport.width` 기준으로(`innerWidth === viewport.width && scrollWidth <= viewport.width`, detail 에 innerWidth·scrollWidth). 새 축 `no-element-beyond-viewport`(보이는 요소 right > width+0.5, `overflow-x: auto|scroll` 조상 내부 제외 — detail 에 최대 3개 셀렉터·right) 와 `content-preserved`(pc1440 의 「매출 비중」 개수·증권사 날짜 집합을 기억해 모바일에서 같은지) 추가, 기대 총계 갱신. 상단 주석의 「no-h-scroll 은 innerWidth 기준이라 블라인드」 문장 정정. — 완료 기준: CSS 수정 전 dev 스택에서 CRCL m278 이 새 축에서 FAIL(DoD 1).
- [ ] S2. 넘침 수정: `SegmentAnalysisSection` 그리드를 `minmax(min(260px, 100%), 1fr)` 로, 증권사 행은 좁은 폭에서 줄어들거나 줄바꿈되게(고정 `minWidth`·`flexShrink:0` 조정). 그 밖에 S1 축이 지목하는 요소만 고친다. 다른 폭(m350·m390·pc1440)의 배치는 바뀌지 않아야 한다. — 완료 기준: 로컬 vitest 통과 (depends: S1)
- [ ] S3. dev 에 commit·push(코드+프로브 한 커밋, `.forge` 상태 포함 가능) → Deploy run 착지 확인 → uat369 CRCL·000660 green → 스크린샷 육안 확인. — 완료 기준: DoD 2·4 (depends: S2)

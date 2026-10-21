<!-- forge-slug: research-tabs-deep-reopen -->
<!-- task: 396 -->
<!-- tdd: on -->
# 리서치 탭을 「리포트·심층·기술·추천·랭킹·비교」로 재구성 — 심층 리포트 목록을 전 사용자에게 다시 연다

## 목표 / 비목표
- 목표: 리서치 섹션 탭을 **리포트 · 심층 · 기술 · 추천 · 랭킹 · 비교** 순서로 바꾼다. 「심층」은 `/analyst-reports`(심층 리포트 목록)를 **모든 사용자**에게 보여준다. admin 도구(대상 지정·즉시 발행·종목 단위 삭제)는 그 화면 안에서 `isAdmin`일 때만 보인다. 이것은 ADR-0047 결정 5를 고치는 일이다.
- 비목표:
  - 정식 명칭 「주요기술 리포트」 개명은 하지 않는다. 화면 제목·글로서리·API 문서·루틴 프롬프트·ADR 본문은 그대로다(nav 라벨만 「기술」).
  - API·DB 변경은 없다. `GET /api/analyst-reports` 인증은 그대로다.
  - 리포트 상세의 「심층 리포트」 탭(ADR-0047 결정 1·3)은 유지한다.
  - 문서 라우트 `/analyst-report/:ticker/:date`는 유지한다.
  - `matchesItem` 매칭 로직(접두사)은 바꾸지 않는다.

## 정본
- 글로서리: `.forge/CONTEXT.md` 「심층 리포트 (Analyst Report)」(화면 위치 문장)·「리포트」·「주요기술 리포트」
- 관련 ADR: `.forge/adr/0047-report-family-merge-by-key-cardinality.md`(결정 5 개정 대상), ADR-0027 개정 노트 2 ②(관리 수단 3종 유지 — 계속 지킨다), ADR-0026(마스트헤드 IA)
- 그릴링 합의:
  1. 「심층」 = 심층 리포트 목록을 전 사용자에게 연다. 비-admin을 `/reports`로 보내던 리다이렉트를 없앤다.
  2. 탭 강조: 「리포트」 match는 `/reports`만 잡는다. 「심층」은 `to: '/analyst-reports'`, match `/analyst-report` 하나로 목록과 문서를 모두 잡는다. 이렇게 하면 형제 탭끼리 접두사가 겹치지 않는다(`navSections.js`의 「천장」 해소).
  3. 리포트 목록의 admin 링크 「심층 발행 관리 →」(`Reports.jsx`)는 없앤다. 진입점은 「심층」 탭 하나다.
  4. 「주요기술」 nav 라벨을 「기술」로 바꾸고, 약 300px 미만에서 `.seg` 탭 좌우 여백을 줄인다. 278px에서 6탭이 한 줄에 들어가야 한다(현재 추정치는 약 258px 필요 / 238px 가용).
- 완료 정의(DoD):
  1. `cd frontend && npx vitest run src/test/nav-active-matching.test.jsx src/test/report-family-boundary.test.jsx src/test/reports-deep-link-navkey.test.jsx src/pages/AnalystReports.test.jsx` → 전부 통과하고, 새 단언(아래 S1)이 포함돼 있다.
     - 착수 전 상태: 4파일 34테스트 통과. 이 수치는 옛 동작을 단언하는 상태라 회귀 가드가 아니다. TDD로 단언을 먼저 새 동작으로 바꿔 red를 확인한다.
  2. `grep -c "label: '심층'" frontend/src/navSections.js` → 1.
     - 착수 전 상태: 0. 전진 검사가 정상적으로 실패하고 있다.
  3. `grep -rn "심층 발행 관리" frontend/src | grep -v '\.test\.'` → 0행.
     - 착수 전 상태: 1행(`Reports.jsx:290`). 이 문자열은 비목표상 남겨야 할 곳이 없다.
  4. `cd frontend && npx vitest run` 전체 통과.
  5. `grep -rn "주요기술" frontend/src scripts` 히트를 전부 분류한다. **nav 라벨로 쓰인 것**(탭 클릭·active 판정 라벨)은 「기술」로 바꾸고, **문서 명칭**(「주요기술 리포트」 제목 등)은 유지한다. 분류표는 run.md에 남긴다.
     - 착수 전 상태: frontend/src·scripts 합계 38파일에 히트(상위 디렉터리 포함 집계). 숫자 일치가 아니라 분류 완료가 기준이다.
  6. 문서 3곳 갱신:
     - `README.md` 「리서치」 절의 표 행 순서·「심층」 행 추가·「주요기술」 행 라벨
     - `.forge/branch/dev/CONTEXT.md`(오버레이) 「심층 리포트」 화면 위치 문장
     - ADR-0047 개정 노트(결정 5 → 「심층」 탭으로 목록 재개방, 비-admin 리다이렉트 폐지, 링크 제거)
     - 확인: `grep -n "심층 발행 관리\|비-admin.*리다이렉트" README.md .forge/CONTEXT.md` 히트를 검토해 거짓이 된 문장이 남지 않게 한다.
  7. 라이브 확인(배포 뒤):
     - 278px·360px 모바일에서 리서치 `.seg`의 `scrollWidth <= clientWidth`이고, 탭 순서가 리포트·심층·기술·추천·랭킹·비교다.
     - 비-admin 계정(test@portfolion.com)으로 `/analyst-reports`에 가면 URL이 유지되고 발행물 그리드가 보이며, 「자동 발행 대상 관리」는 보이지 않는다.
     - 문서 페이지에서 「심층」이 active다.
     - **육안 스크린샷 1장(278px)**을 남긴다.
     - 이 단언이 통과하면서도 깨질 수 있는 방식: 탭 라벨이 ellipsis로 잘리거나 높이 2줄로 접혀도 `scrollWidth`는 통과한다. 그래서 라벨 `scrollWidth <= clientWidth`도 함께 재고 스크린샷으로 본다.

## 작업 조각
- [ ] S1. (TDD red) vitest 단언을 새 동작으로 먼저 바꾸고 red를 확인한다.
  - `nav-active-matching`: 리서치 라벨 배열 순서 `['리포트','심층','기술','추천','랭킹','비교']`. `/analyst-reports`·`/analyst-report/:t/:d`에서 「심층」만 active이고 「리포트」는 아님(대조군).
  - `report-family-boundary`: 비-admin이 `/analyst-reports`에 머물러 목록을 보고, admin 도구는 없음. admin은 도구가 보임.
  - `reports-deep-link-navkey`: admin 링크 부재.
  - 완료기준: 수정한 단언이 현재 코드에서 FAIL한다(실패 출력을 run.md에 기록).
- [ ] S2. 구현 — 완료기준: DoD 1·2·3·4 통과. (의존: S1)
  - `navSections.js`: 순서·「심층」 항목 추가·리포트 match 축소·「기술」 라벨, 주석 갱신.
  - `AnalystReportsRoute.jsx`: 리다이렉트 제거. 파일을 유지할지는 테스트 마운트 필요성을 보고 정한다.
  - `Reports.jsx`: 링크와 그 주석 제거.
  - `mobile.css`: 좁은 폭 `.seg` 여백 축소.
- [ ] S3. 「주요기술」 문자열 전역 분류(DoD 5) 및 라이브 프로브 갱신 — 완료기준: 분류표 작성, 그리고 아래 프로브가 새 동작을 단언하도록 수정(옛 단언이 남지 않음). (의존: S2)
  - `scripts/uat215-deep-report-tab.mjs`: ⓖ 리다이렉트 → 비-admin 목록 열람, nav 단언
  - `scripts/uat251-nav-active.mjs`: 목록·문서 active = 「심층」
  - `scripts/uat299-tech-rename.mjs`: 라벨이 쓰이는지 확인
- [ ] S4. 문서 갱신(DoD 6) — 완료기준: README·CONTEXT 오버레이·ADR-0047 개정 노트 반영. 코드와 같은 커밋에 넣는다. (의존: S2)
- [ ] S5. 배포 후 라이브 검증(DoD 7) — 완료기준: 프로브 PASS, 278px 스크린샷에서 6탭이 한 줄로 잘림 없이 보임. (의존: S3, S4)

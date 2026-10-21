<!-- forge-slug: lens-signal-detail-inline-expand -->
<!-- task: 398 -->
<!-- tdd: off -->
# 심층 리포트 렌즈 신호와 상세를 한 행으로 — 신호 행 안에서 상세를 펼친다

## 목표 / 비목표
- 목표: 심층 리포트 상세(`LensReport.jsx`) 화면의 「렌즈 신호」(10행)와 「렌즈 상세」(카드 10장)를 **한 목록으로 합친다**.
  - 각 신호 행 안에 「상세 ⌄」 버튼을 두고, 누르면 그 자리에서 상세가 펼쳐진다.
  - 렌즈 하나를 읽으려고 아래 절로 점프했다가 돌아올 길을 찾는 불편을 없앤다. 지금은 돌아오는 링크가 없다.
  - 요약 문장의 중복도 없앤다. 지금은 신호 행과 상세 카드 머리에 같은 문장이 두 번 나온다.
  - 기본 상태는 전부 접힘이다. 그래서 페이지는 지금보다 짧아진다.
- 비목표:
  - 펼친 상태는 기억하지 않는다(localStorage 등).
  - `#lens-N` 주소로 들어왔을 때 자동으로 펼치고 스크롤하는 기능은 만들지 않는다. 앱 안에서 그 앵커로 들어오는 링크가 없다.
  - PC 좌우 분할·칩 탭(렌즈 한 장씩 보기) 레이아웃은 하지 않는다. 그릴링에서 기각했다.
  - 구조 축의 위치는 바꾸지 않는다. 합쳐진 목록 아래에 그대로 둔다.
  - API·발행 계약·루틴 프롬프트·데이터는 바꾸지 않는다. 프론트 렌더 구조만 바꾼다.
  - 집계(Tally) 표시는 바꾸지 않는다.

## 정본
- 글로서리: `.forge/branch/dev/CONTEXT.md` 「렌즈」·「렌즈 신호」·「심층 리포트」. 용어 변경은 없다.
  - 「렌즈 상세」는 글로서리 용어가 아니다. 지금 화면 절 이름일 뿐이므로, 그 절이 사라져도 문서를 고칠 필요가 없다.
- 관련 ADR: 없음
- 관련 규칙:
  - `~/.claude/design/UIUX.md`: 착수 직전 1토막, 터치 타깃 44px, 포커스 링 유지.
  - `frontend/CLAUDE.md`
    - 「flex 항목을 늘리면 CJK 라벨이 낱자로 적층된다」 — 머리 줄에 배지가 들어오므로 `keep-all` + `flexWrap`.
    - 「한국어 자유 서술 필드는 자르지 않는다」 — 펼침은 `display` 토글이지 line-clamp가 아니다.
    - 「flexWrap 안전망만으로는 행마다 줄바꿈 위치가 갈린다」.
  - 기존 펼침 관용구: 같은 파일의 `PrecedentRow`. `<button aria-expanded>` + `useState`.
- 그릴링 합의(2026-10-22):
  1. **레이아웃 = 행 펼침.** 네 안 중에 골랐다(행 펼침 / 칩 탭 / PC 좌우 분할 / 구조 유지 + 이동 링크).
  2. **접힌 행에 보이는 것**
     - 번호·이름·`?`·신호, 그리고 **「추정 기반」·「애널 추정치」 배지**(상세 머리에서 신호 옆으로 올린다). 배지는 신호 색이 어디서 왔는지 알려 주는 단서라, 접힌 상태에서도 보여야 한다.
     - 요약.
     - 게이지 / 조건 목록 / 바뀜 조건 문장 / 미산출 사유(지금과 같다).
     - **렌즈 10**은 대상 위험 한 줄과 기저율 막대·건수 캡션까지 보인다. 다른 렌즈의 게이지와 같은 역할이기 때문이다.
  3. **펼치면 보이는 것**
     - 수치(Metrics), 본문(body), 서버 계산(ComputedBlock), 원자료(InputsTable — 펼침 안에서도 `<details>`로 유지).
     - 렌즈 10은 여기에 **사례 목록**(PrecedentRow — 행마다 다시 펼친다)이 더해진다.
     - 요약은 다시 그리지 않는다.
  4. **펼침 동작**
     - 기본은 전부 접힘이다. 「렌즈 신호」 제목 줄 오른쪽에 「모두 펼치기 / 모두 접기」 토글을 둔다.
     - 각 행 하단에 「상세 ⌄/⌃」 버튼을 둔다. `<button aria-expanded>`이고 높이 ≥ 44px이다.
     - 이름의 `#lens-N` 앵커 링크는 없앤다. 이름은 그냥 글자로 둔다. `?` 버튼은 유지한다.
     - 펼칠 내용(metrics·body·computed·inputs·precedents)이 하나도 없는 행에는 「상세」 버튼이 없다. 미산출 렌즈가 여기에 해당할 수 있다.
  5. **「렌즈 상세」 절과 `LensDetail` 카드를 없앤다.**
     - 행의 왼쪽 테두리 신호색(`borderLeft 3px`)은 행에 이미 있다.
     - 상세 머리의 큰 번호(serif 22px)는 없어진다.
  6. 검증: vitest(펼침 동작·배지 위치·내용 소속) + 라이브 프로브 2개 갱신 + dev red-first + 폰 폭 육안 스크린샷.

## 완료 정의(DoD)
1. `cd frontend && npx vitest run src/pages/AnalystReport.test.jsx src/test/lens10.test.jsx` → 전부 통과하고, S1의 새 단언이 들어 있다.
   - 착수 전 상태: 47/47 통과. 새 단언이 아직 없다. 기존 단언 일부(`#lens-N` 카드, `data-lens-detail-name`)는 새 구조에서 깨지므로 S1에서 다시 쓴다. **기존 통과는 회귀 가드가 아니다.**
2. `grep -c "<SectionTitle>렌즈 상세" frontend/src/components/reports/LensReport.jsx` → 0.
   - 착수 전 상태: 1. 전진 검사가 정상적으로 실패하고 있다.
3. `cd frontend && npx vitest run` 전체 통과.
   - 알려진 flake(task#395 회고: 4회 중 1회 1건)가 보이면 `--reporter=verbose` 출력을 파일로 남겨 어느 테스트인지 식별한다.
4. 라이브 프로브 `BASE=<dev 또는 prod> node scripts/uat369-lens-report.mjs`·`node scripts/uat373-lens-badges.mjs` ALL PASS. S3의 새 축을 m278·m390·pc1440에 둔다.
   - **red-first**: push **전에** 옛 코드가 도는 dev(127.0.0.1:8084)에서 새 축(펼침 버튼 존재·접힘 기본·배지가 행 머리에 있음)이 FAIL하는지 확인한다.
   - dev 표본이 없으면 `scripts/dev-seed-analyst-report.py`로 시딩한다(task#395 회고). 렌즈 10이 있는 판과 없는 판을 하나씩 준비한다.
5. **육안 스크린샷 2장(m278)**: ① 전부 접힘 ② 렌즈 하나(계산 렌즈, 예: 3 또는 8) + 렌즈 10 펼침.
   - 확인할 것: 머리 줄이 낱자로 적층되지 않는다. 모든 행이 같은 모양이다. 펼친 내용이 행 테두리 안에 있다.
   - **이 단언이 통과하면서도 깨질 수 있는 방식**: 프로브가 「상세 버튼 클릭 → 본문 텍스트 존재」만 재면, 본문이 **행 밖**(형제 요소)에 렌더돼도 통과한다. 그래서 펼친 내용이 `[data-lens-cell=N]`의 **자손**인지(소속)와 상자 관계(내용 rect ⊂ 행 rect)를 함께 잰다. 또 배지를 머리에 올린 뒤 m278에서 `headerOverflow`가 0이어도 이름이 낱자로 쪼개질 수 있다(넘침 축은 이것을 못 본다). 그래서 기존 `nameStack` 축을 유지하고 스크린샷으로도 닫는다.

## 작업 조각
- [ ] S1. vitest 단언을 다시 쓰고 추가한다(`AnalystReport.test.jsx`·`lens10.test.jsx`) — 완료기준: 현재 코드에서 새 단언이 FAIL한다(출력은 run.md).
  - 기본 상태: 본문(body)·ComputedBlock·`[data-precedent]`가 DOM에 없다.
  - 렌즈 10의 `[data-base-rate-bar]`·`[data-lens10-risk]`는 접힌 상태에서도 `[data-lens-cell="10"]` 안에 있다.
  - 「상세」 버튼 클릭 → `aria-expanded="true"`, 본문이 **그 행의 자손**으로 나타나고 다른 행은 그대로 접혀 있다.
  - 「모두 펼치기」 → 상세 버튼이 있는 행이 전부 펼쳐진다. 다시 누르면 전부 접힌다.
  - 배지(`추정 기반`·`애널 추정치`)가 접힌 행 머리(`[data-lens-cell] > div:first-child`)에 있다.
  - 요약 문장은 행마다 1회만 나온다(중복 제거).
  - 펼칠 내용이 없는 행에는 상세 버튼이 없다.
  - 기존 `#lens-N`·`data-lens-detail-name` 참조는 `[data-lens-cell=N]` 기준으로 옮긴다. 렌즈 3 basis, 렌즈 4 원자료 FactSet, 렌즈 10 사례 행은 펼친 뒤 단언한다.
- [ ] S2. 구현(`frontend/src/components/reports/LensReport.jsx`만) — 완료기준: DoD 1~3. (의존: S1)
  - 착수 직전 1토막(UIUX §2)을 run.md에 적는다.
  - `SignalList` 행에 펼침 상태를 둔다. 「모두 펼치기」는 `LensReport`가 소유하는 상위 상태로, 행 상태와의 동기 방식은 구현이 정한다(가장 단순한 쪽).
  - `LensDetail`의 몸통(Metrics·BaseRate의 사례 목록·body·ComputedBlock·InputsTable)을 행 안 펼침 영역으로 옮긴다. `BaseRate`는 「위험 + 막대」(항상 보임)와 「사례 목록」(펼침)으로 나눈다.
  - 상세 머리의 배지 2종을 행 머리로 옮긴다. `keep-all` + `flexWrap: 'wrap'`을 쓴다.
  - 이름 `<a href="#lens-N">`을 일반 요소로 바꾼다. `data-lens-name` 속성은 유지한다(프로브·테스트가 쓴다).
  - `<SectionTitle>렌즈 상세</SectionTitle>` 절과 `LensDetail`를 삭제하고, 파일 머리 주석의 순서 설명(8행)과 15행 「두 렌더 위치」 주석을 고친다.
  - 쓸모가 없어진 `data-lens-detail-name`은 지운다(소비처: 테스트·uat369 — S1·S3에서 함께 정리).
- [ ] S3. 라이브 프로브를 갱신한다(`scripts/uat369-lens-report.mjs`·`scripts/uat373-lens-badges.mjs`) — 완료기준: 옛 코드 dev에서 새 축이 red다. (S2 전에 저작 가능 — red-first는 push 전에 돌린다)
  - 사라지는 참조를 옮긴다: `detailNames`·`lens-names-detail`·`#lens-10`·`[id^="lens-"]`·`#lens-3 [data-lens-basis]`. 렌즈 10 사례 행과 basis는 「상세」를 클릭한 뒤 잰다.
  - 새 축
    - ① 접힘 기본: 상세 버튼 수 > 0이고 전부 `aria-expanded=false`, 본문 미존재.
    - ② 펼침 소속: 클릭 뒤 내용이 그 행의 자손이고, rect ⊂ 행 rect.
    - ③ 배지 위치: API의 `estimate_based`/`consensus_based` 렌즈 수 == 행 머리 배지 수(커버리지 카운터. 0이면 「표본 없음」으로 표기).
    - ④ 상세 버튼 높이 ≥ 44.
    - ⑤ 펼친 상태에서도 페이지·행 넘침 0.
  - 기존 축은 유지한다(nameStack·headerOverflow·lens10 막대·캡션). 렌즈 개수 단언은 9|10을 그대로 둔다.
- [ ] S4. dev push → dev 배포 후 라이브 검증 — 완료기준: DoD 4·5. (의존: S2, S3)
  - 라이브를 재는 동안 push·재기동을 하지 않는다.
  - main 머지는 PR URL을 넘겨 사람이 한다. 운영 판정은 Deploy run `headSha` + 세대 + 운영 프로브로 한다.

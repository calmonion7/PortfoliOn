<!-- forge-slug: lens-source-disclosure-affordance -->
<!-- task: 407 -->
<!-- tdd: off -->
<!-- retro-hint: optional -->
# 렌즈 상세의 「원자료 N건 — 출처」 접힘이 눌러지는 것임을 알게 한다

## 목표 / 비목표
- 목표: 심층 리포트 렌즈 상세를 펼쳤을 때 맨 아래 원자료 접힘이 **누르면 펼쳐지는 것**으로 읽히게 한다. 같은 카드의 「상세 ⌄」 버튼과 같은 모양을 쓴다.
- 원인(조사 확정): `frontend/src/components/reports/LensReport.jsx` `InputsTable`의 `<summary>`에 `display: 'flex'`를 줘서 브라우저 기본 ▸ 표시가 사라졌다. 그 결과 회색 11px(`smallCap`) 캡션처럼만 보였다(사용자 스크린샷 2026-10-25, 렌즈 3 「원자료 4건 — 출처」). `<summary>`가 쓰인 곳은 프론트 전체에서 이 한 곳뿐이다.
- 결정(fg-ask 2026-10-25):
  - 모양은 「상세」와 같은 화살표로 한다. 문구는 `출처 보기 · 원자료 N건`이고, 접힘이면 `⌄`, 펼침이면 `⌃`를 붙인다.
  - 글자 크기·색·굵기는 「상세」 버튼(`fontSize 12 · fontWeight 600 · color var(--text-2, var(--text))`)에 맞춘다.
  - 터치 높이는 32에서 44px로 올린다(UIUX 6항).
  - 펼쳤을 때 문구는 바꾸지 않고 화살표만 뒤집는다(「상세」와 같다).
  - 테두리 칩이나 접힘 제거안은 채택하지 않았다.
- 구현 방침(코드 조사로 결정, 질문하지 않음): `<details>`를 유지한다. 화살표 상태는 `onToggle={e => setOpen(e.currentTarget.open)}`로 React state에 둔다. 이유는 둘이다.
  - 기존 테스트 2곳(`AnalystReport.test.jsx` 「ⓒ 애널 추정치」·「펼침 — 원자료 근거에 용어 버튼」)이 **details를 열지 않고** `details li`를 찾는다. button과 조건부 렌더로 바꾸면 두 테스트가 깨진다.
  - 네이티브 접힘 동작을 그대로 쓸 수 있다.
- 비목표:
  - 「상세」 버튼·사례 행(`PrecedentRow`) 등 다른 접힘의 모양 변경.
  - 원자료 목록 안쪽 레이아웃.
  - 펼침 상태 기억.
  - 다른 화면의 「출처:」 캡션(BacklogChart·SegmentAnalysis 등 — 접힘이 아니다).

## 기준
- 용어: 없음(CONTEXT.md 변경 없음).
- 관련 ADR: 없음.
- 개명 감사: 옛 문구 `건 — 출처`는 `frontend/src`·`scripts/`·`.claude/skills`·README·API_SPEC·CONTEXT 전역에서 소비처 0곳이다(2026-10-25 grep, LensReport.jsx:408 자신만). 그래서 테스트·프로브의 문자열 기준점 파급은 없다.

## 작업 슬라이스
- [ ] S1. `InputsTable`의 summary를 바꾼다.
  - 내용: 문구 `출처 보기 · 원자료 {N}건` + `aria-hidden` 화살표(`⌄`/`⌃`, 「상세」와 같은 `fontSize: 13`), 「상세」 버튼 글자 스타일, `minHeight: 44`.
  - `<details>`에 `onToggle`을 붙여 화살표 상태를 둔다.
  - 완료기준: 아래 S2 테스트가 통과한다.
- [ ] S2. vitest 단언을 추가한다(`AnalystReport.test.jsx` 기존 원자료 describe 옆).
  - 렌즈 상세를 펼친다. summary 텍스트가 `출처 보기 · 원자료 N건`을 포함하고 `⌄`가 보이는지 단언한다.
  - details를 열고 `⌃`로 바뀌는지 단언한다.
  - jsdom이 summary 클릭으로 `open`을 토글하지 않으면 `details.open = true` 후 `toggle` 이벤트를 직접 dispatch한다.
  - 완료기준: 새 단언이 통과하고, 기존 `AnalystReport.test.jsx` 53건과 `lens10.test.jsx`가 무회귀다. (의존: S1)
- [ ] S3. dev에서 육안 확인한다(루트 CLAUDE.md ⓐ).
  - dev 브랜치에 commit+push하고, dev 스택 127.0.0.1:8084의 Deploy run `headSha`와 `conclusion=success`를 확인한다.
  - 계산 렌즈(3·4·5·8 중 원자료가 있는 판)를 360px 폭에서 「상세」를 펼친 상태로 스크린샷 2장 찍는다(원자료 접힘·펼침). 표본이 없으면 `scripts/dev-seed-analyst-report.py`로 시딩한다.
  - 완료기준: 스크린샷에서 다음이 보인다.
    - 「출처 보기 · 원자료 N건 ⌄」가 「상세 ⌄」와 같은 굵기·색으로 보인다.
    - 펼친 뒤 `⌃`로 바뀌고 원자료 목록이 보인다.
    - 줄바꿈·넘침이 없다.
  - (의존: S2)
- [ ] S4. 운영에 반영한다.
  - dev→main PR을 만들어 **PR URL**을 넘긴다. 머지는 사람이 한다.
  - 머지 뒤 main Deploy run의 `headSha`·세대를 확인한다.
  - 완료기준: PR URL을 전달하고, 머지되면 운영 세대가 그 커밋이다. (의존: S3)

## 완료 정의 (DoD)
1. `cd frontend && npx vitest run src/pages/AnalystReport.test.jsx src/test/lens10.test.jsx` → 새 단언(문구·`⌄`→`⌃`) 포함 전부 통과.
   - 작성 시 사전 상태: AnalystReport 53/53 통과. 새 단언은 아직 없다. 그래서 회귀 가드 부분만 미리 통과하는 것이 정상이다.
2. dev 스크린샷 2장(접힘·펼침, 360px): 화살표가 보이고, 「상세」와 같은 스타일이고, 넘침이 없다.
3. dev→main PR URL을 전달한다.
- 영구 회귀 검사: DoD 1의 vitest 단언(문구·화살표 토글)이 맡는다. 「눈에 띄는가」 자체는 기계로 판정할 수 없어 DoD 2의 육안이 맡는다.
- 「이 단언이 통과하면서도 깨질 수 있는 방식」:
  - vitest는 문구와 화살표 글자만 본다. 그래서 화살표가 `smallCap` 회색 11px로 남아 여전히 캡션처럼 보여도 통과한다. 굵기·색은 스크린샷에서 「상세」와 나란히 비교한다.
  - jsdom의 `toggle` 이벤트는 실브라우저와 다를 수 있다. 실제 탭으로 화살표가 뒤집히는지는 S3 펼침 스크린샷이 증명한다.

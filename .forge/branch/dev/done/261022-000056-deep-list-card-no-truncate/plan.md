<!-- forge-slug: deep-list-card-no-truncate -->
<!-- task: 397 -->
<!-- tdd: on -->
<!-- retro-hint: optional -->
# 심층 목록 카드가 종목명·한줄 논지를 「…」로 자르지 않게 한다 — 제목 전체폭 3행 카드

## 목표 / 비목표
- 목표: 심층 리포트 목록(`/analyst-reports`) 카드의 **종목명**과 **한줄 논지(`title`)**를 자르지 않는다. task#331 B54(「한국어 자유 서술 필드는 목록에서도 자르지 않는다」)를 지킨다. task#396에서 이 목록이 전 사용자에게 열려 노출이 커졌다(같은 회고의 후속 후보 1번).
- 비목표:
  - 「자동 발행 대상 관리」(admin) 행은 손대지 않는다. 자르기가 없다.
  - 제목 줄 수 제한(line-clamp)은 하지 않는다. 결론이 문장 끝에 오므로 B54 위반이다.
  - API·데이터·문서 변경은 없다. `title` 길이를 줄이는 루틴 프롬프트 변경도 하지 않는다.
  - 리포트 상세·주요기술 목록 등 다른 화면의 ellipsis 감사는 이번 범위가 아니다.

## 정본
- 글로서리: `.forge/CONTEXT.md` 「심층 리포트 (Analyst Report)」(용어 변경 없음)
- 관련 규칙: `frontend/CLAUDE.md` ⭐「한국어 자유 서술 필드는 목록에서도 자르지 않는다(task#331 B54)」. 처방 쌍 `wordBreak: 'keep-all'` + `overflowWrap: 'break-word'`를 쓴다. **`anywhere`는 쓰지 않는다**(iOS 15.4 미만에서 선언이 무시된다).
- 관련 ADR: 없음(task#225의 「2행 고정 구조」 주석을 이번에 3행 구조로 바꾼다)
- 그릴링 합의:
  1. **배치 = 제목 전체폭 3행.**
     - 1행: 이름(좌, 어절 단위 줄바꿈) | 티커·신호점/옛 형식 배지(우, 위쪽 정렬)
     - 2행: 제목이 카드 전체 폭으로 흐른다
     - 3행: 날짜·admin 삭제(우측 정렬)
  2. **높이 증가는 의도된 대가다.** 회의 중 dev 실데이터 10장으로 DOM what-if를 했다. 카드 높이는 m350 72→138~182px, m390 72→138px, pc1440 72→95~116px이고, 가로 넘침은 0이었다. 긴 이름(Circle Internet Group)은 m350에서 2줄이 된다. 착수 전 잘림 수: m350에서 span 11개(제목 10·이름 1), m390 10, pc1440 7. 이 what-if 스크립트는 scratchpad에 있었고 휘발된다.
  3. 검증: vitest 스타일 단언(TDD red 먼저) + 기존 `scripts/uat215-deep-report-tab.mjs`에 라이브 축 추가 + 폰 폭 육안 스크린샷 1장.

## 완료 정의(DoD)
1. `cd frontend && npx vitest run src/pages/AnalystReports.test.jsx` → 전부 통과하고, S1의 새 단언이 들어 있다.
   - 착수 전 상태: 9/9 통과. 새 단언이 아직 없으므로 회귀 가드가 아니다. S1에서 red를 확인한다.
2. `grep -c "textOverflow: 'ellipsis'" frontend/src/pages/AnalystReports.jsx` → 0.
   - 착수 전 상태: 2. 전진 검사가 정상적으로 실패하고 있다.
3. `grep -c "wordBreak: 'keep-all'" frontend/src/pages/AnalystReports.jsx` → 2 이상.
   - 착수 전 상태: 0. 전진 검사가 정상적으로 실패하고 있다.
4. `cd frontend && npx vitest run` 전체 통과.
5. 라이브 프로브 `BASE=<dev 또는 prod> node scripts/uat215-deep-report-tab.mjs` ALL PASS. 새 축(S3)을 m350·m390·pc 각각에 둔다.
   - **red-first**: push **전에** 옛 코드가 도는 dev(127.0.0.1:8084)에서 새 축 ①(잘림 0)이 FAIL하는지 확인한다(착수 전 실측으로는 m350에서 11개가 잘린다).
   - 축 ③(정렬)은 옛 코드에서도 통과하는 축이다. 그래서 what-if 대조군(우측 메타 한 장에 `marginRight` 주입 → FAIL)으로 이빨을 확인한다(task#396 회고 ⓤ).
6. **육안 스크린샷 1장(m350)**: 모든 카드가 같은 3행 모양이고, 우측 티커·신호점 열과 날짜 열이 카드마다 같은 오른쪽 선에 있다.
   - 이 단언이 통과하면서도 깨질 수 있는 방식: `scrollWidth <= clientWidth`는 텍스트가 **낱자로 세로 적층**돼도 통과한다(task#324). 그래서 스크린샷으로 어절 줄바꿈인지 확인하고, 이름 span 높이가 1~2줄 범위인지도 잰다.

## 작업 조각
- [ ] S1. (TDD red) `AnalystReports.test.jsx`에 단언을 추가하고 현재 코드에서 FAIL하는지 확인한다(출력은 run.md).
  - 카드의 이름·제목 span 인라인 스타일에 `textOverflow: ellipsis`·`whiteSpace: nowrap`이 **없고** `wordBreak: keep-all` + `overflowWrap: break-word`가 **있다**.
  - 날짜가 제목과 **다른 행**(형제 div)에 있다. admin이면 삭제 버튼이 날짜와 같은 행에 있다(admin 대조군 포함 — 비-admin은 삭제 없음).
- [ ] S2. 구현(`frontend/src/pages/AnalystReports.jsx`만) — 완료기준: DoD 1~4. (의존: S1)
  - 1행 `alignItems: 'flex-start'`, 이름 span의 자르기 3속성을 제거하고 처방 쌍을 넣는다(`minWidth: 0` 유지).
  - 2행은 제목만 남긴다(블록, 처방 쌍). 3행 `display:flex; justifyContent:flex-end; marginTop:4`에 날짜·삭제를 둔다.
  - task#225 주석을 3행 구조와 그 이유(B54)로 바꾼다.
- [ ] S3. `scripts/uat215-deep-report-tab.mjs` ⓖ(비-admin 목록)에 축을 추가한다 — 완료기준: 옛 코드 dev에서 ①이 red, ③은 what-if 대조군에서 red. (의존: S2 전에 저작 가능 — red-first는 push 전에 돌린다)
  - ① 카드마다 이름·제목 요소의 `scrollWidth <= clientWidth`, 계산된 `text-overflow`가 `ellipsis`가 아님(커버리지 카운터: 잰 카드 수 == 목록 카드 수 > 0)
  - ② `documentElement.scrollWidth <= innerWidth`
  - ③ 티커 묶음 right·날짜 right가 카드 간 ±0.5px로 같음
  - ④ 이름 span 높이 ≤ 2줄(낱자 적층 sentinel)
  - 뷰포트 m350·m390·pc1440
- [ ] S4. dev push → dev 배포 후 라이브 검증 — 완료기준: DoD 5·6. (의존: S2, S3)
  - 라이브를 재는 동안에는 push·재기동을 하지 않는다.
  - admin 삭제 버튼 배치는 비-admin 계정이라 라이브로 재지 않는다. 그 부분은 vitest S1이 맡는다(알려진 공백으로 run.md에 기록).

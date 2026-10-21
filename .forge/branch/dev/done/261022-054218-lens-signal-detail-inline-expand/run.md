# RUN — 심층 리포트 렌즈 신호와 상세를 한 행으로 (task#398)

실행: 2026-10-22 · fg-loop 드라이브 · 직접 실행(파일 5개 규모라 워크플로 생략) · 커밋 `352cc44`(dev push → dev 세대 `261022-053921-352cc44`)

## 착수 직전 1토막 (UIUX §2)
- 여정: 심층 리포트 목록 → 상세 진입 → 렌즈 신호 10행을 훑는다 → 궁금한 렌즈만 그 자리에서 「상세」로 펼쳐 읽는다 → 다음 렌즈로 내려간다(점프·복귀 없음).
- 상태: 빈 상태 = 펼칠 내용 없는 렌즈는 버튼 없음 · 로딩/에러 = 호출측(AnalystReport) 그대로 · 긴 텍스트 = keep-all + break-word, 자르지 않음 · 좁은 폭 = m278에서 머리 2줄 고정(배지는 둘째 줄).
- 안 다룸: 펼침 상태 기억, `#lens-N` 딥링크, PC 분할, 집계 표시.

## 조각별 결과
- S1 vitest 단언 재작성·추가(AnalystReport 6건 신설 + 기존 재배치, lens10 7건 재배치) — ✅ 옛 코드에서 17건 FAIL 확인 후 착수
- S2 LensReport.jsx 행 펼침 구현 — ⚠ 배지를 「신호 옆」이 아니라 행 머리 **둘째 줄**에 둠(아래 결정 1). 새 컴포넌트 이름 `LensDetailBody` → `ExpandedDetail`(결정 2)
- S3 uat369(새 축 9종)·uat373(BASE 지원·행 머리 배지·렌즈 3 펼친 뒤 basis) — ✅ dev 옛 코드 red(369: 72 FAIL/326, 373: 30 FAIL/40)
- S4 dev push → 배포 → 라이브 검증 — ✅ 369 000660(10렌즈) 326/326 · CRCL(9렌즈) 326/326 · 373 40/40 · m278 스크린샷 2장

## DoD baseline → after
1. 표적 vitest: 47/47(새 단언 없음) → **53/53**(새 단언 포함)
2. `grep -c "<SectionTitle>렌즈 상세"`: 1 → **0**
3. 전체 vitest: (미측정) → **106 files · 1100 passed**
4. 라이브 프로브(dev): 옛 코드 red → **369 326/326 ×2판 · 373 40/40**. 렌즈 10 표본 8컨텍스트(000660), 배지 표본 추정 기반 3·애널 추정치 2(000660), 373 consensus_pos 11·estimate_pos 18·basis 10
5. 육안 m278: ① 전부 접힘 — 이름 적층 없음, 배지 둘째 줄, 행 모양 동일 ② 렌즈 8 + 렌즈 10 펼침 — 서버 계산·민감도·사례 목록·본문이 행 테두리 안

## 그 자리에서 내린 결정
1. **배지 위치 = 행 머리 둘째 줄.** 계획은 「상세 머리에서 신호 옆으로 올린다」였다. 그런데 한 줄에 넣으면 m350(가용 ~290px)에서 이름 8자 + `?` + 배지 2개 + 신호가 넘쳐 flexWrap에 맡겨지고, 배지 수와 이름 길이에 따라 행마다 줄바꿈 위치가 갈린다(frontend/CLAUDE.md task#394 가토). 그래서 머리(`[data-lens-cell] > div:first-child`) 안을 [번호·이름·?·신호] / [배지] 2줄로 고정했다. 계획의 셀렉터 계약은 그대로다.
2. C2 검사 `grep -c 'function LensDetail'`이 새 컴포넌트 `LensDetailBody`에 부분 일치해 거짓 FAIL하므로 `ExpandedDetail`로 개명했다(검사는 바꾸지 않음).
3. C1 조건 「`data-lens-detail-name` 0건」 때문에, 테스트에 넣었던 부정 단언(`[data-lens-detail-name]` 0개)을 「펼쳐도 이름이 렌즈마다 1회」로 바꿨다. 같은 회귀를 잡는다.
4. 펼칠 내용이 없는 행은 버튼 대신 10px 여백으로 바닥을 맞췄다(행 padding 하단을 버튼이 대신하기 때문).

## 계획이 놓친 것
- **세 번째 소비처**: `AnalystReport.test.jsx`의 task#275 테스트가 「렌즈 상세」 제목을 위치 기준점으로 썼다(계획 S1 목록에 없음). 기준점을 「렌즈 신호」로 옮겼다. → 「제목 문자열을 지우면 그 문자열을 기준점으로 쓰는 테스트를 grep」이 전역 grep 가토(루트 CLAUDE.md task#324)의 또 한 사례.
- 「?」 버튼 수가 18 → 9로 줄어드는 것(테스트 ⓑ·프로브 help-buttons-reached N×2 → N)도 계획에 없었다.

## 축의 이빨 메모
- `summary-once`·`expanded-no-overflow`(uat369)는 옛 코드에서도 PASS했다. 옛 코드의 요약 중복은 행 밖(상세 카드)에서 일어나고 펼침 자체가 없기 때문이다. 이 두 축은 회귀 가드로만 남는다. 페이지 단위 요약 중복은 vitest 「요약 문장은 행마다 한 번」이 잡는다(옛 코드에서 FAIL 확인).
- lint: `LensReport.jsx`의 react-refresh 3건은 기존 export(isLensReport·LENS_INFO·SIGNAL_META)에서 나는 선재 경고다. 이번 변경과 무관하다.
- 하니스: 이 저장소 Bash는 `sed` deny·`timeout` 미설치라, 출력 집계는 awk/grep으로 했다.

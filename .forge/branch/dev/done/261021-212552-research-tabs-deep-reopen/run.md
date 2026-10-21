# RUN — task#396 리서치 탭 「리포트·심층·기술·추천·랭킹·비교」 재구성
실행: 2026-10-21 · fg-loop 드라이브 · 직접 실행(워크플로 없음 — 파일 ~14개·슬라이스 5개, 단일 에이전트 규모)
커밋: `b34ca98` (dev push → Deploy run 39599013780 success, 세대 `261021-212208-b34ca98`)

## 슬라이스별 결과
- S1 vitest 단언을 새 동작으로 먼저 교체 → red 17건 확인 — ⚠ boundary 2건은 의도와 다른 이유(Toast 컨텍스트 부재)로 red였다. 원인 확인 후 Toast 목 추가 → 그 2건은 구현 전에도 green(아래 이탈 1)
- S2 navSections·App 라우트·Reports 링크 제거·mobile.css → 대상 4파일 34/34, 전체 1092/1092 — ✅ (라우트 래퍼 파일은 삭제를 택함)
- S3 「주요기술」 분류 + 프로브 3종 갱신 — ✅ (uat251엔 BASE env·m360/m278 seg-fit 축 추가)
- S4 README·CONTEXT(본+dev 오버레이)·ADR-0047 개정 노트 1 — ✅ (+ 본 `.forge/CONTEXT.md`도 같은 문장 정정, 이탈 2)
- S5 dev 라이브 검증 — ✅ uat251 74/74 · uat215 124/124 · 278 스크린샷 육안 확인

## DoD baseline → after
1. 대상 vitest 4파일: 34 pass(옛 동작 단언) → 단언 교체 후 red 17 → 구현 후 34/34 pass(새 단언 포함 — `RESEARCH_ORDER` 배열 단언 1건)
2. `grep -c "label: '심층'" navSections.js`: 0 → 1
3. 비테스트 「심층 발행 관리」: 1행(`Reports.jsx:290`) → 0행
4. 프론트 전체 vitest: (착수 전 green) → 1092/1092
5. 「주요기술」 분류(frontend/src·scripts 38파일): 문서 명칭 「주요기술 리포트」 35파일 — 유지 · 맥락 주석 3건(`tech-visual-guards.test.jsx:8`·`loopcheck-tech15.mjs:154`·`uat331-tech-visual.mjs:1`) — 유지 · **nav 라벨 2파일 3곳**(`uat215:213·217`·`uat299:298`) — 「기술」로 교체. 프론트 소스의 nav 라벨은 `navSections.js` 1곳(교체)과 vitest(교체)뿐이었다.
6. 문서: README 리서치 표(순서·「심층」 행·「기술」 행, 리포트 행의 링크/리다이렉트 문장 제거) · CONTEXT 「심층 리포트」 ⓒ 문장 · ADR-0047 개정 노트 1. 넓은 grep(`리다이렉트|발행 관리`)의 잔여 히트는 전부 「되돌렸다」를 서술하는 문장.
7. 라이브(dev 8084): 278·360·390·pc에서 6탭 순서·active 정확히 1개(「심층」, 「리포트」 비활성 대조군)·seg-fit(m278 scrollWidth 238 ≤ clientWidth 238 · 라벨 잘림 0 · 1줄) · 비-admin `/analyst-reports` URL 유지·발행물 링크 10개(API 10건)·첫 발행물 identity(SK하이닉스)·「자동 발행 대상 관리」 미노출 · 문서 경로 「심층」 active. 육안: `screenshots-uat251-nav/m278-목록.png` — 6탭 한 줄, 라벨 온전.

## 이탈·즉석 결정
1. **App 배선 red를 vitest로 못 냈다.** 리다이렉트는 `AnalystReportsRoute`(App.jsx 배선)에 있었고, 새 동작에선 래퍼 자체가 무의미해 파일을 삭제했다. 그러면 boundary 테스트는 페이지만 마운트하게 되어 「리다이렉트 없음」은 구현 전에도 green이다(이빨 없음 — 페이지 자체가 튕기지 않는지만 본다고 주석에 명시). App 배선의 게이트는 **라이브 uat215 ⓖ**(비-admin URL 유지)가 맡았다. 이빨 확인: uat251을 옛 nav인 prod에 대조 실행 → 순서·「심층」 active·「리포트」 비활성·「기술」 형제 축이 FAIL(got `리포트,추천,랭킹,비교,주요기술`).
2. **본 `.forge/CONTEXT.md`도 고쳤다.** 계획은 dev 오버레이만 지시했지만 루프 정지조건 C5가 본 용어집의 거짓 문장 0을 요구했다 → 오버레이에 갱신 항목을 두고 본 파일의 같은 문장도 같은 내용으로 정정(fg-merge 때 동일 내용이라 충돌 없음).
3. `Reports.jsx`의 `Link` import가 링크 제거로 고아가 되어 함께 지웠다.
4. ~~seg-fit 축의 이빨은 따로 재지 않았다 … 여백 축소 없이는 넘쳤을 가능성이 높다(추정, 미실측).~~ **회고에서 실측으로 반박**(dev, DOM what-if): 278에서 옛 6px 여백으로도 seg 238/238·잘림 0 — 필요 폭 207+6=213 < 가용 238. 「238/238」은 여유 0이 아니라 `flex:1`이 남는 폭을 나눠 가진 결과였다. 여백 축소 CSS는 253px 미만에서만 의미가 있어 걷어냈다(후속 커밋).

## 관찰(범위 밖 — 후속 후보)
- 심층 목록 카드가 **종목명·한줄 논지를 ellipsis로 자른다**(`AnalystReports.jsx:134·145`, task#225 2행 고정 구조). 278에서 「SK하이…」·「렌즈 10 파일럿 첫 판 —…」. frontend/CLAUDE.md의 「한국어 자유 서술 필드는 목록에서도 자르지 않는다(task#331 B54)」 위반이며, 이번에 이 화면이 전 사용자에게 열려 노출이 커졌다.
- `.forge/codebase/{STRUCTURE,ARCHITECTURE,CONVENTIONS,STACK}.md`(fg-map 스냅샷, tracked)가 삭제된 `routes/AnalystReportsRoute.jsx`를 아직 서술한다 — 다음 fg-map 재생성 대상.

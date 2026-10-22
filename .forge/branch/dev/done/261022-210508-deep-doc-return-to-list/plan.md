<!-- forge-slug: deep-doc-return-to-list -->
<!-- task: 402 -->
<!-- tdd: on -->
<!-- retro-hint: optional -->
# 심층 리포트 문서의 복귀 pill을 「← 종목 리포트」에서 「← 심층 목록」으로

## 목표 / 비목표
- 목표: 단독 문서 라우트 `/analyst-report/:ticker/:date`의 우하단 플로팅 복귀 버튼(`.list-pill`)과 에러 화면 복귀 링크가 **심층 목록 `/analyst-reports`**로 가고, 문구는 **「← 심층 목록」**이다.
- 왜: task#324가 목적지를 종목 리포트로 바꾼 근거(목록 = admin 전용)는 task#396이 목록을 전 사용자에게 재개방하며 사라졌다. 지금은 「심층」 목록에서 **내 보유·관심 밖 종목**을 열고 pill을 누르면 `/reports`의 「미추적」 안내로 떨어진다 — 그 종목들의 유일한 도달 경로가 목록인데(ADR-0047 개정 노트 1) 복귀가 목록으로 안 간다.
- 비목표:
  - 브라우저 뒤로가기(`navigate(-1)`) 방식 — **항상 `<Link to="/analyst-reports">`**로 결정(딥링크 진입·「이전 판」 경유에도 결정적으로 목록. 대가: 목록 스크롤 위치는 맨 위로).
  - 목록에서 방금 본 종목으로 스크롤·강조.
  - 리포트 상세 「심층 리포트」 탭(embedded) — pill이 원래 없다(`!embedded` 게이트 그대로).
  - pill 스타일·위치(task#225) 변경.

## 정본
- 용어: `.forge/branch/dev/CONTEXT.md` [[심층 리포트]] — 화면 위치 ⓑ 「← 종목 리포트」로 복귀 → 갱신 대상, ⓒ 심층 리포트 목록.
- 관련 ADR: `.forge/adr/0027-analyst-report-separate-publication-resource.md` 개정 노트 ③(「복귀 지점은 목록이 아니라 그 종목 리포트 상세」 — 이번에 뒤집힘), `.forge/adr/0047-report-family-merge-by-key-cardinality.md` 개정 노트 1(task#396 목록 재개방 — 이 변경의 근거).
- 완료 정의(DoD):
  1. `cd frontend && npx vitest run src/pages/AnalystReport.test.jsx` 전부 통과 — pill `href === '/analyst-reports'`·문구 `'← 심층 목록'`, 에러(404) 화면 링크도 같은 href·문구를 단언.
     - 사전 상태: 52/52 통과(옛 목적지 단언). **S1에서 단언을 먼저 바꿔 빨간불을 확인**해야 한다(TDD red).
  2. `grep -c "종목 리포트" frontend/src/pages/AnalystReport.jsx` → `0`, `grep -c "심층 목록" frontend/src/pages/AnalystReport.jsx` → `≥2`.
     - 사전 상태: 2 / 0 (전진 검사 — 사전 미충족 정상).
  3. `grep -rn "종목 리포트" scripts/uat215-deep-report-tab.mjs` 중 ⓕ 복귀 축(헤더 주석 22행·`문서라우트:복귀링크`·`복귀:리포트로-도달`)이 「심층 목록」·`pathname === '/analyst-reports'`로 바뀌어 있다. ⓘ(기술 업체표 티커 → 종목 리포트)는 **무관 — 남긴다.**
  4. `grep -c "← 종목 리포트" .forge/branch/dev/CONTEXT.md` → `0` (사전 1). ADR-0027에 개정 노트 1줄(task#402) 추가.
  5. **배포 후 라이브**: 비-admin으로 `/analyst-reports` → 내 목록 밖 종목 카드 → pill 「← 심층 목록」 클릭 → URL `/analyst-reports`. 모바일 폭 **육안 스크린샷 1장**(pill 문구·위치가 하단 탭바와 안 겹침). 이 단언이 통과하면서도 깨질 수 있는 방식: 문구가 길어져 pill이 넓어지며 좁은 폭에서 본문 텍스트 위를 더 가린다 — 스크린샷으로 본다.

## 작업 조각
- [ ] S1. (TDD red) `AnalystReport.test.jsx`의 「플로팅 복귀 pill」 테스트를 새 목적지·문구로 바꾸고, 404 에러 화면 복귀 링크 단언 테스트를 추가 → 실패 확인 — 완료 기준: 해당 2케이스가 옛 코드에서 FAIL.
- [ ] S2. `AnalystReport.jsx` 377·455행을 `<Link to="/analyst-reports">← 심층 목록</Link>`로(`state={{ ticker }}` 제거), 455행 위 주석의 task#324 근거를 task#402 근거로 고침 — 완료 기준: DoD 1·2. (depends: S1)
- [ ] S3. 프로브 `scripts/uat215-deep-report-tab.mjs` ⓕ 복귀 축 갱신, `CONTEXT.md` ⓑ 문구 갱신, ADR-0027 개정 노트 추가 — 완료 기준: DoD 3·4. (depends: S2)
- [ ] S4. push 후 Deploy run `headSha`·`conclusion=success` 확인 → 라이브 UAT(uat215 ⓕ 축 + 비-admin 미추적 종목 복귀) + 육안 스크린샷 — 완료 기준: DoD 5. (depends: S3)

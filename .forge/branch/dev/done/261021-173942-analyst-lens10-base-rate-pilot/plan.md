<!-- forge-slug: analyst-lens10-base-rate-pilot -->
<!-- task: 393 -->
<!-- tdd: off -->
<!-- part: 1/2 (후속 — task 391에서 분리) -->
<!-- priority: medium -->
# 심층 리포트 렌즈 10 「위험의 전례」 — 1부 배포·라이브 파일럿 (task 393)

> task 391(1부)의 S6·DoD 7을 fg-loop 목표 고정(2026-10-21) 때 분리했다 — 사람 머지·사람 화면 확인 게이트라 무인 루프 안에서 봉인할 수 없다. 계약·화면·문서는 391이 dev 커밋까지 끝낸 상태를 전제한다.

## Goal / Non-goals
- Goal: 391이 dev에 커밋한 렌즈 10(선택) 계약·화면·문서를 main에 배포하고, 수동 fire로 1종목 파일럿을 발행해 사람이 화면을 확인한다.
- Non-goals: 야간 루틴 프롬프트(`scripts/cowork-routine-prompt.md`) 변경 없음 — 2부(task 392). 9렌즈 옛 판 재발행 없음.

## Source of truth
- task 391 plan·run.md(계약·DoD 6 분류표). ADR `261006-232406` + 보정 절. deploy-ops 스킬(배포 판정·장시간 루틴 완료는 데이터 대조).

## Definition of Done
1. **라이브 파일럿(사람 게이트 포함)**: ⓐ dev → main PR 머지(사람) 후 Deploy run `headSha` == 1부 머지 커밋 · `conclusion=success`, `~/runtime/portfolion/prod/.taebro-deploy`의 `generation`이 그 커밋 ⓑ 수동 fire 1회(발행 대상 목록 중 이미 심층 리포트가 있고 전례가 뚜렷한 위험을 가진 종목 1개 — 반도체처럼 산업 이동 사례가 풍부한 종목 우선, 결정 10) — 트리거 text에 렌즈 10 계약을 명시(프롬프트 파일은 불변이므로) ⓒ 그 판 GET 응답의 `lenses` id == 1~10, 렌즈 10 `precedents` 2~5건·서버 집계 == 사례 결과 수 — 읽기 전용 프로브(`scripts/uat369-lens-report.mjs` 확장 또는 신설)로 판정, 표본 카운터 > 0 ⓓ 같은 종목의 직전 9렌즈 판이 「렌즈 10 도입 전」 안내와 함께 렌더 ⓔ m390·m350 스크린샷 각 1장(신호판 10행 + 렌즈 10 카드) → 사람 확인.
- **이 DoD가 통과하면서도 깨질 수 있는 방식**: 파일럿 판의 사례가 실재하지 않거나 결과 분류가 사례 원문과 어긋나는 경우(계약·화면은 초록) → 사례 2건을 골라 `ref` 출처를 직접 열어 대조하고 run.md에 기록. 그리고 루틴이 반례를 빼고 현실화 사례만 골라 기저율을 부풀리는 경우 → 사람 확인 항목에 「사례 선택이 한쪽으로 쏠렸나」를 넣는다.

- **391 적대 검토가 넘긴 것(MED)**: 라이브 프로브 `scripts/uat369-lens-report.mjs:89`(`cellIds.length === 9`, `:30` `JUDG=[1,2,6,7,9]`)와 `scripts/uat373-lens-badges.mjs:44`(`m.cells === 9 && m.consensus.length === 9`)가 렌즈 9칸을 고정 단언한다 — 10렌즈 판에서 거짓 FAIL. DoD 1ⓒ 프로브 확장 때 「9 또는 10」으로 고치고 렌즈 10 표면(기저율 막대·사례 행·펼침 버튼·m350 넘침)을 축으로 더할 것. `scripts/uat215-deep-report-tab.mjs`도 확인.

## Work slices
- [ ] S1. 배포·파일럿 — dev push → PR(사람 머지) → DoD 1ⓐ 배포 판정 → 수동 fire(트리거 text에 렌즈 10 계약) → 프로브 → 사례 2건 출처 대조 → 스크린샷을 사람에게 전송. **라이브를 재는 동안 push·`gh workflow run`·재기동 금지.** 완료 기준: DoD 1ⓐ~ⓓ + 사람 확인 요청 전송.

## 검증(UAT) 안내 — 사람 몫
- 폰으로 파일럿 종목의 「심층 리포트」 탭: 렌즈 10 카드가 목업 A안대로 읽히는지, 사례 선택이 한쪽(현실화만)으로 쏠리지 않았는지, 「이전 판」으로 9렌즈 판에 갔을 때 안내 한 줄이 자연스러운지. 화면을 고칠 게 있으면 2부 착수 전에 고친다.

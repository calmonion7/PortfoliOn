<!-- forge-slug: analyst-lens10-base-rate-2of2 -->
<!-- task: 392 -->
<!-- tdd: on -->
<!-- part: 2/2 -->
<!-- priority: medium -->
# 심층 리포트 렌즈 10 「위험의 전례」 — 2부: 필수화 + 야간 루틴 프롬프트 전환 (task 392)

## Goal / Non-goals
- Goal: 1부(task 391)에서 선택으로 받던 렌즈 10을 **새 발행에 필수**로 올리고(id 1~10 각 정확히 한 번), 야간 루틴 프롬프트가 렌즈 10을 쓰게 전환한다. 둘은 **같은 main 배포**로 함께 나간다 — 프롬프트 파일은 `deploy/taebro.env` `RUNTIME_FILES`로 배포 때 리스너 실행 자리에 복사되므로, 한 커밋에 묶으면 「서버는 10을 요구하는데 프롬프트는 9를 지시」하는 창이 생기지 않는다.
- **착수 조건**: 1부의 사람 UAT(파일럿 화면 확인 — 2026-10-21부터 task 393으로 분리)가 끝났고, 거기서 나온 화면 수정이 1부 안에서 반영됐을 것. 확인이 안 됐으면 착수하지 않는다.
- 프롬프트에 넣을 렌즈 10 지침(그릴링 합의):
  - 대상 위험 `risk` = 이 종목의 논지를 가장 크게 깰 수 있는 위험 **하나**(어느 렌즈에서 나와도 됨).
  - 전례 2~5건 — 같은 회사의 과거 재무가 아니라 **비슷한 일이 벌어졌던 다른 시점·회사·나라의 사례**. 똑같은 일은 없으니 `note`에 같은 점·다른 점을 쓴다.
  - **반례를 빼지 말 것** — 찾은 비현실화·부분 현실화 사례를 버리고 현실화만 고르면 기저율이 부풀려진다. 단 반례 수를 할당하지는 않는다(할당은 그것대로 기저율을 왜곡한다).
  - 확률(%)을 쓰지 말고 건수로 말한다(집계는 서버 몫 — 보내지 마라).
  - 색은 루틴이 근거와 함께 켠다. 비슷한 사례를 찾지 못하면 `na` + `na_reason`.
  - POST 전 로컬 사전검증 ⓐ를 「id 1~10」으로, 렌즈 10 항목(사례 수·`outcome` enum·`ref`·`risk`) 추가.
- Non-goals: 9렌즈 옛 판 재발행 없음(다음 정기 발행에서 자연 교체 — 결정 5). 렌더러의 9렌즈 판 처리는 **그대로 둔다**(옛 판은 계속 존재한다). 렌즈 10 서버 색 규칙 없음.

## Source of truth
- Glossary: `.forge/branch/dev/CONTEXT.md` 오버레이 「렌즈」·「위험 기저율」·「전례」.
- ADR `261006-232406` + 1부에서 붙인 보정 절.
- 1부 run.md·retro(파일럿에서 루틴이 실제로 어떤 사례를 골랐는지, 트리거 text로 준 렌즈 10 지시 문구 — 그 문구가 프롬프트 초안의 출발점).
- 코드: `backend/routers/analyst_reports.py`(1부가 만든 9/10 허용 분기), `scripts/cowork-routine-prompt.md` 심층 리포트 절(현재 `1~9`가 3줄(2026-10-21 `grep -c`)), `backend/tests/test_routine_prompt_scope.py`, `scripts/ab-publish.py`(같은 프롬프트 파일 소비자).

## Definition of Done (저장소 루트 기준)
1. **필수화 테스트**: `cd backend && .venv/bin/python -m pytest tests/test_analyst_report_lenses.py -q -k "lens10_required"` exit 0 — ⓐ 렌즈 1~9만 보낸 새 발행 → 422 ⓑ 1~10 → 201 ⓒ 저장된 9렌즈 옛 판 GET은 여전히 200(옛 판 읽기 무회귀). (pre-state: 선택된 테스트 0개 → exit 5. forward check)
2. **회귀**: `cd backend && .venv/bin/python -m pytest tests/test_analyst_report_lenses.py tests/test_analyst_reports.py tests/test_api_doc_sync.py tests/test_routine_prompt_scope.py -q` exit 0 · `cd frontend && npx vitest run src/test/lens10.test.jsx src/pages/AnalystReport.test.jsx` exit 0. (regression guard)
3. **프롬프트 전환**: `grep -c "1~9" scripts/cowork-routine-prompt.md` → 0 이고 렌즈 10 지침(위 6항목)이 심층 리포트 절에 있다 — 판정은 grep이 아니라 `test_routine_prompt_scope.py`에 「심층 리포트 절이 렌즈 10·`precedents`·사전검증 id 1~10을 말한다」 단언을 추가해 exit 0. (pre-state: `1~9` 3줄 — forward check)
4. **문서**: 1부 분류표에서 「2부로 미룸」 행(「1~9 필수, 10 선택」 → 「1~10 각 정확히 한 번」)이 전부 반영 — `grep -c "10 선택\|선택 렌즈 10" API_SPEC.md CLAUDE_COWORK_API.md` → 0. (pre-state 2026-10-21: 0 — 1부가 이 표현을 **넣고** 2부가 걷는 왕복이라 지금 0은 의미 없다. 2부 착수 시 fg-run DoD baseline에서 ≥1인지 먼저 확인하고, 0이면 1부가 다른 표현을 썼다는 뜻이니 이 패턴을 1부 실제 문구로 고쳐 쓸 것 — 실패 시 열린 채 통과하는 부정 검사.)
5. **라이브**: 머지(사람) 후 Deploy run `headSha` == 2부 머지 커밋·`success` + `~/runtime/portfolion/prod/scripts/cowork-routine-prompt.md`가 그 커밋의 파일과 바이트 동일(`cmp`) + 다음 야간 회차(또는 수동 fire 1회)의 새 판이 렌즈 1~10을 갖는다(읽기 전용 프로브). 장시간 루틴 완료는 로그가 아니라 **데이터 대조**로 판정(deploy-ops 스킬, task#389).
- **이 DoD가 통과하면서도 깨질 수 있는 방식**: 프롬프트 문구는 들어갔는데 루틴이 반례를 습관적으로 빼는 경우 — 첫 야간 판 2~3건의 `outcome` 분포를 run.md에 적어 「전부 현실화」면 사람에게 알린다.

## Work slices
- [ ] S1. 필수화(TDD) — DoD 1 실패 테스트 → 새 발행 id 1~10 필수. 1부의 9/10 허용 분기는 발행 검증에서만 걷고 렌더·조회 경로의 9렌즈 처리는 유지. 완료 기준: DoD 1·2.
- [ ] S2. 프롬프트 전환 — 심층 리포트 절의 `1~9` 3줄 + 렌즈 10 지침 6항목 + 본문 예시(`lenses` 발췌에 렌즈 10 한 개). 프롬프트 범위 테스트에 단언 추가. 완료 기준: DoD 3. (S1과 같은 커밋으로 묶는다)
- [ ] S3. 문서 — DoD 4. (depends: S1)
- [ ] S4. 배포·관측 — dev push → PR(사람 머지) → DoD 5. (depends: S2, S3)

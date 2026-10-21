<!-- forge-slug: analyst-lens10-base-rate-1of2 -->
<!-- task: 391 -->
<!-- tdd: on -->
<!-- part: 1/2 -->
<!-- priority: medium -->
# 심층 리포트에 렌즈 10 「위험의 전례」 추가 — 1부: 선택 계약·화면·문서 + 수동 파일럿 (task 391)

## Goal / Non-goals
- Goal: lab-taebro 「성장하는 회사를 어떻게 알아보나」(비공개 초안 `/posts/2026-10-01-growth-company-judgment-framework`)에 task 126(lab-taebro, 2026-10-21)으로 들어간 새 9단계 **「그 위험은 과거에 몇 번 현실이 됐나」**를 [[심층 리포트]]의 **렌즈 10**으로 붙인다. 1부는 **서버가 렌즈 10을 선택으로 받고**(9개·10개 둘 다 허용), 화면·문서를 바꾸고, 수동 fire로 1종목 파일럿을 발행해 사람이 화면을 확인하는 데까지다.
- 렌즈 10 계약(그릴링 결정):
  - **id 10, 번호 순 맨 끝 표시**(결정 1). 원글은 위험을 고른 바로 다음 단계지만 렌즈의 정체성은 번호다 — 기존 1~9 재번호 없음.
  - **판단 렌즈**(결정 2) — `signal`·`flip`·(`gauge` 또는 `conditions` 정확히 하나)는 렌즈 1·2·6·7·9와 같은 규칙. 서버가 색을 켜지 않는다.
  - **`risk`**(필수, 한 줄): 이 종목의 논지를 가장 크게 깰 수 있는 위험 하나 — 어느 렌즈에서 나와도 된다(결정 3).
  - **`precedents`**(필수, 2~5건): 각 `{case, period, outcome, note?, ref}`. `outcome` ∈ 현실화 / 부분 현실화 / 비현실화 세 값(결정 4 — 영문 리터럴명은 실행 시 기존 `Literal` 관례대로 정한다). `ref` 필수.
  - **서버 집계**: 세 결과별 건수 + 총 건수를 서버가 세어 박제(서버 필드 — 루틴이 보내면 모르는 키로 422, 기존 `computed`·`tally`와 같은 규율). 확률(%)은 만들지 않는다.
  - `signal: na`면 `na_reason`만 — `risk`·`precedents` 없음(기존 판단 렌즈 규칙과 동형).
  - 이름: 전문 「위험 기저율」 · 표시명 「위험의 전례」 · 질문 「이 위험은 비슷한 과거에 몇 번 현실이 됐나」(결정 6).
- 화면(결정 7 — 목업 A안 확정): 렌즈 10 상세 카드 = 요약 → **대상 위험** 박스 → **기저율 비율 막대**(현실화·부분·비현실화 3색) + 건수 캡션 → **사례 표**(사례·시점·결과 배지) → `body`(공통점) — 사례 행의 「같은 점·다른 점(`note`)·출처(`ref`)」는 **행을 눌러 펼침**. 신호판 행은 기존 판단 렌즈와 같다.
- 옛 판(결정 5): `format: 2` 유지. 렌즈가 9개인 판은 렌즈 10 없이 그대로 렌더하고 **「이 판은 렌즈 10 도입 전에 발행됐다」 한 줄**을 붙인다. 신호 집계는 그 판에 있는 렌즈만 센다. 일괄 재발행 없음.
- Non-goals:
  - **야간 루틴 프롬프트(`scripts/cowork-routine-prompt.md`)는 손대지 않는다** — 이 파일은 `deploy/taebro.env` `RUNTIME_FILES`로 main 배포 때 리스너 실행 자리에 복사되므로, 1부에서 바꾸면 사람 확인 전에 야간 루틴이 새 계약으로 발행한다(직전 회고 `261007-123919` 교훈). 렌즈 10 필수화·프롬프트 전환은 **2부(task 392)**.
  - 기존 렌즈 1~9 번호·이름·계산 공식 변경 없음. 렌즈 10에 서버 색 규칙 없음. 9렌즈 옛 판 재발행·삭제 없음.
  - `format` 번호 올리기 없음.

## Source of truth
- Glossary(`.forge/branch/dev/CONTEXT.md` 오버레이 — 이번 그릴링에서 갱신·신설): 「렌즈」(10개), 「위험 기저율」, 「전례」. 본 용어집 `.forge/CONTEXT.md`: 「심층 리포트」·「렌즈 신호」·「바뀜 조건」·「구조 축」.
- ADR: `.forge/adr/261006-232406-analyst-report-structure-lens-format.md`(9렌즈 틀 — 이번에 보정 절을 붙인다: 렌즈 10 추가, 번호 순 맨 끝, 서버 색 규칙 없음의 이유) · ADR-0027(발행 후 불변) · ADR `260921-091825`(7단 뼈대 예외).
- 원천: lab-taebro `.forge/done/261021-004211-growth-framework-past-lens-step/plan.md`(새 9단계 구성·채택 소재) · 원글 DB 본문(비공개 — 필요 시 lab-taebro `.forge/scratch/task126-db-fetch.sh`, 관리자 세션) · 영상 https://www.youtube.com/watch?v=Hy7ZNKu-qKQ (2026-10-20).
- 코드 정본: 발행 검증 `backend/routers/analyst_reports.py`(`LensIn`·`LensPublishBody._lens_set_and_inputs` — 현재 `min_length=9, max_length=9`·`range(1, 10)`), 서버 계산·집계 `backend/services/analyst_lenses.py`, 저장 `backend/services/analyst_reports.py`, 렌더 `frontend/src/components/reports/LensReport.jsx`(`LENS_INFO`·`Tally`·`SignalList`·`LensDetail`), 목록 신호 집계 `frontend/src/pages/AnalystReports.jsx`.
- 직전 회고: `261007-123919`(목업 먼저·계약 확정 전 야간 발행 금지 — 이번 결정 7·8의 근거) · `261007-124049`(새 검증은 발행 경로 테스트로) · `261007-123509`(복합 bash 끝 `sed` 금지).
- 프론트 가토(`frontend/CLAUDE.md`): 한국어 자유 서술(`case`·`note`·`risk`) **ellipsis 금지**, `wordBreak: 'keep-all'` + `overflowWrap: 'break-word'`; 칩·배지 행 추가 시 **가장 좁은 뷰포트 실측**.

## Definition of Done (전부 exit code 판정, 저장소 루트 기준)
1. **렌즈 10 계약 테스트**: `cd backend && .venv/bin/python -m pytest tests/test_analyst_report_lenses.py -q -k lens10` exit 0 **그리고** `--collect-only -q -k lens10` 수집 ≥ 9 — 최소 다음을 단언: ⓐ 렌즈 9개(1~9) 발행 201 ⓑ 렌즈 10개(1~10) 발행 201 + 서버 집계 박제 ⓒ id 11·중복 10 → 422 ⓓ `precedents` 1건·6건 → 422 ⓔ `outcome` enum 밖 → 422 ⓕ `risk`·`ref` 누락 → 422 ⓖ `na`인데 `precedents` 동봉 → 422 ⓗ 루틴이 집계 필드를 보내면 422 ⓘ 렌즈 10에 `inputs`/`sensitivity`/`basis` → 422. (pre-state 2026-10-21: exit 5 — 선택된 테스트 0개. forward check)
2. **기존 회귀**: `cd backend && .venv/bin/python -m pytest -q` exit 0 (전체 — fg-loop C2, 2026-10-21 2575 passed; 표적 4파일은 168 passed). (pre-state: 168 passed — regression guard, 미리 통과가 정상)
3. **화면 테스트**: `cd frontend && npx vitest run src/test/lens10.test.jsx` exit 0 **그리고** 테스트 ≥ 4 — ⓐ 10렌즈 판: 신호판 10행, 상세 카드에 「위험의 전례」·대상 위험·건수 캡션(서버 집계값 그대로)·사례 행 수 == `precedents` 길이 ⓑ 사례 행을 누르면 `note`·`ref`가 보인다 ⓒ 9렌즈 판: 렌즈 10 행·카드 없음 + 「렌즈 10 도입 전」 안내 1줄 ⓓ `na` 렌즈 10: 막대·표 없이 `na_reason`. (pre-state: 파일 없음 → exit 1. forward check)
4. **프론트 회귀**: `cd frontend && npx vitest run` exit 0 (전체 — fg-loop C4, 2026-10-21 1084 passed; 표적 3파일은 62 passed). (pre-state: 62 passed — regression guard)
5. **프롬프트 불변**: `git diff --quiet 5b11b49 -- scripts/cowork-routine-prompt.md` exit 0 (1부 커밋 전부 포함한 HEAD 기준). (pre-state: exit 0 — Non-goal 가드, 미리 통과가 정상)
6. **문서**: `API_SPEC.md`·`CLAUDE_COWORK_API.md`의 `POST /api/analyst-reports/{ticker}` 절과 422 조건 목록, 상세 응답 절에 렌즈 10(`risk`·`precedents`·서버 집계 필드·9/10 허용)이 반영됐는지 — 착수 시 `grep -n "1~9\|9렌즈\|렌즈 9개\|9개 렌즈\|9\[\[렌즈\|질문 9개\|렌즈 1~9" API_SPEC.md CLAUDE_COWORK_API.md README.md .forge/CONTEXT.md`로 히트를 세고(2026-10-21 줄 기준 API_SPEC 6 · COWORK 6 · README 1 · CONTEXT 5 — ⚠ `9[[렌즈]]`를 빼면 CONTEXT가 1로 줄어 4곳을 놓친다: 패턴을 좁히지 말 것, 루트 CLAUDE.md 「감사 패턴을 좁히면」 가토. 그리고 「9개」를 숫자 없이 서술한 문장은 이 패턴이 못 보므로 「렌즈」로 한 번 더 훑을 것) **전부 분류**(1부 계약에 맞게 고침 / 2부로 미룸 — 「id 1~9 정확히 한 번」은 1부에서 「1~9 필수, 10 선택」으로)하고 run.md에 표로 남긴다. 판정: 그 표의 「고침」 행이 전부 반영 + DoD 2의 `test_api_doc_sync.py` exit 0. ADR `261006-232406`에 보정 절 1개.
7. **dev 커밋(push 없음)**: `git status --porcelain -- backend frontend API_SPEC.md CLAUDE_COWORK_API.md README.md .forge/adr .forge/CONTEXT.md .forge/branch/dev/CONTEXT.md` 출력 없음 + `git rev-list --count 5b11b49..HEAD` ≥ 1. push·PR·배포·라이브 파일럿은 **task 393으로 분리**(fg-loop 목표 고정 2026-10-21 — 사람 머지·화면 확인 게이트).
- **이 DoD가 통과하면서도 깨질 수 있는 방식**: lens10 테스트가 빈 단언으로 초록인 경우 → DoD 1은 `--collect-only -k lens10` 수집 ≥ 9(ⓐ~ⓘ 각 1개), DoD 3은 테스트 ≥ 4(ⓐ~ⓓ)를 함께 본다. 문서는 존재만 grep되므로 정확성은 S4 적대 검토·S5 분류표가 맡는다. 라이브 사례 실재성·쏠림은 task 393.

## Work slices
- [ ] S1. 발행 계약(백엔드, TDD) — DoD 1의 실패 테스트를 먼저 쓰고, `LensIn`에 `risk`·`precedents` 추가 + 렌즈 10 전용 교차 검증, `LensPublishBody`가 id 1~9 필수·10 선택(최대 10개)을 받게. 다른 렌즈에 `risk`·`precedents`가 오면 422. 완료 기준: DoD 1·2 exit 0.
- [ ] S2. 서버 집계·저장 — 발행 시 렌즈 10 결과별 건수·총 건수를 서버가 계산해 `lens_report`에 박제, 상세 응답에 실림. 렌즈 10이 없는 판은 그 필드 없음. 신호 집계(`tally`)에 렌즈 10이 있으면 포함. 새 DB 컬럼 없음(JSONB 안). 완료 기준: 발행 경로 테스트가 응답의 집계값 == `precedents` 결과 수를 단언, DoD 1·2 exit 0. (depends: S1)
- [ ] S3. 화면(TDD) — `LENS_INFO[10]`, 렌즈 10 상세 카드 A안(대상 위험 박스 → 3색 비율 막대 + 건수 캡션 → 사례 표, 행 눌러 펼침 `note`·`ref`), 9렌즈 판 안내 한 줄, `AnalystReports.jsx` 목록 집계가 9/10 둘 다 맞게. 자유 서술 ellipsis 금지·keep-all 쌍. 완료 기준: DoD 3·4 exit 0. (depends: S2 — 응답 모양)
- [ ] S4. 적대 검토 — 독립 서브에이전트가 S1~S3 diff를 「틀렸다」고 가정하고: 계약 우회(렌즈 10에 계산 렌즈 필드·서버 필드 주입), 9/10 경계, 옛 판 렌더, 좁은 폭 넘침·낱자 적층, 동명 형제 필드(`risk`/`ref`가 다른 모델에 이미 있는지 — 「세라」 가족). 반영 후 DoD 1~4 재실행. 완료 기준: 미해결 지적 0. (depends: S3)
- [ ] S5. 문서 — DoD 6의 grep 히트 분류표 작성 후 API_SPEC·COWORK·README(심층 리포트 「9렌즈」 서술)·본 CONTEXT 「심층 리포트」 문장·ADR 보정 절 갱신. 프롬프트 파일은 손대지 않는다. 완료 기준: DoD 2·5·6. (depends: S4)
- [ ] S6. dev 커밋 — S1~S5 변경(코드·테스트·문서·ADR·CONTEXT)을 dev에 커밋한다. **push·PR·`gh workflow run` 금지**(task 393 몫). 완료 기준: DoD 7. (depends: S5)

## 검증(UAT) 안내
- DoD 1~7 전부 명령 exit code로 판정 — 사람 화면 확인은 task 393(라이브 파일럿)에서.

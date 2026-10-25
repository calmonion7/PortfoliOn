<!-- forge-slug: lens8-loss-making-na -->
<!-- task: 405 -->
<!-- tdd: on -->
# 적자 종목의 렌즈 8(지금 주가 수준)을 미산출로 — 서버 규칙 정정 + 기존 판 소급 재계산

## 목표 / 비목표
- 목표: forward 이익이 0 이하인 종목의 렌즈 8은 빨강이 아니라 **미산출(회색)**이 된다. 사유 문장을 붙이고 게이지와 바뀜 조건은 넣지 않는다. 계산값(시총·forward 이익·이익수익률)은 상세에 남긴다. 이미 발행된 판도 같은 서버 함수로 렌즈 8과 집계만 다시 계산해 덮는다(발행물 불변의 좁은 예외).
- 계기: PLUG 심층 리포트 렌즈 8이 「forward 이익 -377.0 USD M · 71.42 USD M 이상이면 노랑」과 거의 전부 빨강인 이익축 게이지를 보여 주었다. 적자면 항상 빨강이라 정보가 없다(사람 피드백, 2026-10-23).
- 비목표:
  - 적자 종목용 대체 지표(PSR 등 매출 기반 판정) — 새 원자료·문턱이 필요하다(후속 후보, ADR 보정에 기각 이유를 적었다).
  - 「forward = 어느 회계연도인가」 정의. PLUG는 10월에 FY2026 EPS를 썼다. 루틴 프롬프트에 정의가 없지만 이번 범위가 아니다.
  - 배지 「추정 기반」 vs 「애널 추정치」 오표기(PLUG 원자료의 `source`가 `estimate`로 들어온 것) — 루틴 입력 품질 문제라 범위 밖.
  - 소급 판의 서사(한줄 논지·요약·본문)·원자료·발행 시점 숫자·다른 렌즈 수정. 서사가 옛 색을 언급해도 그대로 둔다(ADR 보정의 대가 항목).
  - 화면(LensReport.jsx) 코드 변경 — 이미 `signal === 'na'`면 게이지·바뀜 조건을 숨기고 미산출 사유와 상세(서버 계산)를 그린다. 육안 확인에서 깨지면 그때 범위에 넣는다.
  - 범용 「전 계산 렌즈 재계산」 도구. 렌즈 8 적자 경로만 다룬다.

## 정본
- 용어: `.forge/branch/dev/CONTEXT.md`의 [[렌즈 신호]](회색 ⓑ 「공식이 성립하지 않음」 추가)·[[색이 바뀌는 주가]](0 이하면 렌즈 8 자체가 미산출)·[[심층 리포트]](불변의 유일한 예외 = 서버 판정 규칙 결함 정정)
- ADR: `.forge/adr/261006-232406-analyst-report-structure-lens-format.md`의 「보정 (2026-10-23, task#405 계획)」
- 서버 공식 정본: `backend/services/analyst_lenses.py::lens8`(현재 `fe ≤ 0`이면 `classify_lens8` → stop + 이익축 게이지 폴백, 476–479행)

## 작업 슬라이스
- [ ] S1. **서버 규칙 정정**(TDD) — `lens8()`에서 `fe ≤ 0`이면 `_na(engine, "선행 이익 적자 — 이익수익률로 주가 수준을 판단할 수 없음"류, values)`를 반환한다. `values`에는 `market_cap`·`forward_earnings`·`earnings_yield_pct`(음수)·`risk_free_pct`·`multiple: None`이 남고(외생 가격형이면 `sensitivity`도), 반올림은 무위험 금리 없음 경로(458–461행)와 같게 한다. 무위험 금리도 없고 적자이기도 하면 적자 사유를 쓴다(더 근본적인 사유). 먼저 기존 고정 테스트 2개를 뒤집어 red를 본다: `test_lens8_negative_earnings_is_stop_and_missing_rf_is_na`(→ 적자 = na, 이름도 고칠 것)와 `test_lens8_non_positive_earnings_keeps_earnings_axis`(→ fe=-50·0 모두 na·`gauge` 없음·`flip` None). 그다음 `_price_gauge`의 이익축 폴백 docstring, `lens8` docstring의 「아니면 이익축」 문구를 새 사실에 맞춘다(초록인 채 거짓이 되는 서술 — tests/CLAUDE.md task#249). 발행 경로 테스트 1건: PLUG 모양 원자료(USD M, fe<0)로 `build_lens_report`를 돌리면 렌즈 8 `signal == "na"`이고 `tally`의 `na`에 들어간다. — 완료기준: 새·고친 테스트가 구현 전 FAIL, 구현 후 `tests/test_analyst_report_lenses.py` 전체 PASS.
- [ ] S2. **소급 재계산 함수 + 스크립트**(TDD, 의존: S1) — `analyst_lenses.py`에 순수 함수(예: `recompute_loss_lens8(lens_report) -> (new_report, changed: bool)`)를 둔다. 렌즈 8이 `computed`를 갖고, `inputs.forward_earnings.value ≤ 0`이고, `signal != "na"`일 때만 저장된 `inputs`·`sensitivity`·`structure`, `computed.values.market_cap`, `computed.values.risk_free_pct`·`computed.risk_free_source`로 **`compute_lens`를 그대로** 다시 부른다. 그리고 그 렌즈의 `signal`·`flip`·`na_reason`·`computed`와 `tally`만 교체한다. 단언: ⓐ 다른 렌즈·`structure`·`inputs`가 바이트 동일 ⓑ 두 번째 실행은 `changed=False`(멱등) ⓒ fe>0 판과 이미 na인 판은 무변경 ⓓ `estimate_based`·`consensus_based` 플래그가 보존된다. 얇은 실행 스크립트 `scripts/recompute_lens8_loss.py`: 컨테이너에서 `docker exec -i <backend> python - [--apply] < scripts/recompute_lens8_loss.py`로 돈다. 기본은 dry-run이라 바뀔 판(ticker·날짜·옛 신호→새 신호·옛 tally→새 tally)만 출력하고, `--apply`일 때만 `UPDATE analyst_reports SET lens_report = … WHERE ticker = … AND published_date = …`를 한다(`data`·`created_at` 무변경 — `save_lens_report` upsert는 `created_at = NOW()`로 덮으니 쓰지 말 것). — 완료기준: 함수 단위 테스트 ⓐ~ⓓ가 구현 전 FAIL, 구현 후 PASS. 스크립트의 dry-run 기본값을 코드 직독으로 확인.
- [ ] S3. **dev 리허설**(의존: S2) — dev DB(`portfolion_dev`, prod 복사본)에는 2026-10-23 실측으로 적자 렌즈 8 판이 **0건**이다(v2 31행, 최신 10-21 — PLUG 판이 없다). 그래서 dev 행 1개의 렌즈 8 `inputs.forward_earnings.value`를 음수로, `signal`을 `stop`으로 심어 둔다(dev 전용 — 메모리 「dev 테스트 데이터는 만들어서 잴 것」). 그 뒤 dev 백엔드 컨테이너에서 dry-run → `--apply` → 다시 dry-run 순으로 돌린다. 주의: dev 컨테이너는 dev 브랜치에 배포된 코드를 돌리므로 S1·S2가 dev 스택에 올라간 뒤에 한다. — 완료기준: 첫 dry-run이 심은 1건만 출력하고, apply 뒤 그 행의 렌즈 8이 `na`이며 tally `na`가 +1·`stop`이 −1이다. 두 번째 dry-run은 0건이다.
- [ ] S4. **문서·용어 동기**(의존: S1) — ⓐ `API_SPEC.md:2327`·`CLAUDE_COWORK_API.md:747`의 「계산이 불가능하면(… 스냅샷 시총 없음·무위험 금리 없음)」 목록에 「렌즈 8 forward 이익 0 이하」를 추가한다. ⓑ `API_SPEC.md:2475`의 렌즈 8 게이지 「폴백 2종: `forward_earnings` ≤ 0이거나 …」에서 적자 조건을 빼고(이익축 폴백은 이제 주가 없음·비유한일 때만), 적자면 `na`·`gauge` `null`이라고 적는다. 「task#376 이전 렌즈 8 발행물은 전부 이익축이다」 옆에 「적자 판은 task#405 소급으로 na」를 덧붙인다. ⓒ `frontend/src/glossary/terms.js:72` 「이익수익률」 설명에 「forward 이익이 0 이하면 미산출」을 추가한다(CONTEXT 「주식 용어집」 — 공식·문턱을 바꾸면 설명도 고친다, task#400). ⓓ `CLAUDE_COWORK_API.md`에서 렌즈 8·`forward_earnings`를 **파일 전체 grep**해 히트를 전부 확인한다(루트 CLAUDE.md task#318 — 한 엔드포인트가 두 곳에 적힌다). ⓔ 라이브 프로브 `scripts/uat*.mjs` 중 렌즈 8의 색·게이지를 단언하는 곳이 있는지 grep한다(2026-10-23 실측: `uat369-crops.mjs`의 스크린샷 경로 1곳뿐, 단언 없음). — 완료기준: 아래 DoD 3·4.
- (S5 prod 적용·육안 확인은 사람 단계라 task#406 `lens8-loss-making-prod-apply`로 분리했다 — fg-loop 범위 결정, 2026-10-23.)
- 소급 함수 이름은 `recompute_loss_lens8`로 고정한다(fg-loop C1 독립 프로브가 이 이름으로 부른다).

## 완료 정의 (DoD)
1. `cd backend && .venv/bin/python -m pytest -q tests/test_analyst_report_lenses.py` → 전부 PASS. 새 적자 → na 단언이 포함돼야 한다.
   사전 상태(2026-10-23): 140 passed. 지금은 「적자 = stop」을 고정하는 테스트가 초록이다. 이것은 회귀 가드가 아니라 **뒤집을 대상**이라 S1이 먼저 red로 만든다.
2. `cd backend && .venv/bin/python -m pytest -q` → 전체 스위트 PASS. 그 뒤 `git status`로 부수효과 파일이 없음을 확인한다.
   사전 상태: 회귀 가드라 미리 통과한다(이번 변경 전 dev HEAD 54139d9).
3. `grep -c 'forward_earnings` ≤ 0이거나' API_SPEC.md` → 0. 그리고 `grep -n '렌즈 8 forward 이익 0 이하\|forward 이익 0 이하' API_SPEC.md CLAUDE_COWORK_API.md` → 두 파일에서 각 ≥1.
   사전 상태: 첫 명령 1(지울 대상, 전방 검사), 둘째 명령 0건(전방 검사).
4. `grep -c '0 이하면 미산출' frontend/src/glossary/terms.js` → ≥1.
   사전 상태: 0(전방 검사).
5. S3 dev 리허설 출력: 첫 dry-run 1건 → apply → 둘째 dry-run 0건.
- 영구 회귀 검사: 이번 결함(적자 렌즈 8이 빨강)은 기계적으로 검사할 수 있다. S1의 단위 테스트가 그 회귀 검사이고, 「적자 → na」를 단언해 DoD 1에서 red → green을 증언한다.
- 「이 단언이 통과하면서도 깨질 수 있는 방식」: 서버가 na를 내도 화면이 na 계산 렌즈의 `computed.values`에서 `multiple: null`을 이상하게 그릴 수 있다(vitest·pytest 모두 블라인드). 그래서 task#406(prod 적용)의 완료기준에 육안 1장을 넣는다.

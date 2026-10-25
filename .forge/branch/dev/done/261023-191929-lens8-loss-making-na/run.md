# RUN — 적자 종목의 렌즈 8을 미산출로 (task#405)

실행: 2026-10-23 · fg-loop 무인 드라이브 · 워크플로 없이 메인 세션 직접 실행(슬라이스 4개, 파일 6개 — 단일 에이전트 규모) · 커밋 `77f7577`(dev push → dev 배포 세대 `261023-191820-77f7577`)

## 슬라이스 결과
- S1 서버 규칙 정정(TDD) — ✅ 계획대로. 고정 테스트 2개를 뒤집고 발행 경로 테스트 1건 추가 → 구현 전 4 FAIL, 구현 후 PASS. 적자 사유가 금리 없음보다 먼저다. `lens8`·`_lens8_price_gauge` docstring 갱신.
- S2 소급 함수 + 스크립트(TDD) — ✅ 계획대로. `recompute_loss_lens8` 테스트 5건이 구현 전 FAIL, 구현 후 PASS. `scripts/recompute_lens8_loss.py`는 기본 dry-run이고 `--apply`일 때만 `lens_report`를 UPDATE한다(`created_at` 무변경을 리허설에서 확인).
- S3 dev 리허설 — ✅ 계획대로. dev MRVL 2026-10-07 판(렌즈 8 원래 stop)의 forward 이익을 -500으로 심었다. 원본 백업은 scratchpad `dev-mrvl-1007-backup.json`. 리허설 결과: dry-run 1건 → apply → 재 dry-run 0건.
- S4 문서·용어 동기 — ✅ 계획대로. ⓓ COWORK 전체 grep에서 렌즈 8 관련 히트 4곳(721·739·743·747)을 확인했고 747만 갱신했다(721 「≤ 0이면 검증 생략」은 여전히 참). ⓔ 프로브 단언 0건(`uat369-crops.mjs` 스크린샷 경로뿐).
- (S5 prod 적용·육안 확인은 fg-loop 범위 결정으로 task#406에 분리 — 이 run 밖)

## DoD baseline → after
1. `pytest tests/test_analyst_report_lenses.py`: 140 passed(「적자 = stop」 고정이 초록) → 147 passed(적자 → na 단언 포함)
2. 전체 pytest: 2622 passed → 2629 passed. `git status`의 부수효과 파일 없음(`backend/data/*.json` 무변경)
3. `grep -c 'forward_earnings` ≤ 0이거나' API_SPEC.md`: 1 → 0. 「forward 이익 0 이하」: API_SPEC 0→1, COWORK 0→1
4. `grep -c '0 이하면 미산출' terms.js`: 0 → 1
5. dev 리허설: (해당 판 없음) → 첫 dry-run 1건 · apply · 둘째 dry-run 0건. MRVL 렌즈 8 na, tally `stop 1→0`·`na 0→1`
- fg-loop C1 독립 프로브: 10 fail → ALL PASS

## 계획과 달라진 점·현장 결정
- 사유 문구는 「선행 이익 적자(0 이하) — 이익수익률로 주가 수준을 판단할 수 없음」으로 정했다. fe = 0도 같은 사유를 쓰려고 「(0 이하)」를 붙였다.
- 이익축 게이지 폴백 코드(`gauge is None` → 이익축)는 남겼다. 주가가 없을 때의 폴백으로 여전히 쓰이고, 적자 경로만 그 앞에서 na로 빠진다.
- API_SPEC 렌즈 8 게이지 절에서 「주가가 있고 `forward_earnings` > 0이면 주가축」의 `> 0` 조건도 지웠다. 적자는 이제 게이지 자체가 없어 그 조건이 무의미하다(계획 ⓑ의 자연스러운 확장).
- dev에 심은 MRVL 2026-10-07 판은 리허설 뒤에도 na 상태로 남겨 두었다(dev 전용 테스트 데이터). 되돌리려면 백업 JSON으로 UPDATE한다.

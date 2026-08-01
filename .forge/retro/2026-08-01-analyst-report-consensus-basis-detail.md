# 2026-08-01 — 심층 리포트 상세 컨센서스 근거(박제 + 섹션) · 라이브 갭 2건 후속 fix

fg-loop이 회고를 자동 스킵했고(`retro: skipped`), 일괄 승급 모드에서 뒤늦게 작성한 회고다.
원자료는 `.forge/done/2026-08-01-analyst-report-consensus-basis-detail/run.md`. 커밋 4개(`2666e24` 본체 · `6590228`·`c87205f` 라이브 fix).

## 계획 대비 실제

- **계획대로 간 것**
  - S1 `consensus_basis()` — mart 최신 행 + raw_reports 90일 창(**mart base_date 앵커** = `_MART_SQL`의 `latest_per_brokerage`와 같은 계보), `__consensus__` sentinel SQL 제외, Decimal→float `_fnum` + isfinite 가드, 미커버·read 실패 graceful None. 발행 라우터 additive 병합.
  - S2 `ConsensusSection`+`ConsensusRangeGauge` — recharts 금지 준수(custom div), 증권사 테이블은 **이름만 ellipsis·수치 `flexShrink:0`**(task#241 가토), 10개 초과 접기, 구발행물 섹션 전체 생략.
  - S3 순서 고정(commit+push → build → 프로브) 준수, API_SPEC·COWORK 갱신, 라이브 프로브 16단언 ALL PASS + 육안 2장.
- **이탈**
  1. **계획이 전제한 라이브 데이터 상태가 착수 시점에 없었다** — "`analyst_target` 중 최신 발행 7일+ 경과 종목 1개에 실발행"이 조건이었는데, 자동 루틴이 대상 10종목 전부를 어제~오늘 발행해 둬서 **충족 종목 0개**(ADR-0028 가드레일 밖 prod 발행은 금지). 대체 3축으로 커버: ⓐ in-container 실데이터 `consensus_basis()` 호출 ⓑ 라이브 번들 + `route` 주입 응답(실발행 아님 라벨) ⓒ 실제 구발행물 graceful. 미커버 잔여는 "발행 경로가 라이브 DB에 실제 쓰는 것" — 다음 자동 루틴 발행분이 자연 검증.
  2. **라이브 fix 2건(계획 밖 갭, 같은 클래스)** — 구발행물에서 스냅샷 `target_mean`이 null, 분포가 전부 0인데 mart엔 실값(485,000 · 23/0/0). "근거가 보이는 섹션"이라는 목적에 미달이라 **스냅샷 우선 + 빈 경우만 mart 보충** 규칙을 추가했다("매수 0"인데 애널 23명인 오해 제거).
  3. **프로브 자체 결함 1건** — 델타 텍스트를 `texts.find`로 잡아 최외곽 div(문서 전체)가 걸려 FAIL. `<p>` 단위로 좁혀 해결(완화 전 정체 실측 = ⑧ⓒ 준수). 델타는 처음부터 정상 렌더 중이었다.
  4. 폴러 오경보 1건 — 커밋 직후 파일이 옛 버전으로 보였으나 `rev-parse HEAD == origin/main` + 내용 grep으로 기각(CLAUDE.md에 기록된 자기복구 성질, 실손실 0).

## 학습

- **다음에 다르게 할 것**
  1. **라이브 UAT가 특정 *데이터 상태*를 전제하면 착수 시 1쿼리로 먼저 확인할 것.** 이탈 1번. admin 권한으로 막히는 4회 반복 함정의 **사촌** — 이번엔 권한이 아니라 데이터였고, 이 프로젝트는 자동 루틴·일배치가 상태를 계속 바꾸므로 재발한다. 없으면 계획을 되돌리지 말고 대체 3축으로 실질을 커버하고 **미커버 잔여를 이름으로 적을 것**. **CLAUDE.md admin-UAT 항목에 ⑤로 승급.**
  2. **in-container 실데이터 호출을 대체 검증의 *첫 축*으로 둘 것.** 이탈 2번이 정확히 거기서 나왔다 — 주입 응답만 봤다면 화면이 정상으로 보였을 자리다(fixture-pass-live-fail의 UAT판).
  3. **이원 소스 필드는 "어느 쪽이 정본인가"와 "빈 경우 보충하나"를 따로 정할 것.** 스냅샷 박제값이 정본이지만 KR은 비어 있을 수 있어, 덮어쓰지 않는 보충이 정답이었다. `tickers.name` vs `snapshots.data.name` 가족의 새 인스턴스.
  4. 프로브에서 텍스트를 찾을 땐 `querySelectorAll('*')` 계열 대신 **의미 있는 태그 단위**(`p`·`li`)로 좁힐 것 — 최외곽 컨테이너가 문서 전체 텍스트를 포함해 `includes` 검사를 무의미하게 만든다.

## 문서 갱신

- **CLAUDE.md 승급 1건**(사용자 확인): admin-UAT 항목에 **⑤ 데이터 상태 전제** — 착수 시 확인 + 대체 3축(in-container 실데이터 / 주입 응답+라벨 / 구데이터 graceful) + 미커버 명시.
- **CONTEXT.md 보강 1건**(사용자 확인): `컨센서스 근거` 항목에 **박제 시 이원 소스 보충 규칙**(스냅샷 우선, 빈 경우만 mart — 안 하면 "매수 0"으로 오해).
- API_SPEC.md·CLAUDE_COWORK_API.md: 같은 커밋에서 갱신 완료(data 블록 확장·자동 첨부 서술).
- ADR 추가: 없음 — ADR-0027(하이브리드 생산)의 기존 결정 안에서 additive 확장이라 새 결정이 아니다.
- **후속 후보**: 다음 자동 루틴 발행분에서 `analyst_reports.data.consensus_detail` 존재 1줄 확인(실발행 경로 종단 검증).

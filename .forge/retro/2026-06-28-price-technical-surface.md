<!-- forge-slug: price-technical-surface -->
# 2026-06-28 — 가격·기술 표면 보강 (52주/EMA·추세요약·베타·HV) (task#116)

## Plan vs actual
- **계획대로**: 4슬라이스 전부 설계대로 전달. S1 `indicators.get_support_resistance` 연결(미연결 확인대로)+empty-df 가드, S2 `calc_trend_summary`(price vs EMA·30d수익률·골든/데드크로스), S3 `calc_beta`(OLS)·`calc_hv`(std×√252)·US `info.beta`·KR `^KS11` OLS. 프론트 `TechnicalStats`를 기술·수급 서브탭 RsiTable 직후(US·KR). TDD 16테스트 선작성→green(pytest 931), `npm run build` ✓, README 갱신. 라이브 1종목 검증(AAPL info.beta 1.086·005930 OLS 1.272) — DoD 충족. 커밋 `306817b2` main 푸시.
- **워크플로 구성**: shared-file(report_generator.py·기술 서브탭) 다중슬라이스라 [[reports-jsx-presentational-split]] 교훈대로 **백엔드 단일 코히어런트 에이전트**(병렬 미사용)+프론트/문서 병렬+적대적 Review phase. eco/sonnet.

## Divergences
- **D1 (critical, Review가 in-run 수정·라이브 검증)**: KR beta 항상 None. 키움 daily_df=tz-naive, yfinance `^KS11`=tz-aware → `pd.concat(axis=1)` TypeError를 broad try/except가 묵살 → `calc_beta` 미도달. `^KS11` 인덱스 `tz_localize(None)` 가드로 수정, 005930 OLS 1.272 동작 확인. **fixture·메인 빌드가 못 잡은 라이브 전용 버그를 적대적 Review phase가 포착** — #111/#117 fixture-pass-live-fail 가족의 재현.
- **D2 (계획 정련)**: 골든/데드크로스 윈도 "~10봉"→30봉. EWM EMA는 10봉으론 2주 내 크로스 미반영(테스트로 확인), 30봉(1개월)이 일봉 EMA50×200 최소 신뢰 윈도. 코드 주석 명시.
- **D3 (스코프, 의도)**: `backfill_ticker`(과거 스냅샷 별도 summary) 비대상 — 신규 필드는 최신 `generate_report` 스냅샷만, 리포트 상세가 그것만 읽음(프론트 undefined 가드로 구 스냅샷 무크래시). 과거 날짜별 ^KS11 정렬 비용↑, 후속 후보.
- **D4 (low, 미수정·도달불가)**: `calc_trend_summary` 퇴화 2봉서 spurious golden_cross(EWM 초기화 아티팩트). 프로덕션 252봉이라 도달 불가, surgical로 미수정.
- **D5 (eco nit)**: US beta가 `_t.info` 재접근(yfinance Ticker 인스턴스 메모이즈로 추가 네트워크 콜 없음), `import math` 로컬. 사소·비차단.
- **D6 (기존 데이터 품질, 미도입)**: 005930 week52_low 액면조정 흔적 — yfinance KR 기존 이슈, 이번 변경 무관.

## Learnings
- **Do differently next time**:
  - **키움 series + yfinance series 정렬은 tz 호환부터 의심** — tz-naive(키움)↔tz-aware(yfinance) concat은 TypeError, broad except가 삼키면 조용히 None. CLAUDE.md gotcha로 박제(아래). 향후 베타·상관·상대강도 등 KR×yfinance 정렬 전부 해당.
  - **수치/외부소스 코드엔 적대적 Review phase가 값을 한다** — fixture green·빌드 green이어도 라이브 전용 버그(tz·라벨·스케일)는 살아남는다. 이번 워크플로의 Review phase가 D1을 in-run 포착·수정. 외부소스 파싱/정렬 슬라이스엔 라이브 1종목 대조 + 적대 검토를 묶을 것(이미 #111/#117 DoD 패턴, 이번에 효과 재확인).
  - **shared-file 다중슬라이스는 단일 코히어런트 에이전트로** — report_generator.py·한 서브탭을 S1/S2/S3가 공유해 병렬 미사용·백엔드 1에이전트로 구성([[reports-jsx-presentational-split]] 교훈 적용, 재발견 비용·쓰기충돌 회피).

## Doc updates
- CLAUDE.md: **gotcha 1건 추가**(line 210 #117 인접) — "키움 daily_df(tz-naive)↔yfinance(tz-aware) 정렬 tz strip 필수 + broad except 묵살 시 silent None" (사용자 승인).
- CONTEXT.md promotion: none — 52주/EMA/베타/HV/골든크로스는 일반 TA 개념(글로서리 제외 규칙, 계획 명시).
- ADR added: none — D1은 버그+수정 패턴(되돌리기 쉬움·트레이드오프 아님), D3 스코프결정도 3조건(되돌리기 어려움·난해·트레이드오프) 미충족.

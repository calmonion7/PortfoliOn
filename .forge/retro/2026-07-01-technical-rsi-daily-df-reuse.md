<!-- forge-slug: technical-rsi-daily-df-reuse -->
# 2026-07-01 — 기술·수급 탭 RSI 미표시 수정 (daily_df 재사용 + 빈 RsiTable 가드) (task#126)

## Plan vs actual
- **계획대로**: 2슬라이스 설계대로 전달. S1 `get_timeframe_rsi(..., daily_df=None)` 옵셔널 재사용(US만 전달, KR daily RSI는 NXT 유지 non-goal) + `report_generator:112` 전달. S2 `RsiTable`이 `available.length===0`이면 미렌더(빈 "RSI 예상 타점" 헤더 박스 제거). 신규 단위테스트 2개(재사용 시 daily 미fetch·rsi 계산 / None이면 fetch). 백엔드 **982 pytest green**, 프론트 **build ✓**. eco/직접실행(워크플로 미사용 — 2슬라이스 소규모).

## Divergences
- **D1 (low, 의도)**: 프론트 vitest 컴포넌트 테스트 미추가. RTL/jsdom 하니스는 있으나 `DetailTab.jsx`가 `api`(axios)+recharts 차트 3종을 top-import해 RsiTable 격리 렌더 테스트 import 체인이 무겁고 취약 — 1줄 가드 대비 비용 과다. 계획이 허용한 "빌드+수동" 경로. `npm run build` 컴파일 검증 + 라이브 UAT로 커버.
- **D2 (검증 이월)**: SPCX daily RSI 실제 화면 표시는 배포+재생성 후에만 확인 가능(로컬에서 SPCX·운영 DB 접근 불가). STATUS `verified: yes`는 로컬 검증분(테스트+빌드) 근거이며 라이브 확인은 사용자 배포 후 수행.

## Learnings
- **근본원인**: 당일 리포트에서 daily 계열 지표(EMA·52주·HV·매물대)는 직렬 `daily_df` 하나로 계산하는데, **RSI만 `get_timeframe_rsi`가 내부에서 `get_history_df`로 같은 일봉을 별도·ThreadPool 동시 재fetch**(파라미터 동일=순수 중복) → 동시 호출 중 이 fetch만 rate-limit되면 RSI만 null, 나머진 멀쩡. "요약 매물대 차트는 뜨는데 기술·수급 RSI만 빈 박스"의 정체.
- **Do differently next time**:
  - **이미 받은 df가 있으면 재fetch 말고 재사용** — 같은 일봉을 두 경로로 각각 받으면 하나만 실패해 *부분 결측이 조용히* 난다(500 없이). 백필 경로(`_rsi_block(d_trim)`)는 이미 df 재사용이라 견고했고 당일 경로만 어긋나 있었음. fixture는 mock이라 못 잡고 라이브에서만 드러나는 #111/#116/#117 가족(fixture-pass-live-fail).
  - **증상 진단 순서**: "요약엔 나오는데 상세 탭엔 안 나옴"류는 두 표면이 *같은 데이터를 다른 가드/다른 fetch로* 쓰는지부터 대조. 스크린샷 1장이 A/B/C 가설을 즉시 갈랐음(현재가 라벨의 "(RSI)" 유무 = daily_rsi.rsi null 판별).
  - **잔존**: weekly/monthly RSI는 5y/10y 필요라 여전히 별도 fetch — 동일 부분결측 위험(프론트 `available` 필터가 흡수). 근본 제거는 후속 후보(비목표).

## 라이브 검증 정정 (post-UAT, 같은 세션 — 중요)
- **fg-ask 근본원인 진단이 틀렸다.** 배포 후 SPCX 재생성해도 RSI 미표시 → 컨테이너 라이브 프로브(`docker exec ... python`)로 확인한 결과: `_t.history(period="1y")`가 **12행만 반환**(SPCX=상장 12거래일, 2026-06-12 IPO), `calc_rsi`가 전부 NaN → RSI null. `get_history_df` 별도 fetch도 **동일 12행** → "ThreadPool 동시 fetch rate-limit" 가설은 **오진**이었다(flaky 아님, 두 경로 동일). 진짜 원인은 **RSI(14봉)에 히스토리 부족**(EMA/52주/HV는 ewm·max/min·std라 12행서도 값이 나와 "RSI만 빈"이 fetch 실패로 오인됨). 14거래일 넘으면 자연 해소.
- **요약 탭도 실제 RSI는 안 나왔다** — 거기 "나오던" 건 매물대(거래량 프로파일) 차트였고(POC/HVN/VAH/VAL+목표가+현재가), RSI 막대·"(RSI)" 라벨은 없었다. 즉 원래 증상은 "요약=매물대 차트 뜸 / 기술·수급=RSI 전용이라 빔"의 컴포넌트 비대칭.
- **후속 변경(사용자 승인 B)**: 기술·수급 탭이 RSI 없을 때 `RsiTable`을 숨기는 대신 **요약 탭과 동일한 `VolumeRsiSnapshot`(매물대) 폴백 표시**(`ReportDetailTabs`의 `hasRsi` 분기), RSI 생기면 `RsiTable`로 전환. → 원래 요구(탭 parity)를 실제로 충족. (S2의 "빈 박스 숨김"은 이 폴백으로 대체 — RsiTable 내부 `available.length===0→null` 가드는 방어로 잔존.)
- **백엔드 daily_df 재사용(S1)**: 신규종목 null의 원인이 아니었으나(오진), 중복 fetch 제거·잠재 flaky 완화라는 robustness 개선으로는 유효 — 되돌리지 않고 유지.
- **메타 교훈**: 외부데이터 "다 나오는데 하나만 빈" 증상은 **라이브 프로브 선행 후 원인 귀속**. fg-ask 단계에서 라이브 접근 불가로 코드 정황만으로 flaky를 단정한 게 오진의 뿌리 — UAT의 라이브 재생성이 이를 잡았다(#111/#116/#117 fixture-pass-live-fail 가족의 "라이브 검증 필수" 재확인).

## Doc updates
- **CLAUDE.md**: gotcha 1건(line 212 tz-strip #116 인접)을 **정정 재작성**(사용자 승인) — 최초 "동시 fetch 부분결측"(오진)에서 "다른 지표는 다 나오는데 RSI만 빈 = fetch 실패 아니라 히스토리 부족일 수 있다 · 원인 단정 전 라이브 프로브 · daily_df 재사용은 부수"로 교체.
- **CONTEXT.md**: 승급 없음 — RSI·매물대는 일반 TA 개념(글로서리 제외 규칙).
- **ADR**: 없음 — 되돌리기 쉬운 리팩터·트레이드오프 아님(3조건 미충족).

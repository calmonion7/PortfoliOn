# RUN — 심층 리포트 용어 링크 확대 2/2 (task#400)

fg-loop 드라이브 안에서 직접 실행(워크플로 없음 — terms.js 항목 추가 + LensReport 2곳 배선 + 테스트).

## 슬라이스
- S1 `match.test.js`에 dev 실문장 24케이스 + 별칭 4 + 가로채기 가드 5, `AnalystReport.test.jsx`에 계산 라벨 6종·게이지 변수명(role=img 밖) 단언 — ✅ red 26+2 확인
- S2 `terms.js`에 (가) 재무 15종 + (나) 계산 8종 + `이자보상배율` 별칭 `이자보상` — ⚠ 계획 목록에서 3개 조정(아래)
- S3 `ComputedBlock` 라벨 `GlossaryText`, `FlipGauge` 변수명 `GlossaryText` + `role="img"`·`aria-label`을 트랙·경계 라벨 묶음으로 좁힘 — ✅ (기존 aria-label 단언 4곳을 좁힌 요소로 옮김)
- S4 dev push `6b33c8f` → 세대 `261022-122439-6b33c8f` → 프로브·접근성·스크린샷 — ⚠ DoD 3의 role 판정이 이빨 없음(아래)

## DoD baseline → after
1. `match.test.js` 13 → 39 passed(신규 26 red→green)
2. `AnalystReport.test.jsx` 계산 라벨·게이지 변수명 2 red → green. 표적 2파일 62 → 64(+lens10 포함 실행 59→61), 전체 1104 → 1132
3. 게이지 변수명 버튼: dev MRVL·000660·CRCL 전부 `[role="img"] .glossary-term` = 0, 변수명 버튼 3·3·1개 전부 img 밖 / jsdom `btn.closest('[role="img"]') === null`
4. 「모두 펼치기」 용어 텍스트 종류(10건 합집합): 27(1/2 후) → 55. 정지조건 C5: 신규 16종 16/16, baseline 22종 손실 0. 접힌 계수 1/2 대비 **전 건 증가·감소 0**: 000660 19→31 · 005380 11→19 · 005930 22→31 · CRCL 2→8 · GOOGL 10→12 · LHX 8→13 · LLY 8→16 · MRVL 16→34 · MU 6→18 · SPCX 2→4
5. 3뷰포트(m278·m390·pc1440) 가로 넘침 0(MRVL·000660·CRCL), 육안: ComputedBlock 「배수비」 라벨 밑줄·그리드 무붕괴, 게이지 머리 「약정 증가 배수」 밑줄 + 「서버 계산」 배지 같은 줄 유지

## 계획과 다른 점
- **Non-GAAP 제외** — dev 10건 본문에 0회(실문장 단언 불가). **CapEx는 새 항목이 아니라 `설비투자`의 별칭**(dev 0회, 같은 개념) + `시설투자` 별칭(005930 실문장). `현금흐름`(일반)을 `영업현금흐름`과 별도로 추가(dev 11회, 잉여현금흐름·영업현금흐름은 longest-match로 보존됨을 가드).
- `희석`은 dev에서 전부 「희석주식」(diluted shares) 뜻이라 정의문에 그 뜻을 넣었고, `레버리지`는 dev에서 전부 **고정비(영업) 레버리지** 뜻이라 재무 레버리지와 둘 다 담는 정의로 썼다.
- (나) 정의 근거(`backend/services/analyst_lenses.py`): 런웨이 `lens5` equity `cash / burn`·`RUNWAY_GO_YEARS 3.0`/`WAIT 1.5` · 손익분기 금리 `lens5` deposit `breakeven = y − profit/slope`(slope에 한계 몫)·`BREAKEVEN_GO_PP 2.0`/`WAIT 1.0` · 이자보상 `lens5` debt `oi / interest`·`COVERAGE_GO 5.0`/`WAIT 2.0` · 이익수익률 `lens8` `fe / market_cap × 100`·`classify_lens8`(≥rf 초록, ≥rf−1.5 노랑) · 무위험 금리 `lens8` 인자 + `risk_free_source`(원자료 / 서버 캐시 미 10년물) · 한계·평균 분배율 `lens4` revenue_linked `d_cost / d_rev`·`linked_cost / revenue`·`LENS4_LINKED_BAND_PP 5.0` · 배수비 `lens3` `num_g / den_g`(`LENS3_GO 1.0`/`WAIT 0.8`) + `lens4` fixed `cm / rm`(`LENS4_FIXED_GO 1.0`/`WAIT 1.2`) · 약정 증가 배수 `lens4` fixed `commitment_curr / commitment_prev`.
- **DoD 3 판정 형태가 이빨 없음을 대조군으로 확인** — `<div role="img"><button>안</button></div>`를 Playwright `getByRole('button')`도, Chromium CDP `Accessibility.getFullAXTree`도 **그대로 잡았다**(둘 다 1). 즉 계획의 「`getByRole`로 잡힌다」는 프루닝 전후를 구별하지 못한다(Chromium은 img 자식 버튼을 프루닝하지 않음 — ARIA의 presentational children 처리는 Safari·VoiceOver 쪽 차이). 그래서 **구조 축(`[role="img"]` 안 용어 버튼 0)**으로 판정했다. live-uat-probes 「AT 프루닝」 클래스의 측정 한계로 승급 후보.
- 기대 종류 수를 노드로 미리 계산하지 않고, 정지조건 C5의 **정체성 판정**(신규 16종 각각 + baseline 22종 보존)을 그 대신 썼다 — 개수보다 강한 형태라 판단.

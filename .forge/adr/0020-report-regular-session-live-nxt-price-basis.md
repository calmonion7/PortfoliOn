---
status: accepted
---

# 시세 기준 이원화 — 리포트 스냅샷=KRX 정규장 종가, 라이브 대시보드=NXT

KR 시세에 **두 가지 가격 기준**을 의도적으로 둔다. **(1) 리포트 일배치 스냅샷 = KRX 정규장 종가**: `report_generator`가 박제하는 현재가·일봉(매물대/고점/변동률)은 키움 평문 KRX 코드(`005930`)로 받아 정규장 종가를 쓴다. 마감 후(20:30) 도는 일배치의 "현재가"는 네이버·HTS·뉴스가 보여주는 그 종가여야 하고(사용자 기대 일치), 같은 정규장 기준의 일봉으로 매물대/RSI를 그려 **price↔차트 정합**(task#94 가토)을 유지한다. **(2) 라이브 대시보드 = NXT `_AL`**: 보유/관심 실시간 시세(`get_quotes_batch`)는 키움 통합코드 `_AL`(SOR)로 받아 시간외(08:00~20:00) 신선도를 살린다. 마감 후엔 정규장 종가가 stale하므로 NXT가 더 신선하다(키움 NXT 연동 도입 취지).

[[키움 시세 소스]](ADR-0009)의 읽기전용·서버측 단일키 경계는 그대로다 — 이 결정은 그 안에서 **어느 거래소 코드(`005930` vs `005930_AL`)를 쓰느냐**의 호출 의도별 분기일 뿐이다.

## Considered Options

- **전부 NXT `_AL` 유지(현행)** — 거부. 리포트 현재가가 정규장 종가(354,000)가 아닌 NXT 시간외가(350,500)로 ~1% 어긋나 네이버/HTS와 달라 혼란. 마감 후 스냅샷의 "현재가"는 정규장 종가가 의미상 맞다.
- **전부 KRX 정규장으로 통일** — 거부. 대시보드가 마감 후 정규장 종가에 고정돼 시간외 가격 변화를 못 보여준다(NXT 연동 취지 상실).
- **리포트는 시세만 정규장, 매물대는 NXT 유지** — 거부. price(KRX)와 매물대(NXT 기반)가 ~1% 어긋나 *새로운* 불일치를 만든다(현재는 둘 다 NXT라 정합). 시세+일봉을 함께 정규장으로 옮겨야 한다.
- **ContextVar로 모드 전파** — 거부. `report_generator`가 ThreadPoolExecutor로 병렬 fetch하는데 ContextVar는 스레드에 자동 전파되지 않아(copy_context 누락 footgun) 워커의 quote가 NXT로 새는 사고가 난다. 명시 파라미터(`integrated_code` 단일 분기점에 `regular` 전파)가 안전·명료.

## Consequences

- 키움 코드 선택 단일 분기점 `client.integrated_code(stk_cd, regular=False)`에 `regular` 파라미터를 더해, 시세 체인(`get_quote`→…→`get_basic_info`)과 차트 체인(`get_history_df`→…→`fetch_bars`)으로 전파한다. **기본값 False(=`_AL` NXT, 현행 무변화)** — 리포트 생성 경로만 `regular=True`로 opt-in해 blast radius를 리포트로 한정한다.
- `get_quote` TTL 캐시 키에 `regular` 플래그를 포함(리포트 정규장 quote와 대시보드 NXT quote 캐시 충돌 방지).
- **RSI는 정규장 전환 제외** — 1년 종가를 ~1% 균일 이동해도 RSI(정규화 모멘텀)는 사실상 불변이라 NXT 유지로 충분(불필요한 전파 회피).
- 대시보드/관심·보유 추가(delisted·이름)·`resolve_name` 등 나머지 호출처는 기본값(NXT) 그대로 — 미변경.
- 리포트와 대시보드가 같은 종목에 ~1% 다른 현재가를 보일 수 있으나(스냅샷=정규장, 라이브=NXT) 이는 의도된 기준 차이다.
- 신규 키움 fetch를 추가하는 코드는 호출 의도에 맞게 `regular`를 명시해야 한다(스냅샷=True, 라이브=기본).

## Amendment (2026-06-28, task#118) — 박제 게이트 단일 네이버 ref 구멍 정정, 다중 독립피드 강화

task#101 게이트가 배포돼 있었으나 005930이 2026-06-27·06-28 다시 70,000으로 박제됐다. 원인: **게이트 ref 획득이 `_kr_basic_naver` 단일 호출만 하고 `except → ref_price=None → "부재면 검증 생략"으로 조용히 무력화**됐다. 일배치 시점 네이버 rate-limit(또는 일시 장애)이 게이트를 no-op으로 만들어 KRX 글리치(70k)가 통과·박제됐다.

보완: ref 획득을 **다중 독립피드**로 강화(`report_generator.py` 게이트 블록, task#118). ① **네이버 retry-once** — 첫 호출 예외 시 `time.sleep(0.5)` 후 1회 재시도(transient rate-limit 완화). ② 그래도 실패·None이면 **KIS 폴백**(`_kr_basic_kis` — 키 미설정이면 None이라 dormant-safe). ③ **ref 전무(둘 다 실패·None)면 박제 스킵** + loud 로그 — 기존 "부재면 검증 생략(진행)" 동작을 **"부재면 스킵(wrong<missing)"으로 역전**한다. ref가 하나라도 있으면 기존 2x([0.5,2.0]) 교차검증 유지. 각 분기(글리치 감지·no-ref 스킵)에 `print("[Report] ...")` 진단 로그(기존 관례 — task#101의 silent no-op이 재발을 안 보이게 한 원인).

ref 선택은 다수결 아님(first-available, 네이버 우선·KIS 폴백). 글리치 5x를 잡는 데 독립 ref 하나면 충분.

## Amendment (2026-07-08, task#161) — 절대가 파생출력(RSI 타점)도 이 기준을 따른다

위 Consequences의 "RSI는 정규장 전환 제외(정규화라 불변)"는 **RSI *값*엔 맞지만 RSI *타점*엔 틀렸다.** `calc_rsi_target_price`는 `cur_price + delta_p`로 **절대 가격**을 내므로 스케일 의존이다 — 타점을 NXT 기준으로 계산하면 리포트 price·차트(regular=True, KRX)와 스케일이 어긋나고, NXT `_AL` 글리치 시 타점만 70k 스케일로 붕괴한다(적대적 감사가 포착, task#161 #2). 정정: `indicators.get_timeframe_rsi`에 `regular` 파라미터를 더해, KR 리포트는 RSI도 `regular=True`(KRX)로 계산한다(RSI 값은 여전히 불변이라 무해, 타점만 KRX로 정합).

**일반 원칙**: 이 이원화의 "정규장 제외" 판단은 출력이 **스케일 불변**일 때만 유효하다. *스케일 의존 파생출력*(절대가 타점·환산 금액 등)은 정규화 지표에서 파생되더라도 리포트 price와 같은 기준(KRX)을 따라야 한다.

## Amendment (2026-06-22, task#101) — regular=True ≠ 완전 면역, 박제-시 독립피드 게이트 보완

ADR-0020은 "리포트=regular=True(KRX)"가 NXT `_AL` 글리치 노출을 없앤다고 했고 그건 맞다. 그러나 이를 "리포트 박제 70k의 *근본해결*"로 본 결론은 **불완전**했다 — 005930 리포트가 또 ~70k로 박제된 사례(task#101)에서 드러났듯, **KRX 두 TR(quote ka10001·일봉 ka10081)이 같은 배치 시점에 함께 일시 글리치하는 KRX 자기일관 오염**엔 regular=True가 면역이 아니다. 같은 KRX 피드라 quote↔일봉이 서로 합의해버려 동일피드 교차검증·`_price_sane`(prev±30%/일봉2x)이 블라인드다(task#96이 NXT 전체오염에서 본 것의 KRX판; 네이버 실값은 정상 357k였으므로 일시적 글리치).

보완: **박제-시 독립피드 게이트**(`report_generator.generate_report`, KR만 — task#101). 저장 직전, KRX와 *독립*인 네이버 현재가(`_kr_basic_naver`, 1콜)로 `price`·일봉 기준종가를 2x([0.5,2.0]) 교차검증해 어긋나면 `ValueError`로 그 종목 박제를 **스킵**(직전 양호 스냅샷 유지, wrong<missing). 네이버 부재 시 검증 생략, `backfill_ticker`(과거 날짜)는 현재가 대조 불가라 미적용. 이는 task#98 대시보드 다수결(regular=False)과 **같은 원리**(독립 피드 교차검증)를 리포트 경로에 적용한 것 — ADR-0020의 이원화 자체는 유지하되, "regular=True면 리포트가 안전"이라는 전제만 정정한다. (게이트 임계·알고리즘은 되돌리기 쉬워 별도 ADR 없이 이 amendment로 기록.)

# 한국투자증권(KIS) REST API 레퍼런스 — PortfoliOn 백업 시세 연동

> 출처: `koreainvestment/open-trading-api`(GitHub, `examples_user/kis_auth.py`·`examples_llm/*` 검증) + KIS Developers 포털(`apiportal.koreainvestment.com`). 이 문서는 KIS를 **읽기전용 백업 시세 소스**로 쓰기 위한 정리 산출물 — 연동 경계 + 인증/요청 규약 + 현재가 TR 상세 + 대체 로드맵 + 전체 카탈로그 카테고리 트리. (키움 카탈로그는 `KIWOOM_API.md`.)

## 연동 경계 (ADR-0011)

KIS는 PortfoliOn에서 **현재가 조회의 백업 소스**로만 쓴다. [[키움 시세 소스]]와 같은 읽기전용·서버측 단일키 원칙을 따르되 역할·범위가 다르다:

- **백업, 1차 아님** — 1차 소스(KR=키움, US=yfinance)가 실패할 때만 발동하는 폴백. 체인: **KR = 키움 → KIS → Naver**, **US = yfinance → KIS**.
- **KR + US 둘 다 커버** — 키움이 KR 전용인 것과 달리 KIS는 국내·해외주식 시세를 모두 제공해 US 폴백도 된다. 단 **US 시세는 기본 15분 지연·주요지수 구성종목 중심**이라 백업으로만 충분(실시간·전체커버는 별도/유료).
- **읽기전용** — 시세 조회 TR(현재가 등)만. 주문(`*ORD*`)·계좌(`*INQR*` balance)·hashkey TR은 **연동하지 않는다**(키움과 동일 — 금전 리스크).
- **서버측 단일 자격증명** — 오너 개인 KIS 앱키 1개(`KIS_APP_KEY`/`KIS_APP_SECRET`, `.env.docker`). 유저별 OAuth 아님.
- **자격증명 미설정이 안전 기본값** — 서버에 키가 없으면 KIS는 휴면하고 기존 체인(키움/Naver/yfinance)만 동작한다. 키를 주입하면 폴백이 활성화.
- **컨센서스/목표가/상세재무는 유지** — KIS 범위 밖이라 기존 소스(FnGuide·Naver·yfinance) 유지.

## 인증 (OAuth)

| 용도 | Method | URL | 비고 |
|------|--------|-----|------|
| 접근토큰 발급 | POST | `/oauth2/tokenP` | body `{grant_type:"client_credentials", appkey, appsecret}` → `access_token` |
| 실시간 접속키 발급 | POST | `/oauth2/Approval` | → `approval_key` (WebSocket 전용, 후속 Phase) |
| hashkey | POST | `/uapi/hashkey` | **주문 전용** — 시세 조회엔 미사용 |

- 토큰 수명 **24h**. 응답 `access_token_token_expired`("YYYY-MM-DD HH:MM:SS").
- ⚠️ **토큰 발급 1분당 1회 제한** — 초과 시 `EGW00133`("접근토큰 발급 1분당 1회 초과"). 6h 재사용 권장. → **조회마다 발급 절대 금지, 토큰 싱글톤 캐시 필수.** 구현(`backend/services/kis/client.py`)은 인프로세스 싱글톤(≈23h 캐시 + 강제 재발급 60s 최소간격 가드 + 401 재발급 재시도).
- 운영 도메인 `https://openapi.koreainvestment.com:9443` · 모의 `https://openapivts.koreainvestment.com:29443`. `KIS_BASE_URL` env로 분기(기본 실전 — 시세는 계좌 불요).

## 요청 공통 규약 (REST 시세 조회)

- 시세 조회는 **GET** `{base}{path}` — 예 국내 현재가 `GET /uapi/domestic-stock/v1/quotations/inquire-price`.
- 헤더: `authorization: Bearer {token}`, `appkey`, `appsecret`, `tr_id: {TR코드}`, `custtype: P`(개인), `content-type: application/json`.
- 응답 body `rt_cd`("0"=정상)·`msg_cd`·`msg1`. 데이터는 `output`(단건) 또는 `output1/output2`(목록). 값은 **numeric string**(예 `"75000"`, `"-2.04"`).
- **연속조회**(목록형): 요청 헤더 `tr_cont`(첫 호출 `""`, 다음 `"N"`) + 응답 헤더 `tr_cont`(`F`/`M`=더 있음, `D`/`E`=마지막), body `ctx_area_fk100`/`ctx_area_nk100`. 단건 현재가 TR은 stateless라 연속조회 불요.
- **실전/모의 tr_id 접두 규칙**: 모의투자 시 live `tr_id` 첫 글자가 `T`/`J`/`C`면 `V`로 치환(주문·계좌 TR). **시세 TR(`F`/`H` 접두)은 실전·모의 동일** — `FHKST01010100`·`HHDFS00000300`은 그대로.
- **레이트리밋**: 실전 ≈20 req/sec, 모의 ≈2 req/sec (앱키당). 클라이언트는 직렬 throttle(≥50ms)로 방어.

## 실시간 시세 (WebSocket — 후속 Phase, 미구현)

- 접속키 `/oauth2/Approval`(POST) → `approval_key`(Bearer 토큰 아님). WS URL `ws://ops.koreainvestment.com:21000`(실전) / `:31000`(모의).
- 주요 실시간 tr_id: `H0STCNT0`(국내체결가)·`H0STASP0`(국내호가)·`HDFSCNT0`(해외지연체결)·`HDFSASP0`(해외호가)·`H0STCNI0`/`H0STCNI9`(체결통보).
- → **상시연결·구독한도·프론트 푸시 별도 아키텍처. 후속 Phase, Phase 1/2 미구현.**

## PortfoliOn 대체 매핑 (로드맵)

| 데이터 | 현재 소스 | KIS TR | 상태 |
|--------|-----------|--------|------|
| KR 현재가/시세 | 키움 우선+Naver | 국내 `FHKST01010100` | ✅ **적용**(Part1, 키움→KIS→Naver) |
| US 현재가/시세 | yfinance | 해외 `HHDFS00000300`(+`dailyprice` 보강) | ✅ **적용**(Part2, yfinance→KIS, 15분 지연 수용·EXCD probe) |
| US 일봉(커버리지 보강) | yfinance | 해외 `dailyprice`(`HHDFS76240000`) | ✅ **적용**(Part2, price 커버리지 밖 US 종목 종가) |
| KR 일/주/월봉 차트 | 키움 ka10081/82/83 | 국내 차트 TR | 검토(키움이 1차) |
| KR/US 수급·랭킹 | 키움·Naver | 해당 TR | 검토(키움/Naver 우선) |
| 실시간 체결/호가 푸시 | 없음(폴링) | WS `H0STCNT0`/`HDFSCNT0` | 후속 Phase |
| 컨센서스/목표가/투자의견 | FnGuide·Naver | 해당 TR 없음 | **유지**(필수) |
| KR/US 상세 재무 | Naver·yfinance | 빈약 | **유지** |

## 현재가 TR 상세 (Part 1/2 구현 대상)

### 국내주식 현재가 — `FHKST01010100` ✅ Part1

- `GET /uapi/domestic-stock/v1/quotations/inquire-price`
- query: `FID_COND_MRKT_DIV_CODE`=`J`(KRX) | `NX`(NXT) | `UN`(통합), `FID_INPUT_ISCD`={6자리 종목코드}
- `output` 주요 필드:

| 필드 | 의미 | 단위/주의 |
|------|------|-----------|
| `stck_prpr` | 현재가 | 원, numeric string |
| `stck_sdpr` | 주식 기준가(=전일종가) | 원 — prev_close로 사용 |
| `prdy_ctrt` | 전일대비율(%) | **부호 포함** 그대로 |
| `prdy_vrss` / `prdy_vrss_sign` | 전일대비 / 부호 | 부호 별도(1상한·2상승·3보합·4하한·5하락) |
| `hts_avls` | HTS 시가총액 | **억원** — ×1e8 정규화(키움 mac과 동결) |
| `per`/`pbr`/`eps` | 밸류에이션 | — |

> 종목명은 이 TR `output`에 없음 — 폴백 단계라 `market.resolve_name`이 처리(빈 이름은 티커 유지).

### 해외주식 현재가 — `HHDFS00000300` ✅ Part2

- `GET /uapi/overseas-price/v1/quotations/price`
- query: `AUTH`=`""`, `EXCD`={거래소코드}, `SYMB`={심볼}
- 미국 EXCD: NASDAQ=`NAS`, NYSE=`NYS`, AMEX=`AMS`. (주의: 다른 API의 `OVRS_EXCG_CD`는 `NASD`/`NYSE`/`AMEX` — 혼동 금지.) `market.get_quote`는 `exchange` 힌트 우선 후 NAS→NYS→AMS 순차 probe.
- `output`(단건) 주요 필드: `last`(현재가)·`base`(전일종가)·`rate`(등락율 %)·`diff`+`sign`(대비/부호, 1상한 2상승 3보합 4하한 5하락)·`tvol`(거래량)·`zdiv`(소수점 자리수).
- ⚠️ **제약**: ① 이 API는 DOW30/NDX/S&P500 구성종목 중심 → 커버리지 밖 US 종목은 `dailyprice`(`HHDFS76240000`, `output2` 일봉 리스트 newest-first의 `clos` 종가)로 보강. ② **기본 15분 지연**(실시간 US는 별도 유료 구독 — 포털 확인). 백업 경로라 수용. ③ 통화 필드 없음(USD 가정).
- ⚠️ **zdiv 스케일**: 공식 예제(`price.py`)가 `last`/`base`를 zdiv로 나누지 않고 그대로 쓰므로 **소수 가격으로 간주**(`_normalize_us_price` 동일). 절대 스케일은 **키 주입 후 yfinance 동시점 교차검증으로 최종 확인**(키움 retro 교훈 — stale 지식 아닌 incumbent 대조). 어긋나면 `÷10^zdiv` 적용으로 전환.

### 해외주식 일봉 — `HHDFS76240000` ✅ Part2 (커버리지 보강)

- `GET /uapi/overseas-price/v1/quotations/dailyprice`
- query: `AUTH`=`""`, `EXCD`, `SYMB`, `GUBN`(0=일·1=주·2=월), `BYMD`(기준일자, `""`=최근), `MODP`(0=미반영·1=수정주가).
- `output2`(일봉 리스트, **newest-first**) 필드: `xymd`(일자)·`clos`(종가)·`open`/`high`/`low`·`rate`·`diff`+`sign`·`tvol`. 최근 종가=`output2[0].clos`, 전일=`output2[1].clos`.

## 전체 카탈로그 (카테고리 트리)

> KIS는 카테고리당 다수 TR. 전체 1:1 열거는 GitHub `examples_llm/<category>/`(API별 단일함수 파일 + `chk_*.py`의 필드명↔의미 사전) 참고. 아래는 카테고리 트리 + 대략 TR 수.

| 카테고리 | 폴더(GitHub) | ~TR 수 | 하위 그룹 |
|----------|--------------|--------|-----------|
| 인증 | `auth` | 2 | REST 토큰 + WS approval |
| 국내주식 | `domestic_stock` | ~156 | 기본시세·주문·계좌·업종/지수·순위분석·실시간시세 |
| 해외주식 | `overseas_stock` | ~50 | 기본시세·주문·계좌·실시간 |
| 국내선물옵션 | `domestic_futureoption` | ~43 | — |
| 해외선물옵션 | `overseas_futureoption` | ~35 | — |
| ELW | `elw` | ~24 | — |
| 장내채권 | `domestic_bond` | ~18 | — |
| ETF/ETN | `etfetn` | ~6 | — |

> PortfoliOn 스코프에서 실제 쓰는 TR은 현재가 2종(`FHKST01010100`·`HHDFS00000300`) + 보강 `dailyprice`. 나머지는 후속 Phase 검토용 기록.

## 셋업 / 자격증명 주입

1. KIS Developers 포털(`apiportal.koreainvestment.com`) → 내 앱 → App Key/Secret 발급(또는 재발급).
2. `backend/.env.docker`(gitignore)에 직접 추가 — **시크릿은 채팅·커밋에 노출 금지**:
   ```
   KIS_APP_KEY=발급받은_앱키
   KIS_APP_SECRET=발급받은_시크릿
   # 모의투자 쓸 때만: KIS_BASE_URL=https://openapivts.koreainvestment.com:29443
   ```
3. 코드는 `kis.client.configured()` 가드로 읽음 — **키 미설정이면 KIS 휴면**(기존 동작 무변화), 키 주입 후 폴백 활성화.
4. 적용: 다음 `git push origin main` → `deploy.sh`가 `--env-file ./backend/.env.docker`로 백엔드 컨테이너 재생성하며 새 env 로딩(수동 docker 명령 불요).

## 오류코드

응답 `rt_cd`("0"=정상, 그 외 오류) + `msg_cd`/`msg1`로 판별. 주요: **`EGW00133`**(접근토큰 발급 1분당 1회 초과 — 토큰 캐시로 방어), `EGW00121`(유효하지 않은 토큰 — 401 재발급 재시도). 전체 코드는 KIS 포털 오류코드 표 참고.

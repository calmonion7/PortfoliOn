# 키움 REST API 카탈로그 — PortfoliOn 연동 레퍼런스

> 출처: `~/Documents/키움API/키움 REST API 문서.xlsx` (208개 TR). 이 문서는 "정리"(Phase 1) 산출물 — 전체 API 목록 + PortfoliOn 대체 로드맵 + 연동 경계.

## 연동 경계 (ADR-0009)

키움 API는 **전부 "국내주식"(+금현물/ELW/ETF)** 전용 — 미국/해외 종목 데이터가 없다. PortfoliOn에서 키움은 다음 경계로만 쓴다:

- **KR 전용** — US 시세·재무는 계속 yfinance. 키움은 KR 시장데이터 소스.
- **읽기전용** — 시세·차트·수급·랭킹 등 조회 TR만. 계좌(`kt00xxx`)·주문(`kt10000~`)·신용주문·금현물주문 TR은 **연동하지 않는다**.
- **서버측 단일 자격증명** — 오너 개인계좌 키 1개(`KIWOOM_APP_KEY`/`KIWOOM_SECRET_KEY`, `.env.docker`). 유저별 OAuth 아님.
- **컨센서스/목표가/상세재무는 유지** — 키움엔 컨센서스 TR이 없고 재무는 빈약(ka10001은 PER/EPS/ROE/PBR, 외부벤더·주1회). FnGuide·Naver 유지.

## 인증 (OAuth)

| TR | 용도 | Method | URL |
|----|------|--------|-----|
| au10001 | 접근토큰 발급 | POST | `/oauth2/token` |
| au10002 | 접근토큰 폐기 | POST | `/oauth2/revoke` |

- 발급 요청 body: `{"grant_type":"client_credentials", "appkey":..., "secretkey":...}` → 응답 `{token, token_type:"bearer", expires_dt:"YYYYMMDDhhmmss", return_code}`. 토큰 수명 약 24h.
- 운영 도메인 `https://api.kiwoom.com` · 모의 `https://mockapi.kiwoom.com`(KRX만). `KIWOOM_BASE_URL` env로 분기.
- 구현: `backend/services/kiwoom/client.py` — 인프로세스 싱글톤 토큰(만료 전 갱신 + 401 재발급 재시도).

## 요청 공통 규약 (REST TR)

- `POST {base}/api/dostk/{category}` — `category`는 TR의 URL 경로 끝(예 `ka10001` → `/api/dostk/stkinfo`).
- 헤더: `authorization: Bearer {token}`, `api-id: {TR코드}`, `Content-Type: application/json;charset=UTF-8`.
- 응답 body `return_code`(0=정상)·`return_msg`. 값은 **부호 포함 문자열**(예 `"+322500"`, `"-1.20"`), 금액 단위 주의(시총 `mac`=억원).
- 연속조회: 응답 헤더 `cont-yn`/`next-key`를 다음 요청 헤더로 전달(목록형 TR).

## 실시간 시세 (WebSocket)

- 엔드포인트 `wss://api.kiwoom.com:10000/api/dostk/websocket` (모의 `wss://mockapi.kiwoom.com:10000`).
- 등록/해지: body `{trnm:"REG"|"REMOVE", grp_no, refresh, data:[{item:종목코드, type:실시간타입}]}`. 수신 시 `trnm:"REAL"`.
- 주요 실시간 타입: `0B`(주식체결), `0D`(주식호가잔량), `0C`(우선호가), `0H`(예상체결), `0J`(업종지수), `0U`(업종등락), `00`(주문체결), `04`(잔고), `1h`(VI발동/해제) 등.
- 조건검색(`ka10171`~`ka10174`)도 websocket 기반. → **Phase 3(스트리밍 푸시 신규서비스)에서 다룸. Phase 1 미구현.**

## PortfoliOn 대체 매핑 (로드맵)

| 데이터 | 현재 소스 | 키움 TR | 상태 |
|--------|-----------|---------|------|
| KR 현재가/시세 | Naver basic | `ka10001` | ✅ **적용**(Phase 1, 키움 우선+Naver 폴백) |
| KR 일괄 시세(대시보드) | `get_quotes_batch` | `ka10081`(일봉 종가시리즈) | ✅ **적용**(Phase 2 part 1, 키움 일봉→daily/weekly/monthly) |
| KR 호가 | 없음 | `ka10004` / 실시간 `0D` | 계획(Phase 3) |
| KR 일/주/월봉 + RSI/차트 | yfinance | `ka10081/82/83` | ✅ **적용**(Phase 2 part 1, get_history_df seam, sector만 yfinance 잔존) |
| KR 분/틱봉 | 없음 | `ka10080/79` | 검토 |
| KR 수급(개인/외인/기관 + 외국인 보유율) | investor_service(Naver) | `ka10059`(순매수)+`ka10008`(보유율 wght) | 계획(Phase 2 part 3) |
| KR 랭킹(거래대금/거래량/등락률) | ranking_service(Naver marketValue) | `ka10032/10030/10027` | **유지(Naver)** — 키움 랭킹 TR은 시가총액·ETF구분 미제공(UI 회귀), Naver가 더 풍부·안정. 대체 미채택(2026-06-13) |
| KR 공매도 추이 | 없음 | `ka10014` | 계획(Phase 2) |
| KR 신용매매동향 | KOFIA(leverage, 별개 지표) | `ka10013` | 검토 |
| KR 대차거래 | 금융위(lending) | `ka10068/20068/90012` | 검토 |
| KR 업종/섹터 지수 모멘텀 | analysis_service(US ETF만) | `ka20006`(업종일봉)+`ka10101`(업종코드)+`ka20002`(업종별주가) | ✅ **적용**(task#48, `kr_sector_fetch` 일배치→KOSPI 24업종 모멘텀 사전계산·market_cache, 분석탭 KR/US 토글). 보유종목→업종은 `ka20002` 역인덱스 — **`ka10001`엔 업종 필드 없음**(라이브 전수 키 확인) |
| KR 프로그램매매 | 없음 | `ka90003~90013` | 계획(Phase 2) |
| KR 실시간 체결/호가 푸시 | 없음(60s 폴링) | WS `0B`/`0D` | 계획(Phase 3) |
| KR 재무(매출·자산 등) | Naver finance | (ka10001 PER/EPS만) | **유지**(Naver가 풍부) |
| KR 컨센서스/목표가/투자의견 | FnGuide·Naver Research | 해당 TR 없음 | **유지**(필수) |
| US 전체(시세·재무·컨센서스) | yfinance | 해당 없음 | **유지**(KR 전용, 영구) |

## 전체 TR 카탈로그 (207개)

실시간시세(websocket) 타입은 ID가 `00`/`0B`/`1h` 등 2자리. 그 외는 REST TR.

### OAuth 인증 > 접근토큰발급 (1)

| No | API ID | API 명 | URL |
|----|--------|--------|-----|
| 1 | `au10001` | 접근토큰 발급 | `/oauth2/token` |

### OAuth 인증 > 접근토큰폐기 (1)

| No | API ID | API 명 | URL |
|----|--------|--------|-----|
| 2 | `au10002` | 접근토큰폐기 | `/oauth2/revoke` |

### 국내주식 > 계좌 (33)

| No | API ID | API 명 | URL |
|----|--------|--------|-----|
| 3 | `ka00001` | 계좌번호조회 | `/api/dostk/acnt` |
| 5 | `ka01690` | 일별잔고수익률 | `/api/dostk/acnt` |
| 69 | `ka10072` | 일자별종목별실현손익요청_일자 | `/api/dostk/acnt` |
| 70 | `ka10073` | 일자별종목별실현손익요청_기간 | `/api/dostk/acnt` |
| 71 | `ka10074` | 일자별실현손익요청 | `/api/dostk/acnt` |
| 72 | `ka10075` | 미체결요청 | `/api/dostk/acnt` |
| 73 | `ka10076` | 체결요청 | `/api/dostk/acnt` |
| 74 | `ka10077` | 당일실현손익상세요청 | `/api/dostk/acnt` |
| 82 | `ka10085` | 계좌수익률요청 | `/api/dostk/acnt` |
| 85 | `ka10088` | 미체결 분할주문 상세 | `/api/dostk/acnt` |
| 94 | `ka10170` | 당일매매일지요청 | `/api/dostk/acnt` |
| 153 | `kt00001` | 예수금상세현황요청 | `/api/dostk/acnt` |
| 154 | `kt00002` | 일별추정예탁자산현황요청 | `/api/dostk/acnt` |
| 155 | `kt00003` | 추정자산조회요청 | `/api/dostk/acnt` |
| 156 | `kt00004` | 계좌평가현황요청 | `/api/dostk/acnt` |
| 157 | `kt00005` | 체결잔고요청 | `/api/dostk/acnt` |
| 158 | `kt00007` | 계좌별주문체결내역상세요청 | `/api/dostk/acnt` |
| 159 | `kt00008` | 계좌별익일결제예정내역요청 | `/api/dostk/acnt` |
| 160 | `kt00009` | 계좌별주문체결현황요청 | `/api/dostk/acnt` |
| 161 | `kt00010` | 주문인출가능금액요청 | `/api/dostk/acnt` |
| 162 | `kt00011` | 증거금율별주문가능수량조회요청 | `/api/dostk/acnt` |
| 163 | `kt00012` | 신용보증금율별주문가능수량조회요청 | `/api/dostk/acnt` |
| 164 | `kt00013` | 증거금세부내역조회요청 | `/api/dostk/acnt` |
| 165 | `kt00015` | 위탁종합거래내역요청 | `/api/dostk/acnt` |
| 166 | `kt00016` | 일별계좌수익률상세현황요청 | `/api/dostk/acnt` |
| 167 | `kt00017` | 계좌별당일현황요청 | `/api/dostk/acnt` |
| 168 | `kt00018` | 계좌평가잔고내역요청 | `/api/dostk/acnt` |
| 183 | `kt50020` | 금현물 잔고확인 | `/api/dostk/acnt` |
| 184 | `kt50021` | 금현물 예수금 | `/api/dostk/acnt` |
| 185 | `kt50030` | 금현물 주문체결전체조회 | `/api/dostk/acnt` |
| 186 | `kt50031` | 금현물 주문체결조회 | `/api/dostk/acnt` |
| 187 | `kt50032` | 금현물 거래내역조회 | `/api/dostk/acnt` |
| 188 | `kt50075` | 금현물 미체결조회 | `/api/dostk/acnt` |

### 국내주식 > 종목정보 (31)

| No | API ID | API 명 | URL |
|----|--------|--------|-----|
| 4 | `ka00198` | 실시간종목조회순위 | `/api/dostk/stkinfo` |
| 6 | `ka10001` | 주식기본정보요청 | `/api/dostk/stkinfo` |
| 7 | `ka10002` | 주식거래원요청 | `/api/dostk/stkinfo` |
| 8 | `ka10003` | 체결정보요청 | `/api/dostk/stkinfo` |
| 17 | `ka10013` | 신용매매동향요청 | `/api/dostk/stkinfo` |
| 19 | `ka10015` | 일별거래상세요청 | `/api/dostk/stkinfo` |
| 20 | `ka10016` | 신고저가요청 | `/api/dostk/stkinfo` |
| 21 | `ka10017` | 상하한가요청 | `/api/dostk/stkinfo` |
| 22 | `ka10018` | 고저가근접요청 | `/api/dostk/stkinfo` |
| 23 | `ka10019` | 가격급등락요청 | `/api/dostk/stkinfo` |
| 28 | `ka10024` | 거래량갱신요청 | `/api/dostk/stkinfo` |
| 29 | `ka10025` | 매물대집중요청 | `/api/dostk/stkinfo` |
| 30 | `ka10026` | 고저PER요청 | `/api/dostk/stkinfo` |
| 32 | `ka10028` | 시가대비등락률요청 | `/api/dostk/stkinfo` |
| 46 | `ka10043` | 거래원매물대분석요청 | `/api/dostk/stkinfo` |
| 54 | `ka10052` | 거래원순간거래량요청 | `/api/dostk/stkinfo` |
| 56 | `ka10054` | 변동성완화장치발동종목요청 | `/api/dostk/stkinfo` |
| 57 | `ka10055` | 당일전일체결량요청 | `/api/dostk/stkinfo` |
| 58 | `ka10058` | 투자자별일별매매종목요청 | `/api/dostk/stkinfo` |
| 59 | `ka10059` | 종목별투자자기관별요청 | `/api/dostk/stkinfo` |
| 61 | `ka10061` | 종목별투자자기관별합계요청 | `/api/dostk/stkinfo` |
| 81 | `ka10084` | 당일전일체결요청 | `/api/dostk/stkinfo` |
| 87 | `ka10095` | 관심종목정보요청 | `/api/dostk/stkinfo` |
| 89 | `ka10099` | 종목정보 리스트 | `/api/dostk/stkinfo` |
| 90 | `ka10100` | 종목정보 조회 | `/api/dostk/stkinfo` |
| 91 | `ka10101` | 업종코드 리스트 | `/api/dostk/stkinfo` |
| 92 | `ka10102` | 회원사 리스트 | `/api/dostk/stkinfo` |
| 143 | `ka90003` | 프로그램순매수상위50요청 | `/api/dostk/stkinfo` |
| 144 | `ka90004` | 종목별프로그램매매현황요청 | `/api/dostk/stkinfo` |
| 177 | `kt20016` | 신용융자 가능종목요청 | `/api/dostk/stkinfo` |
| 178 | `kt20017` | 신용융자 가능문의 | `/api/dostk/stkinfo` |

### 국내주식 > 시세 (25)

| No | API ID | API 명 | URL |
|----|--------|--------|-----|
| 9 | `ka10004` | 주식호가요청 | `/api/dostk/mrkcond` |
| 10 | `ka10005` | 주식일주월시분요청 | `/api/dostk/mrkcond` |
| 11 | `ka10006` | 주식시분요청 | `/api/dostk/mrkcond` |
| 12 | `ka10007` | 시세표성정보요청 | `/api/dostk/mrkcond` |
| 16 | `ka10011` | 신주인수권전체시세요청 | `/api/dostk/mrkcond` |
| 47 | `ka10044` | 일별기관매매종목요청 | `/api/dostk/mrkcond` |
| 48 | `ka10045` | 종목별기관매매추이요청 | `/api/dostk/mrkcond` |
| 49 | `ka10046` | 체결강도추이시간별요청 | `/api/dostk/mrkcond` |
| 50 | `ka10047` | 체결강도추이일별요청 | `/api/dostk/mrkcond` |
| 63 | `ka10063` | 장중투자자별매매요청 | `/api/dostk/mrkcond` |
| 66 | `ka10066` | 장마감후투자자별매매요청 | `/api/dostk/mrkcond` |
| 75 | `ka10078` | 증권사별종목매매동향요청 | `/api/dostk/mrkcond` |
| 83 | `ka10086` | 일별주가요청 | `/api/dostk/mrkcond` |
| 84 | `ka10087` | 시간외단일가요청 | `/api/dostk/mrkcond` |
| 128 | `ka50010` | 금현물체결추이 | `/api/dostk/mrkcond` |
| 129 | `ka50012` | 금현물일별추이 | `/api/dostk/mrkcond` |
| 135 | `ka50087` | 금현물예상체결 | `/api/dostk/mrkcond` |
| 138 | `ka50100` | 금현물 시세정보 | `/api/dostk/mrkcond` |
| 139 | `ka50101` | 금현물 호가 | `/api/dostk/mrkcond` |
| 145 | `ka90005` | 프로그램매매추이요청 시간대별 | `/api/dostk/mrkcond` |
| 146 | `ka90006` | 프로그램매매차익잔고추이요청 | `/api/dostk/mrkcond` |
| 147 | `ka90007` | 프로그램매매누적추이요청 | `/api/dostk/mrkcond` |
| 148 | `ka90008` | 종목시간별프로그램매매추이요청 | `/api/dostk/mrkcond` |
| 150 | `ka90010` | 프로그램매매추이요청 일자별 | `/api/dostk/mrkcond` |
| 152 | `ka90013` | 종목일별프로그램매매추이요청 | `/api/dostk/mrkcond` |

### 국내주식 > 기관/외국인 (4)

| No | API ID | API 명 | URL |
|----|--------|--------|-----|
| 13 | `ka10008` | 주식외국인종목별매매동향 | `/api/dostk/frgnistt` |
| 14 | `ka10009` | 주식기관요청 | `/api/dostk/frgnistt` |
| 93 | `ka10131` | 기관외국인연속매매현황요청 | `/api/dostk/frgnistt` |
| 140 | `ka52301` | 금현물투자자현황 | `/api/dostk/frgnistt` |

### 국내주식 > 업종 (6)

| No | API ID | API 명 | URL |
|----|--------|--------|-----|
| 15 | `ka10010` | 업종프로그램요청 | `/api/dostk/sect` |
| 53 | `ka10051` | 업종별투자자순매수요청 | `/api/dostk/sect` |
| 99 | `ka20001` | 업종현재가요청 | `/api/dostk/sect` |
| 100 | `ka20002` | 업종별주가요청 | `/api/dostk/sect` |
| 101 | `ka20003` | 전업종지수요청 | `/api/dostk/sect` |
| 107 | `ka20009` | 업종현재가일별요청 | `/api/dostk/sect` |

### 국내주식 > 공매도 (1)

| No | API ID | API 명 | URL |
|----|--------|--------|-----|
| 18 | `ka10014` | 공매도추이요청 | `/api/dostk/shsa` |

### 국내주식 > 순위정보 (23)

| No | API ID | API 명 | URL |
|----|--------|--------|-----|
| 24 | `ka10020` | 호가잔량상위요청 | `/api/dostk/rkinfo` |
| 25 | `ka10021` | 호가잔량급증요청 | `/api/dostk/rkinfo` |
| 26 | `ka10022` | 잔량율급증요청 | `/api/dostk/rkinfo` |
| 27 | `ka10023` | 거래량급증요청 | `/api/dostk/rkinfo` |
| 31 | `ka10027` | 전일대비등락률상위요청 | `/api/dostk/rkinfo` |
| 33 | `ka10029` | 예상체결등락률상위요청 | `/api/dostk/rkinfo` |
| 34 | `ka10030` | 당일거래량상위요청 | `/api/dostk/rkinfo` |
| 35 | `ka10031` | 전일거래량상위요청 | `/api/dostk/rkinfo` |
| 36 | `ka10032` | 거래대금상위요청 | `/api/dostk/rkinfo` |
| 37 | `ka10033` | 신용비율상위요청 | `/api/dostk/rkinfo` |
| 38 | `ka10034` | 외인기간별매매상위요청 | `/api/dostk/rkinfo` |
| 39 | `ka10035` | 외인연속순매매상위요청 | `/api/dostk/rkinfo` |
| 40 | `ka10036` | 외인한도소진율증가상위 | `/api/dostk/rkinfo` |
| 41 | `ka10037` | 외국계창구매매상위요청 | `/api/dostk/rkinfo` |
| 42 | `ka10038` | 종목별증권사순위요청 | `/api/dostk/rkinfo` |
| 43 | `ka10039` | 증권사별매매상위요청 | `/api/dostk/rkinfo` |
| 44 | `ka10040` | 당일주요거래원요청 | `/api/dostk/rkinfo` |
| 45 | `ka10042` | 순매수거래원순위요청 | `/api/dostk/rkinfo` |
| 55 | `ka10053` | 당일상위이탈원요청 | `/api/dostk/rkinfo` |
| 62 | `ka10062` | 동일순매매순위요청 | `/api/dostk/rkinfo` |
| 65 | `ka10065` | 장중투자자별매매상위요청 | `/api/dostk/rkinfo` |
| 88 | `ka10098` | 시간외단일가등락율순위요청 | `/api/dostk/rkinfo` |
| 149 | `ka90009` | 외국인기관매매상위요청 | `/api/dostk/rkinfo` |

### 국내주식 > ELW (11)

| No | API ID | API 명 | URL |
|----|--------|--------|-----|
| 51 | `ka10048` | ELW일별민감도지표요청 | `/api/dostk/elw` |
| 52 | `ka10050` | ELW민감도지표요청 | `/api/dostk/elw` |
| 110 | `ka30001` | ELW가격급등락요청 | `/api/dostk/elw` |
| 111 | `ka30002` | 거래원별ELW순매매상위요청 | `/api/dostk/elw` |
| 112 | `ka30003` | ELWLP보유일별추이요청 | `/api/dostk/elw` |
| 113 | `ka30004` | ELW괴리율요청 | `/api/dostk/elw` |
| 114 | `ka30005` | ELW조건검색요청 | `/api/dostk/elw` |
| 115 | `ka30009` | ELW등락율순위요청 | `/api/dostk/elw` |
| 116 | `ka30010` | ELW잔량순위요청 | `/api/dostk/elw` |
| 117 | `ka30011` | ELW근접율요청 | `/api/dostk/elw` |
| 118 | `ka30012` | ELW종목상세정보요청 | `/api/dostk/elw` |

### 국내주식 > 차트 (21)

| No | API ID | API 명 | URL |
|----|--------|--------|-----|
| 60 | `ka10060` | 종목별투자자기관별차트요청 | `/api/dostk/chart` |
| 64 | `ka10064` | 장중투자자별매매차트요청 | `/api/dostk/chart` |
| 76 | `ka10079` | 주식틱차트조회요청 | `/api/dostk/chart` |
| 77 | `ka10080` | 주식분봉차트조회요청 | `/api/dostk/chart` |
| 78 | `ka10081` | 주식일봉차트조회요청 | `/api/dostk/chart` |
| 79 | `ka10082` | 주식주봉차트조회요청 | `/api/dostk/chart` |
| 80 | `ka10083` | 주식월봉차트조회요청 | `/api/dostk/chart` |
| 86 | `ka10094` | 주식년봉차트조회요청 | `/api/dostk/chart` |
| 102 | `ka20004` | 업종틱차트조회요청 | `/api/dostk/chart` |
| 103 | `ka20005` | 업종분봉조회요청 | `/api/dostk/chart` |
| 104 | `ka20006` | 업종일봉조회요청 | `/api/dostk/chart` |
| 105 | `ka20007` | 업종주봉조회요청 | `/api/dostk/chart` |
| 106 | `ka20008` | 업종월봉조회요청 | `/api/dostk/chart` |
| 108 | `ka20019` | 업종년봉조회요청 | `/api/dostk/chart` |
| 130 | `ka50079` | 금현물틱차트조회요청 | `/api/dostk/chart` |
| 131 | `ka50080` | 금현물분봉차트조회요청 | `/api/dostk/chart` |
| 132 | `ka50081` | 금현물일봉차트조회요청 | `/api/dostk/chart` |
| 133 | `ka50082` | 금현물주봉차트조회요청 | `/api/dostk/chart` |
| 134 | `ka50083` | 금현물월봉차트조회요청 | `/api/dostk/chart` |
| 136 | `ka50091` | 금현물당일틱차트조회요청 | `/api/dostk/chart` |
| 137 | `ka50092` | 금현물당일분봉차트조회요청 | `/api/dostk/chart` |

### 국내주식 > 대차거래 (4)

| No | API ID | API 명 | URL |
|----|--------|--------|-----|
| 67 | `ka10068` | 대차거래추이요청 | `/api/dostk/slb` |
| 68 | `ka10069` | 대차거래상위10종목요청 | `/api/dostk/slb` |
| 109 | `ka20068` | 대차거래추이요청(종목별) | `/api/dostk/slb` |
| 151 | `ka90012` | 대차거래내역요청 | `/api/dostk/slb` |

### 국내주식 > 조건검색 (4)

| No | API ID | API 명 | URL |
|----|--------|--------|-----|
| 95 | `ka10171` | 조건검색 목록조회 | `/api/dostk/websocket` |
| 96 | `ka10172` | 조건검색 요청 일반 | `/api/dostk/websocket` |
| 97 | `ka10173` | 조건검색 요청 실시간 | `/api/dostk/websocket` |
| 98 | `ka10174` | 조건검색 실시간 해제 | `/api/dostk/websocket` |

### 국내주식 > ETF (9)

| No | API ID | API 명 | URL |
|----|--------|--------|-----|
| 119 | `ka40001` | ETF수익율요청 | `/api/dostk/etf` |
| 120 | `ka40002` | ETF종목정보요청 | `/api/dostk/etf` |
| 121 | `ka40003` | ETF일별추이요청 | `/api/dostk/etf` |
| 122 | `ka40004` | ETF전체시세요청 | `/api/dostk/etf` |
| 123 | `ka40006` | ETF시간대별추이요청 | `/api/dostk/etf` |
| 124 | `ka40007` | ETF시간대별체결요청 | `/api/dostk/etf` |
| 125 | `ka40008` | ETF일자별체결요청 | `/api/dostk/etf` |
| 126 | `ka40009` | ETF시간대별NAV현황 | `/api/dostk/etf` |
| 127 | `ka40010` | ETF시간대별수급현황 | `/api/dostk/etf` |

### 국내주식 > 테마 (2)

| No | API ID | API 명 | URL |
|----|--------|--------|-----|
| 141 | `ka90001` | 테마그룹별요청 | `/api/dostk/thme` |
| 142 | `ka90002` | 테마구성종목요청 | `/api/dostk/thme` |

### 국내주식 > 주문 (8)

| No | API ID | API 명 | URL |
|----|--------|--------|-----|
| 169 | `kt10000` | 주식 매수주문 | `/api/dostk/ordr` |
| 170 | `kt10001` | 주식 매도주문 | `/api/dostk/ordr` |
| 171 | `kt10002` | 주식 정정주문 | `/api/dostk/ordr` |
| 172 | `kt10003` | 주식 취소주문 | `/api/dostk/ordr` |
| 179 | `kt50000` | 금현물 매수주문 | `/api/dostk/ordr` |
| 180 | `kt50001` | 금현물 매도주문 | `/api/dostk/ordr` |
| 181 | `kt50002` | 금현물 정정주문 | `/api/dostk/ordr` |
| 182 | `kt50003` | 금현물 취소주문 | `/api/dostk/ordr` |

### 국내주식 > 신용주문 (4)

| No | API ID | API 명 | URL |
|----|--------|--------|-----|
| 173 | `kt10006` | 신용 매수주문 | `/api/dostk/crdordr` |
| 174 | `kt10007` | 신용 매도주문 | `/api/dostk/crdordr` |
| 175 | `kt10008` | 신용 정정주문 | `/api/dostk/crdordr` |
| 176 | `kt10009` | 신용 취소주문 | `/api/dostk/crdordr` |

### 국내주식 > 실시간시세 (19)

| No | API ID | API 명 | URL |
|----|--------|--------|-----|
| 189 | `00` | 주문체결 | `/api/dostk/websocket` |
| 190 | `04` | 잔고 | `/api/dostk/websocket` |
| 191 | `0A` | 주식기세 | `/api/dostk/websocket` |
| 192 | `0B` | 주식체결 | `/api/dostk/websocket` |
| 193 | `0C` | 주식우선호가 | `/api/dostk/websocket` |
| 194 | `0D` | 주식호가잔량 | `/api/dostk/websocket` |
| 195 | `0E` | 주식시간외호가 | `/api/dostk/websocket` |
| 196 | `0F` | 주식당일거래원 | `/api/dostk/websocket` |
| 197 | `0G` | ETF NAV | `/api/dostk/websocket` |
| 198 | `0H` | 주식예상체결 | `/api/dostk/websocket` |
| 199 | `0I` | 국제금환산가격 | `/api/dostk/websocket` |
| 200 | `0J` | 업종지수 | `/api/dostk/websocket` |
| 201 | `0U` | 업종등락 | `/api/dostk/websocket` |
| 202 | `0g` | 주식종목정보 | `/api/dostk/websocket` |
| 203 | `0m` | ELW 이론가 | `/api/dostk/websocket` |
| 204 | `0s` | 장시작시간 | `/api/dostk/websocket` |
| 205 | `0u` | ELW 지표 | `/api/dostk/websocket` |
| 206 | `0w` | 종목프로그램매매 | `/api/dostk/websocket` |
| 207 | `1h` | VI발동/해제 | `/api/dostk/websocket` |

## 오류코드

공통 오류코드 표는 원본 엑셀 `오류코드` 시트 참고. 응답 `return_code`(0=정상, 그 외 오류) + `return_msg`로 판별.

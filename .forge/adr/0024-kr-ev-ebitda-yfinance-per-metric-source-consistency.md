# ADR-0024 — KR EV/EBITDA는 yfinance 소스 + 멀티플은 지표별 동일 소스 원칙

- 상태: 채택
- 날짜: 2026-07-10
- 관련: task#169(상대 밸류에이션), ADR-0009(키움 경계)·ADR-0011(KIS 백업)

## 맥락

KR 메인 종목의 `ev_ebitda`는 `report_generator`에서 **항상 None 고정**이고, 경쟁사(`_comp_valuation`)는 PER/PBR만 수집한다. 상대 밸류에이션(peer 비교) 기능에 PSR·EV/EBITDA를 붙이려면 KR EBITDA 소스가 필요하다. 라이브 프로브 실측(2026-07-10):

- **Naver finance API 불가**: `m.stock.naver.com/api/stock/{code}/finance/{annual|quarter}`는 16 row뿐(매출·영업이익·순이익·비율·EPS/PER/BPS/PBR/배당) — EBITDA·감가상각·차입금·현금 row **부재**.
- **DART 직접 계산은 리스크 최대**: EBITDA=영업이익+감가상각(fnlttSinglAcntAll CFS), EV=시총+순차입금인데, 감가상각 account_id가 회사별로 통합/분리/표준 미매핑으로 갈리고 차입금 계정 분류(단기/유동성장기/사채/장기)도 변동 — 기존 확정 account_id는 OCF·CAPEX·이자지급 3종뿐(task#117).
- **yfinance는 즉시 가용**: `.KS`/`.KQ` `info.enterpriseToEbitda`가 KOSPI·KOSDAQ 모두 그럴듯한 값을 준다(실측: 005930=12.3x, 000660=16.5x, 035420=8.5x, 247540.KQ=60.1x).

## 결정

1. **KR EV/EBITDA(메인 종목 + 경쟁사)는 yfinance를 소스로 한다** — US와 동일 필드(`enterpriseToEbitda`)·동일 코드 경로. DART 파싱을 전면 회피.
2. **지표별 동일 소스 원칙**: 하나의 멀티플 행(내 종목 vs peer 비교)은 **모든 엔티티가 같은 소스**여야 한다. PSR은 KR 메인이 Naver TTM 계산이므로 KR 경쟁사도 Naver TTM 계산(메인 로직 재사용), EV/EBITDA는 메인·경쟁사 모두 yfinance.

## 근거

같은 지표 행 안에서 소스(방법론·TTM 윈도)가 엔티티별로 갈리면 **peer 비교 자체가 왜곡**된다 — 상대 판정 기능의 목적 파괴. 그래서 "신규 필드 전부 yfinance"(콜 수 최소)가 아니라 지표별 일관성을 택했다. yfinance는 비공식이지만 KR 커버리지를 실측으로 확인했고, 실패 시 None graceful(wrong<missing)이며, 스케일 오류 위험이 문서 파싱 방식(단위 캡션 오독 ×100)보다 낮다.

## 결과

- KR EV/EBITDA 정확도는 Yahoo 데이터 품질에 종속(소형주 patchy 가능) — None graceful 허용, 값 없으면 칩/판정에서 자연 제외.
- 미래에 소스를 바꾸면 이미 박제된 스냅샷과 방법론이 섞인다 — 전 종목 재생성 전엔 혼재. 이 되돌리기 비용이 본 ADR을 남기는 이유.
- 경쟁사 KR 티커는 exchange 정보가 없어(`tickers.competitors`는 코드 문자열 배열) `.KS`→`.KQ` 폴백 probe가 필요하다.

## 검토한 대안

- **Naver finance API**: 기각 — EBITDA 관련 row 자체가 없음(실측).
- **DART fnlttSinglAcntAll 직접 계산**: 기각 — 공식 재무제표 기반이라는 장점은 있으나 account_id 회사별 변동·차입금 분류·감가상각 위치 리스크로 파싱 비용/오류 위험 최대.

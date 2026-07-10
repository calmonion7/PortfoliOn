---
status: accepted
---

# KIS(한국투자증권) REST API 연동 경계 — 읽기전용 백업 시세 소스 (KR+US)

한국투자증권(KIS) REST API를 PortfoliOn의 **백업 시세 소스**로 연동하면서 경계를 못박는다. KIS는 [[키움 시세 소스]](ADR-0009)와 같은 서버측 단일 자격증명·읽기전용 원칙을 따르되 역할·범위가 다르다. **(1) 백업, 1차 아님**: 현재가 조회의 1차 소스(KR=키움, US=yfinance)가 실패할 때만 발동하는 폴백이다. 체인은 KR=키움→KIS→Naver, US=yfinance→KIS. 1차 소스는 그대로 둔다. **(2) 읽기전용**: 국내·해외주식 시세 조회 TR(현재가 등)만 쓰고 주문·계좌·hashkey TR은 연동하지 않는다(키움 경계와 동일 — 금전 리스크). **(3) 서버측 단일 자격증명**: 오너 개인 KIS 앱키(`KIS_APP_KEY`/`KIS_APP_SECRET`, `.env.docker` gitignore)를 단일 데이터 소스로 쓴다. 토큰은 인프로세스 싱글톤으로 발급·캐시하며 **발급 1분당 1회 제한(EGW00133)**을 가드한다. **자격증명 미설정이 안전 기본값** — 키가 없으면 KIS는 휴면하고 기존 체인(키움/Naver/yfinance)만 동작한다.

## Considered Options

- **KIS를 1차로 키움/yfinance 대체** — 거부. 키움·yfinance가 안정적이고 KIS US 시세는 기본 15분 지연·주요지수 구성종목 중심이라 1차로 부적합. KIS는 이중화 가치로 백업에 둔다.
- **KR만 백업(US 제외)** — 부분 거부. 키움이 KR 전용이라 US는 현재 yfinance 단일 장애점이다. KIS가 US를 커버하므로 US 폴백을 추가해 단일 장애점을 없앤다(지연·커버리지 제약은 백업 한정이라 수용).
- **주문·계좌까지 풀 연동 / 유저별 OAuth** — 거부. ADR-0009와 동일 논리(금전 리스크, 공용 시장데이터엔 유저별 계정 불요).

## Consequences

- US 현재가 폴백은 overseas price API(주요지수 구성종목)로 받고, 커버리지 밖 종목은 dailyprice(종가)로 보강한다. 거래소 코드는 NAS→NYS→AMS 순차 probe.
- KIS US 시세는 백업 경로(yfinance 정상 시 미발동)라 15분 지연이 노출되는 경우가 드물고 포트폴리오 평가엔 충분하다. 실시간 US가 필요해지면 별도 유료 구독·의사결정으로 다시 다룬다.
- 일괄 시세(`get_quotes_batch`)는 별도 배선 없이 기존 `get_quote` 폴백을 통해 KIS 혜택을 받는다.
- 컨센서스/목표가/상세재무는 KIS 범위 밖 — 기존 소스(FnGuide·Naver·yfinance) 유지(ADR-0009와 동일).
- 차트·수급·랭킹·실시간 WebSocket(approval_key/H0STCNT0 등) 대체는 카탈로그(`KIS_API.md`)에 기록만 하고 후속 Phase로 둔다.

# 주식 포트폴리오 관리 & 자동 리포트 생성 도구 — 설계 문서

**날짜:** 2026-05-04  
**상태:** 승인됨

---

## 1. 개요

사용자가 보유한 주식 종목을 웹 UI에서 관리하고, Yahoo Finance 데이터를 기반으로 종목별 심층 분석 리포트를 마크다운 파일로 자동 생성하는 도구.

**핵심 목표:**
- 웹 브라우저에서 종목 추가/수정/삭제
- 일봉/주봉/월봉 RSI, EMA, 지지/저항 기반 매수매도 타점 제공
- 증권사 컨센서스·뉴스·재무 데이터를 포함한 7개 섹션 마크다운 리포트
- 수동 버튼 + 자동 스케줄로 리포트 생성

---

## 2. 기술 스택

| 레이어 | 기술 |
|---|---|
| 백엔드 | Python 3.11+, FastAPI, APScheduler |
| 데이터 수집 | yfinance, Finviz 스크래핑, Yahoo Finance 뉴스 스크래핑 |
| 데이터 처리 | pandas (RSI/EMA 계산), matplotlib (차트 PNG 생성) |
| 프론트엔드 | React 18, Recharts (인터랙티브 차트) |
| 저장소 | portfolio.json (종목), schedule.json (스케줄), reports/ (마크다운+PNG) |

DB 없음 — 모든 데이터는 로컬 JSON 파일로 관리.

**서빙 전략:** 개발 환경에서는 백엔드(포트 8000)와 프론트엔드 dev server(포트 3000)를 별도 실행. 배포 시 `npm run build` 후 FastAPI의 StaticFiles로 React 빌드 서빙.

---

## 3. 프로젝트 구조

```
myProject/
├── backend/
│   ├── main.py                  # FastAPI 앱 + APScheduler 초기화
│   ├── routers/
│   │   ├── portfolio.py         # 종목 CRUD API
│   │   └── report.py            # 리포트 생성·조회 API
│   ├── services/
│   │   ├── market.py            # yfinance 현재가·재무 데이터 조회
│   │   ├── indicators.py        # RSI/EMA 계산 (pandas)
│   │   ├── scraper.py           # Finviz·Yahoo Finance 뉴스 스크래핑
│   │   └── report_generator.py  # 마크다운 + 차트 PNG 생성
│   ├── scheduler.py             # APScheduler 설정 및 자동 실행 로직
│   ├── data/
│   │   ├── portfolio.json       # 종목 데이터
│   │   └── schedule.json        # 스케줄 설정
│   └── reports/
│       └── {TICKER}/
│           └── YYYY-MM-DD.md    # 생성된 리포트 (+ PNG 이미지)
└── frontend/
    ├── public/
    └── src/
        ├── App.jsx
        ├── pages/
        │   ├── Portfolio.jsx     # 종목 관리 화면
        │   ├── Reports.jsx       # 리포트 목록 + 뷰어
        │   └── Settings.jsx      # 스케줄 설정
        └── components/
            ├── StockModal.jsx    # 종목 추가/수정 모달
            └── MarkdownViewer.jsx
```

---

## 4. 데이터 모델

### portfolio.json
```json
{
  "stocks": [
    {
      "ticker": "NFLX",
      "name": "Netflix",
      "quantity": 10,
      "avg_cost": 85.59,
      "competitors": ["DIS", "WBD", "PARA"],
      "moat": "콘텐츠 IP 및 글로벌 구독 네트워크 효과",
      "growth_plan": "광고 요금제 확대, 게임 서비스 진출"
    }
  ]
}
```

### schedule.json
```json
{
  "enabled": true,
  "time": "08:00",
  "days": ["mon", "tue", "wed", "thu", "fri"]
}
```

---

## 5. API 명세

| 메서드 | 경로 | 설명 |
|---|---|---|
| GET | `/api/portfolio` | 전체 종목 목록 조회 |
| POST | `/api/portfolio` | 종목 추가 |
| PUT | `/api/portfolio/{ticker}` | 종목 수정 |
| DELETE | `/api/portfolio/{ticker}` | 종목 삭제 |
| POST | `/api/report/generate` | 전체 종목 리포트 즉시 생성 |
| POST | `/api/report/generate/{ticker}` | 단일 종목 리포트 즉시 생성 |
| GET | `/api/report/list` | 생성된 리포트 목록 조회 |
| GET | `/api/report/{ticker}/{date}` | 특정 리포트 내용 조회 |
| GET | `/api/schedule` | 스케줄 설정 조회 |
| PUT | `/api/schedule` | 스케줄 설정 변경 |

---

## 6. 데이터 소스 및 갱신 주기

| 데이터 항목 | 소스 | 갱신 주기 |
|---|---|---|
| 현재가, 거래량 | yfinance | 매일 |
| 일봉/주봉/월봉 RSI(14), EMA | yfinance + pandas 계산 | 매일 |
| 지지·저항 레벨 | yfinance 52주 고저 + 이동평균 | 매일 |
| 분기 매출·영업이익 | yfinance `financials` | 분기별 |
| 경쟁사 시가총액·현재가 | yfinance | 매일 |
| 애널리스트 목표가·추천 | yfinance + Finviz 스크래핑 | 매일 |
| 최근 뉴스·공시 | Yahoo Finance 뉴스 스크래핑 | 매일 |
| 경제적 해자, 장기 계획 | portfolio.json (직접 입력) | 수동 |

---

## 7. 리포트 구조 (마크다운 섹션)

종목별 독립 파일: `reports/{TICKER}/YYYY-MM-DD.md`

### ① 사업영역 & 시장순위
- 경쟁사 비교 테이블: 종목명, 티커, 현재가, 시가총액, YTD 수익률
- 데이터: yfinance 자동 조회

### ② 매출/영업이익 추이
- 최근 4개 분기 테이블
- 막대 차트 PNG 임베드 (`revenue_chart.png`)

### ③ 증권사 컨센서스
- 평균 목표가, 최고/최저 목표가, Buy/Hold/Sell 비율 테이블
- yfinance `recommendations` + Finviz 스크래핑 조합

### ④ 경제적 해자
- portfolio.json의 `moat` 필드 텍스트 출력 (짧게)

### ⑤ 장기 성장 계획
- portfolio.json의 `growth_plan` 필드 텍스트 출력

### ⑥ 최근 공시 & 주가 영향
- 어제 종가, 전일 대비 변동률
- Yahoo Finance 뉴스 스크래핑 결과 (최근 5건, 제목+링크+날짜)

### ⑦ 매수/매도 타점
- RSI 테이블: 일봉/주봉/월봉 RSI 현재값, RSI 30/70 도달 예상가
- 지지/저항 레벨 테이블
- EMA(20/50/200) 현재값
- RSI 차트 PNG 임베드 (`rsi_chart.png`)

**RSI 30/70 도달 예상가 계산:** 최근 14일 가격-RSI 선형 회귀로 역산한 근사값.

---

## 8. 차트 생성 전략

| 환경 | 방식 |
|---|---|
| 마크다운 파일 | matplotlib으로 PNG 생성 후 `![chart](./image.png)` 임베드 |
| 웹 UI | Recharts 컴포넌트로 인터랙티브 렌더링 |

---

## 9. 프론트엔드 페이지

### `/portfolio` — 종목 관리
- 종목 목록 테이블 (티커, 현재가, 수익률%, 보유수량, 평단가)
- "종목 추가" 버튼 → 모달: 티커, 수량, 평단가, 경쟁사 티커(쉼표 구분, 선택), 경제적 해자(선택), 장기계획(선택)
- 행 클릭 → 수정/삭제

### `/reports` — 리포트 뷰어
- 좌측: 종목별 리포트 날짜 목록
- 우측: 마크다운 렌더링 (react-markdown), PNG 차트 표시

### `/settings` — 스케줄 설정
- 활성화 토글
- 시간 선택 (HH:MM)
- 요일 체크박스 (월~금)
- "지금 생성" 버튼 (전체 종목 즉시 리포트 생성)

---

## 10. 오류 처리

| 상황 | 처리 방식 |
|---|---|
| yfinance 조회 실패 | 해당 섹션에 "데이터 조회 실패" 표시, 나머지 섹션 정상 생성 |
| 스크래핑 차단 | 빈 목록으로 대체, 로그에 경고 |
| 잘못된 티커 입력 | UI에서 yfinance로 사전 검증 후 저장 |
| 스케줄 실행 중 오류 | 로그 기록, 다음 스케줄에 재시도 |

---

## 11. 범위 외 (이번 구현에서 제외)

- 사용자 인증/로그인
- 다중 사용자 지원
- 실시간 가격 WebSocket 스트리밍
- 모바일 앱

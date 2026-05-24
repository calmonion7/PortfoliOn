# Daily Digest — Design Spec

**Date:** 2026-05-23  
**Status:** Approved

---

## Problem

사용자가 보유/관심종목 현황을 파악하려면 Portfolio, Calendar, Reports 탭을 각각 열어야 한다. 수동 확인 작업이 많고, 중요한 이벤트나 이상신호를 놓칠 수 있다.

---

## Goal

매일 아침 포트폴리오 전체 상황을 한 페이지로 요약 제공. 앱 내 전용 페이지 + Telegram 발송으로 앱을 열지 않아도 확인 가능.

---

## Architecture

```
[APScheduler] ──매일 08:00──▶ [DigestService]
                                    │
                    ┌───────────────┼───────────────┐
                    ▼               ▼               ▼
              yfinance 가격    Calendar 이벤트   이상신호 감지
                    └───────────────┼───────────────┘
                                    ▼
                          data/digest/YYYY-MM-DD.json
                                    │
                    ┌───────────────┴───────────────┐
                    ▼                               ▼
            GET /api/digest/latest          Telegram 발송
                    │
                    ▼
              Digest.jsx (새 페이지)
```

### 재활용하는 기존 코드
- `calendar.py` — 이벤트 조회 로직
- `stocks.py` — yfinance quote 로직
- `scheduler.py` — APScheduler 설정

### 새로 추가되는 파일
- `backend/services/digest_service.py`
- `backend/routers/digest.py`
- `backend/data/digest/` (날짜별 JSON 스냅샷)
- `frontend/src/pages/Digest.jsx`

---

## Data Model

`backend/data/digest/YYYY-MM-DD.json`:

```json
{
  "date": "2026-05-23",
  "generated_at": "2026-05-23T08:00:00+09:00",
  "portfolio_summary": {
    "total_value_usd": 125000.0,
    "daily_change_pct": -0.8,
    "daily_change_usd": -1020.5
  },
  "stocks": [
    {
      "ticker": "AAPL",
      "name": "Apple Inc.",
      "change_pct": -1.3,
      "is_holding": true,
      "is_anomaly": false
    }
  ],
  "events_7d": [
    {
      "ticker": "AAPL",
      "event_type": "earnings",
      "date": "2026-05-27",
      "days_until": 4
    }
  ],
  "anomalies": [
    {
      "ticker": "TSLA",
      "change_pct": -6.2,
      "reason": "5% 이상 하락"
    }
  ]
}
```

---

## API Endpoints

| Method | Path | 설명 |
|--------|------|------|
| `GET` | `/api/digest/latest` | 오늘 또는 가장 최근 Digest 반환 |
| `POST` | `/api/digest/generate` | 즉시 Digest 생성 (수동 새로고침) |

---

## Digest 생성 로직 (DigestService)

1. `stocks.json`에서 보유/관심종목 목록 로드
2. yfinance로 전 종목 현재가·전일 종가 병렬 fetch
3. 보유종목 기준 포트폴리오 총 평가액·일간 손익 계산
4. Calendar API로 향후 7일 이벤트 조회
5. 이상신호 판정: `abs(change_pct) >= 5.0` (하드코딩)
6. JSON 스냅샷 저장 → `data/digest/YYYY-MM-DD.json`
7. Telegram 발송 (환경변수 `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` 설정된 경우)

### Scheduler
`scheduler.py`에 daily job 추가:
- 실행 시간: 매일 08:00 KST (Asia/Seoul)
- job id: `daily_digest`

---

## Frontend (Digest.jsx)

```
┌─────────────────────────────────────────┐
│  Daily Digest        2026-05-23  [↺ 새로고침]  │
├─────────────────────────────────────────┤
│  ⚠ 이상신호  TSLA -6.2%  NVDA +5.8%      │  ← 있을 때만 표시
├─────────────────────────────────────────┤
│  포트폴리오 요약                           │
│  총 평가액: $125,000   일간: -$1,020 (-0.8%) │
├─────────────────────────────────────────┤
│  종목별 등락                              │
│  AAPL  -1.3%  MSFT  +0.4%  LLY  -0.2%  │
│  (보유 → 관심종목 순, 등락폭 색상 구분)      │
├─────────────────────────────────────────┤
│  향후 7일 이벤트                          │
│  D-4  AAPL  실적발표                     │
│  D-6  LLY   배당락일                     │
└─────────────────────────────────────────┘
```

- 새로고침 버튼: `POST /api/digest/generate` 호출 후 최신 데이터 표시
- 기존 Portfolio·Reports 탭과 동일한 plain CSS 스타일
- 네비게이션에 "Digest" 탭 추가

---

## Environment Variables

| 변수 | 설명 | 필수 |
|------|------|------|
| `TELEGRAM_BOT_TOKEN` | Telegram 봇 토큰 | Telegram 발송 시 필수 |
| `TELEGRAM_CHAT_ID` | 발송 대상 chat ID | Telegram 발송 시 필수 |

미설정 시 Telegram 발송 없이 스냅샷 저장만 수행.

---

## Out of Scope

- 이상신호 임계값 UI 설정 (Settings 연동은 추후)
- 과거 Digest 히스토리 페이지
- 이메일 발송

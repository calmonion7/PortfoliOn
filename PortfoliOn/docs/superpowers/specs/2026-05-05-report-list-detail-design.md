# 리포트 목록/상세 분리 설계

**날짜:** 2026-05-05  
**상태:** 승인됨

## 배경

현재 Reports 페이지는 좌측 사이드바(티커+날짜 목록)와 우측 마크다운 뷰어로 구성되어 있다. 리포트에 필요한 구조화된 요약 데이터(평균목표가, 매수신호, Finviz, RSI 예상 타점)가 마크다운 안에만 존재하고 별도로 저장되지 않아 목록 테이블 표시가 불가능하다.

## 목표

- 우측 패널을 **목록화면**(요약 테이블)과 **상세화면**(마크다운 + RSI 타점 섹션)으로 분리
- RSI 예상 타점을 RSI 20/25/30/70/75/80 레벨로 확장
- 기존 리포트 호환 유지 (JSON 없으면 N/A 표시)

## 데이터 파일

### `backend/reports/{TICKER}/{date}.json` — 리포트 요약 (신규)

리포트 생성 시 마크다운과 함께 저장.

```json
{
  "ticker": "LLY",
  "name": "일라이 릴리",
  "date": "2026-05-05",
  "price": 890.0,
  "target_mean": 980.0,
  "buy": 15,
  "hold": 3,
  "sell": 1,
  "finviz_recom": 1.8,
  "daily_rsi": {
    "rsi": 45.2,
    "target_20": 800.0,
    "target_25": 830.0,
    "target_30": 860.0,
    "target_70": 940.0,
    "target_75": 960.0,
    "target_80": 975.0
  }
}
```

기존 마크다운만 존재하는 리포트는 `summary: null` 반환. 재생성 시 채워진다.

## 백엔드 설계

### indicators.py

`get_timeframe_rsi()` 반환값에 target_20, target_25, target_75, target_80 추가:

```python
result[tf] = {
    "rsi": current_rsi,
    "target_20": calc_rsi_target_price(df["Close"], rsi, 20.0),
    "target_25": calc_rsi_target_price(df["Close"], rsi, 25.0),
    "target_30": calc_rsi_target_price(df["Close"], rsi, 30.0),
    "target_70": calc_rsi_target_price(df["Close"], rsi, 70.0),
    "target_75": calc_rsi_target_price(df["Close"], rsi, 75.0),
    "target_80": calc_rsi_target_price(df["Close"], rsi, 80.0),
}
```

### report_generator.py

`generate_report()` 에서 마크다운 저장 후 JSON 요약 파일도 저장:

```python
summary = {
    "ticker": ticker,
    "name": stock.get("name", ticker),
    "date": today,
    "price": quote.get("price"),
    "target_mean": analyst.get("target_mean") or finviz.get("finviz_target"),
    "buy": analyst.get("buy", 0),
    "hold": analyst.get("hold", 0),
    "sell": analyst.get("sell", 0),
    "finviz_recom": finviz.get("finviz_recom"),
    "daily_rsi": timeframe_rsi.get("daily", {}),
}
json_path = output_dir / f"{today}.json"
json_path.write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")
```

`_section7()` 마크다운 테이블도 RSI 30→20/25/30, 70→70/75/80 컬럼으로 확장.

### report.py

`GET /api/report/list` — 각 티커 최신 날짜 JSON 읽어 summary 포함:

```json
{
  "LLY": {
    "category": "holdings",
    "dates": ["2026-05-05"],
    "summary": { ...JSON 내용... }
  }
}
```

JSON 없으면 `"summary": null`.

`GET /api/report/{ticker}/{date}` — `summary` 필드 추가:

```json
{
  "ticker": "LLY",
  "date": "2026-05-05",
  "content": "# ...(마크다운)...",
  "summary": { ...JSON 내용 or null... }
}
```

해당 날짜의 JSON 파일이 없으면 `summary: null`. RSI 테이블은 이 summary에서 렌더링.

## 프론트엔드 설계

### Reports.jsx 상태

| 상태 | 설명 |
|---|---|
| `view: 'list'` | 우측 패널 = 요약 테이블 |
| `view: 'detail'` | 우측 패널 = RSI 섹션 + 마크다운 |
| `selected: {ticker, date}` | 상세 진입 시 설정 |

### 목록화면 (`view === 'list'`)

좌측 사이드바의 activeTab(보유/관심)에 따라 필터된 티커를 테이블로 표시.

| 컬럼 | 데이터 소스 |
|---|---|
| 종목명 (티커) | `summary.name` / ticker |
| 현재가 | `summary.price` |
| 평균목표가 | `summary.target_mean` |
| Buy / Hold / Sell | `summary.buy/hold/sell` |
| Finviz | `summary.finviz_recom` |
| RSI↓20 / RSI↓25 / RSI↓30 | `summary.daily_rsi.target_20/25/30` |
| RSI↑70 / RSI↑75 / RSI↑80 | `summary.daily_rsi.target_70/75/80` |

행 클릭 → `setSelected({ticker, date: dates[0]})` + `setView('detail')`

사이드바의 날짜 클릭도 상세로 진입 가능 (기존 동작 유지).

### 상세화면 (`view === 'detail'`)

```
[← 목록으로]  {name} ({ticker}) — {date}

[ RSI 예상 타점 테이블 ]   ← summary.daily_rsi 있을 때만 표시
| 시간대 | 현재RSI | RSI20 | RSI25 | RSI30 | RSI70 | RSI75 | RSI80 |
| 일봉   |  45.2  | $800  | $830  | $860  | $940  | $960  | $975  |

[ MarkdownViewer — 기존 마크다운 전문 ]
```

- `← 목록으로` 클릭 → `setView('list')`
- RSI 테이블: `summary.daily_rsi` 없으면 미표시 (기존 리포트 호환)

## 변경 파일 목록

| 파일 | 변경 내용 |
|---|---|
| `backend/services/indicators.py` | `get_timeframe_rsi` — target_20/25/75/80 추가 |
| `backend/services/report_generator.py` | JSON 저장, `_section7` 컬럼 확장 |
| `backend/routers/report.py` | `/api/report/list` — summary 포함 |
| `frontend/src/pages/Reports.jsx` | 목록/상세 분리 |
| `backend/tests/test_indicators.py` | 새 target 필드 테스트 |
| `backend/tests/test_report_generator.py` | JSON 저장 테스트 |

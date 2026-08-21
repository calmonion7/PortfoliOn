# PortfoliOn — Claude Cowork 외부 API

> Claude Cowork가 종목 목록을 조회하고, AI가 생성한 분석 정보를 PortfoliOn 백엔드에 저장하기 위한 API입니다.

**Base URL:** `https://portfolion.taebro.com`  
**Content-Type:** `application/json`

---

## 워크플로우

### 종목 분석 (enrich)
```
1. GET /api/stocks               → 분석 대상 종목 목록 조회
2. (선택) GET /api/report/list   → 기존 리포트 날짜 확인
3. (선택) GET /api/report/{ticker}/{date_str}  → 기존 리포트 내용 참조
4. (AI가 각 종목 분석 수행)
5. PUT /api/stocks/enrich/batch  → 분석 결과 일괄 저장
   또는
   PUT /api/stocks/{ticker}/enrich  → 종목 1개 저장
6. POST /api/report/generate     → 전체 리포트 재생성 (enrich 후 반드시 실행)
```

### 수주잔고 분석 (backlog)
```
1. GET /api/report/backlog/pending   → { prompt, items } 조회
                                        (prompt = 추출 지침, items = 분석 대기 목록)
2. (AI가 prompt 규칙에 따라 각 item의 raw_text에서 수주잔고를 분기별로 추출)
   - raw_text 상단의 [재무 컨텍스트](매출·자산 등)로 단위/스케일(×100 오인)을 교차검증
3. PUT /api/report/{ticker}/backlog  → 분석 결과 저장 (ticker별 반복, amount≠null만)
```

### 애널리스트 리포트 발행 (analyst-reports)
```
0. (조건 확인) GET /api/analyst-reports  → **종목당 최신 1건**만 반환 (그 종목의 최신 발행일 판단용, task#222)
1. (선택) GET /api/report/{ticker}/{date_str}  → 최신 스냅샷 데이터 참조 (분석 재료)
2. (AI가 심층 분석 수행 — 투자의견·한줄 논지·적정주가 밴드·산정방식·투자포인트 2~3개·리스크 작성)
3. POST /api/analyst-reports/{ticker}  → 발행 (숫자 데이터 블록은 서버가 최신 스냅샷에서 자동 첨부)
   - 스냅샷 없는 종목은 409 거부 → 먼저 POST /api/report/generate?tickers={ticker} 후 재시도
   - 발행물 삭제는 admin 세션 전용(API key 불가) — Cowork/루틴은 삭제하지 않는다
```

### 주요기술 리포트 발행 (tech-reports)
```
0. (조건 확인) GET /api/tech-reports  → `reports[]`는 **기술당 1행**만 반환(대상 slug의 마지막 갱신일 판단용, 이력 없음 — ADR-0038). 미발행 종은 `reports[]`에 없고 같은 응답의 `topics[]`(등록 정본 15종)에 있다 — 둘의 차집합이 곧 미발행 목록이다
1. (AI가 웹 검색으로 그 기술 조사 — 상세 설명·기술난이도·주요업체(상장 여부 무관)·기술수준·격차·시장 규모/CAGR·난제·출처 + **핵심 포인트·진척 타임라인·업체 분류 축·기관별 시장 추정치·계보 비교축·확인할 지표**)
2. POST /api/tech-reports/{slug}  → 발행(갱신) — slug당 1행이라 재발행은 기존 행을 덮어쓴다(과거 판 없음). 단 **선택 5필드는 키를 생략하면 직전 판이 보존**된다(`key_points`·`milestones`·`variants`·`watch_items`·`composition`, 지우려면 명시적 `null`) — 아래 POST 절 「생략 vs 명시적 null」
   - 종목 발행물과 달리 **서버가 자동 첨부하는 숫자가 없다** — 통화·단위·점유율·척도까지 전부 이 본문에 조사해 채운다
   - 근거를 못 대는 수치는 그 필드를 생략한다(`null`도 `0`도 아님 — 틀린 값보다 없는 값이 낫다)
   - 대상 slug(`TECH_TOPICS` 등재분, 아래 Path Parameter) 밖 slug·통화·단위·`milestones[].status` enum 밖 값은 422로 거부된다
   - **요약 레이어는 산문이 아니라 구조 필드로 싣는다**(ADR-0034, 이후 개정 포함) — `key_points`(결론 카드)·`milestones`(연도별 진척)·`players[].category`(업체 분류 축)·`market.estimates`(기관별 시장 추정치)·`variants`(계보 비교축)·`watch_items`(확인할 지표)·`composition`(기술 해부 3축, ADR-0042). 채우지 않으면 화면에 반영되지 않으므로(대부분 그 섹션째 생략, `players[].category`는 표·점유율이 평면 렌더로 폴백) `description` 산문에만 쓰고 필드를 비우면 독자가 못 본다 — 단 **재발행에서는 생략이 「직전 판 유지」**를 뜻하는 필드가 있다(아래 POST 절)
   - **기관별 시장 추정치(`market.estimates`, 선택·최대 6건, ADR-0034 개정)**는 조사기관마다 다르게 추정한 시장 규모를 나란히 보여준다 — 배열 내 `currency`·`unit`·`year`는 전부 같아야 하고(다르면 422), 성장 곡선(`market.history`/`forecast`)이 채택한 기관은 `is_basis: true`로 표시(최대 1건, 2건 이상이면 422)
   - **계보 비교축(`variants`, 선택·최대 2축, ADR-0034 개정)**은 한 기술이 갈라지는 접근 방식을 이점·대가 쌍으로 나란히 보여준다 — 축마다 선택지(`options`)가 **최소 2개**(1개는 비교가 아니라 서술이므로 축을 생략하고 산문에 쓸 것, 2개 미만이면 422)
   - **확인할 지표(`watch_items`, 선택·최대 5건, ADR-0034 개정)**는 "앞으로 무엇이 관측되면 진척으로 인정하는가"를 미리 못 박는다 — 파일럿 준공·샘플 공개 같은 *일정 유지 신호*를 진척으로 오독하지 않도록 항목마다 `not_signal`(이건 신호가 아니다)을 본문과 분리해 적을 것
```

---

## 인증

외부 API(Claude Cowork)는 API Key 방식으로 인증합니다.

모든 요청에 아래 헤더를 포함합니다.

```
X-API-Key: {COWORK_API_KEY}
```

`COWORK_API_KEY`는 서버의 `backend/.env.docker`에 설정된 값입니다.

**Error `401`** — API Key 누락 또는 불일치

---

## 엔드포인트

### `GET /api/stocks`

전체 유저의 보유종목과 관심종목 목록을 반환합니다 (전 유저 합산, ticker 중복 제거).

**Auth:** `X-API-Key` 헤더

**Response `200`**
```json
[
  { "ticker": "LLY",    "name": "일라이 릴리",      "type": "holding",   "market": "US", "enriched_at": "2026-07-20T01:00:00" },
  { "ticker": "012450", "name": "한화에어로스페이스", "type": "watchlist", "market": "KR", "enriched_at": null }
]
```

| 필드 | 타입 | 설명 |
|------|------|------|
| `ticker` | string | 종목 코드 |
| `name` | string | 종목명 (없으면 ticker 값) |
| `type` | string | `"holding"` (보유종목) \| `"watchlist"` (관심종목) |
| `market` | string | `"US"` \| `"KR"` |
| `enriched_at` | string\|null | 마지막 AI 분석(enrich) 시각 — `null`이면 미분석. **enrich 대상 선별 기준**: null 우선, 그다음 오래된 순 |
| `analyst_target` | boolean | 애널리스트 리포트 **자동 발행 대상** 여부(admin 지정 opt-in) — `true`인 종목만 자동 발행 후보, 전부 `false`면 발행 단계 스킵 |

---

### `GET /api/report/list`

생성된 리포트 목록과 날짜를 조회합니다. 기존 리포트가 있으면 참조해 중복 분석을 피할 수 있습니다.

**Auth:** `X-API-Key` 헤더

**Response `200`**
```json
{
  "stocks": {
    "LLY": {
      "dates": ["2026-05-20", "2026-05-01"],
      "category": "holdings",
      "market": "US",
      "is_etf": false,
      "summary": {
        "name": "Eli Lilly and Company",
        "price": 823.45,
        "sector": "Healthcare",
        "target_mean": 950.0,
        "buy": 18,
        "hold": 4,
        "sell": 0,
        "daily_rsi": { "rsi": 58.3 },
        "weekly_rsi": { "rsi": 62.1 },
        "monthly_rsi": null,
        "volume_profile": { "poc": 810.0 }
      }
    },
    "AVAV": {
      "dates": ["2026-05-15"],
      "category": "watchlist",
      "market": "US",
      "is_etf": false,
      "summary": null
    }
  },
  "last_scheduled_date": { "KR": "2026-06-12", "US": "2026-06-15" }
}
```

> ⚠️ `last_scheduled_date`는 단일 문자열(`"2026-05-20"`)에서 시장별 객체 `{ "KR": ..., "US": ... }`로 형태가 변경되었습니다. 종목의 `market`에 맞는 키를 골라 기대 리포트 날짜를 비교하세요(파싱 영향).
> 종목 데이터는 `response["stocks"]` 아래에 있습니다. `summary`는 리포트가 없으면 `null`.
> `is_etf`는 ETF 여부(`tickers.is_etf`). ETF는 애널리스트 의견이 없어 관심 "⚠ 경고" 분류에서 제외됩니다.

---

### `GET /api/report/{ticker}/{date_str}`

특정 날짜의 리포트 스냅샷 데이터를 조회합니다. 기존 분석을 참조할 때 사용합니다.

**Auth:** `X-API-Key` 헤더

**Path Parameters**
- `ticker` — 종목 코드 (예: `LLY`)
- `date_str` — 날짜 (`YYYY-MM-DD`, `GET /api/report/list` 의 `dates` 값)

**Response `200`**
```json
{
  "ticker": "LLY",
  "date": "2026-05-20",
  "summary": {
    "name": "Eli Lilly and Company",
    "price": 823.45,
    "sector": "Healthcare",
    "industry": "Drug Manufacturers",
    "target_mean": 950.0,
    "target_high": 1100.0,
    "target_low": 750.0,
    "buy": 18,
    "hold": 4,
    "sell": 0,
    "moat": "특허 포트폴리오와 제조 규모의 경제",
    "growth_plan": "GLP-2 파이프라인 확장",
    "risks": "GLP-1 경쟁 심화, 약가 규제 리스크"
  }
}
```

> `summary`는 DB에 저장된 스냅샷 전체 데이터입니다. `content`(마크다운) 필드는 없습니다.

**Error `404`** — 해당 날짜의 리포트 없음

---

### `PUT /api/stocks/{ticker}/enrich`

단일 종목의 AI 분석 정보를 저장합니다. 포함된 필드만 덮어쓰고 나머지는 기존 값을 유지합니다.

**Auth:** `X-API-Key` 헤더

**Path Parameter:** `ticker` — 종목 코드 (예: `LLY`)

**Request Body**
```json
{
  "moat": {
    "rating": "wide",
    "rating_source": "Morningstar",
    "summary": "특허·브랜드·R&D 인프라 기반의 최상급 경쟁 우위",
    "factors": [
      { "title": "독점적 특허 기반의 가격 결정력", "description": "티르제파티드 기반 제품은 2036년까지 특허 보호." },
      { "title": "고객 전환 비용 및 브랜드 충성도", "description": "장기 투약 특성으로 이탈률이 매우 낮음." }
    ]
  },
  "growth_plan": {
    "strategy": "비만 시장 독점 확대 + 차세대 치료 영역 선점",
    "initiatives": [
      { "title": "경구용 비만 치료제 파운다요 FDA 승인", "description": "2026-04 세계 최초 경구용 비만 치료제 FDA 승인.", "status": "launched", "timeline": "2026-04" },
      { "title": "레타트루티드 임상 3상", "description": "삼중 작용제, 압도적 임상 데이터 확보 중.", "label": "임상3상", "status": "phase3", "timeline": null }
    ]
  },
  "risks": {
    "factors": [
      { "category": "경쟁", "title": "후발 주자 맹추격", "description": "노보 노디스크·암젠 등이 더 저렴한 비만약 개발 중.", "severity": "high" },
      { "category": "가격", "title": "약가 인하 압박", "description": "보험·정부 협상으로 실질 단가 하락. 최근 분기 미국 -7%.", "severity": "medium" }
    ]
  },
  "recent_disclosures": {
    "period": "2026Q1",
    "headline": "1분기 어닝 서프라이즈 + 연간 가이던스 대폭 상향",
    "metrics": [
      { "label": "매출액", "actual": "$19.8B", "consensus": "$17.6B", "vs_consensus": "+12.5%", "note": "YoY +56%" },
      { "label": "Non-GAAP EPS", "actual": "$8.55", "consensus": "$6.97", "vs_consensus": "+22.6%", "note": null }
    ],
    "events": [
      { "title": "연간 매출 가이던스 상향", "description": "820~850억 달러로 20억 달러 상향.", "impact": "positive" }
    ],
    "price_impact": "실적 발표 당일 +6~10% 급등",
    "one_liner": "비만 치료제 독점 해자로 매출 56% 폭증. 약가 인하·후발 추격은 모니터링 필요."
  },
  "insights": {
    "stance": "관망",
    "entry": [
      "20일 고점 대비 -10% 이상 눌림 + 분기 가이던스 상향 확인 시 분할 매수",
      "약가 협상 불확실성 해소 뉴스 확인 시"
    ],
    "avoid": [
      "경쟁사 동등 효능 비만약 FDA 승인 임박",
      "PER 40배 이상 과열 구간"
    ],
    "one_liner": "독점 해자는 견고하나 밸류 부담. 눌림목에서 분할 진입, 경쟁 승인 이벤트 전 비중 확대는 자제."
  },
  "key_resource": {
    "resource": "인력 (Human Capital)",
    "thesis": "IT 서비스업은 인력이 곧 생산설비 — 우수 인력 확보·유지가 경쟁력의 핵심",
    "metrics": [
      { "label": "직원수",       "unit": "명",   "series": [{"period":"2025Q2","value":1180}, {"period":"2025Q3","value":1200}, {"period":"2025Q4","value":1220}, {"period":"2026Q1","value":1240}] },
      { "label": "1인당 매출",    "unit": "억원", "series": [{"period":"2025Q2","value":2.2}, {"period":"2025Q3","value":2.3}, {"period":"2025Q4","value":2.4}, {"period":"2026Q1","value":2.5}] },
      { "label": "1인당 영업이익", "unit": "억원", "series": [{"period":"2025Q2","value":0.4}, {"period":"2025Q3","value":0.45}, {"period":"2025Q4","value":0.5}, {"period":"2026Q1","value":0.55}] }
    ],
    "drivers": [
      { "title": "스톡옵션·RSU", "description": "핵심인력 리텐션용 주식보상 규모/조건" },
      { "title": "이직률",       "description": "핵심인력 연간 이직률 및 추세" }
    ],
    "one_liner": "1인당 생산성은 상승세이나 이직률 관리가 관건"
  },
  "competitor_edge": {
    "axis": "임상 파이프라인 폭",
    "one_liner": "경쟁사 대비 적응증 커버리지가 넓고 임상 3상 비중이 높음",
    "entries": [
      { "ticker": "NVO", "name": "노보 노디스크", "edge": "GLP-1 선발주자로 처방 점유율 우위, 파이프라인은 단일 적응증에 집중", "position": "동등" },
      { "ticker": "AMGN", "edge": "비만 치료제 후발주자, 아직 임상 2상 단계로 상업화까지 격차 존재", "position": "우위" }
    ]
  },
  "market_outlook": {
    "market_name": "글로벌 비만치료제 시장",
    "size_current": { "value": 24, "unit": "십억달러", "year": 2025 },
    "size_forecast": { "value": 100, "unit": "십억달러", "year": 2030 },
    "cagr_pct": 33.0,
    "company_share_pct": 55.0,
    "position": "1위",
    "sources": ["Goldman Sachs Research (2026-02)", "회사 IR 발표자료"],
    "one_liner": "비만치료제 시장은 연 33% 고성장 중이며 당사가 점유율 1위",
    "segments": [
      { "name": "당뇨치료제", "period": "2025", "revenue_share_pct": 62.0, "prev_period": "2024", "prev_revenue_share_pct": 68.0,
        "market": { "size": 55, "unit": "십억달러", "year": 2025, "size_forecast": 80, "forecast_year": 2030, "cagr_pct": 7.8 },
        "share_pct": 40.0, "sources": ["IQVIA (2026-01)"] },
      { "name": "비만치료제", "period": "2025", "revenue_share_pct": 38.0, "prev_period": "2024", "prev_revenue_share_pct": 32.0,
        "market": { "size": 24, "unit": "십억달러", "year": 2025, "size_forecast": 100, "forecast_year": 2030, "cagr_pct": 33.0 },
        "share_pct": 55.0, "share_pct_forecast": 60.0, "note": "경구용 치료제 승인 이후 처방 확대 국면", "sources": ["Goldman Sachs Research (2026-02)"] }
    ]
  },
  "competitors": ["NVO", "AMGN"]
}
```

**`moat` 객체 필드**

| 필드 | 타입 | 설명 |
|------|------|------|
| `rating` | string | `"wide"` \| `"narrow"` \| `"none"` |
| `rating_source` | string | 출처 (예: `"Morningstar"`) |
| `summary` | string | 한 줄 요약 |
| `factors` | `{title, description}[]` | 해자 구성 요소 목록 |

**`growth_plan` 객체 필드**

| 필드 | 타입 | 설명 |
|------|------|------|
| `strategy` | string | 전략 개요 |
| `initiatives` | `{title, description, label, status, timeline}[]` | 성장 이니셔티브 목록 |
| `initiatives[].label` | string\|null | 칩에 표시할 자유문구 단계명. **종목 산업에 맞는** 짧은 단계명 (≤~12자, 아래 *label 작성 규칙* 참조). 있으면 `status` 폴백보다 우선 표시 |
| `initiatives[].status` | string | 범용 진행 단계 (칩 색상 결정). `"launched"`(출시) \| `"phase3"`(3단계) \| `"phase2"`(2단계) \| `"announced"`(발표) \| `"completed"`(완료). 칩 문구는 `label`이 있으면 그것을, 없으면 이 단계명을 표시 |
| `initiatives[].timeline` | string\|null | 타임라인 (예: `"2026-04"`) |

> **`label` 작성 규칙 (종목 산업 적합)** — `label`은 이니셔티브의 실제 진행 단계를 **그 종목이 속한 산업의 용어로** 표현합니다. 다른 산업의 단계명을 빌려 쓰지 마세요(예: 반도체 종목에 `"임상3상"`은 부적합). `status`는 칩 *색상*만 정하니 그대로 두고, `label`로 그 산업의 단계 문구를 답니다. 적절한 산업 용어가 떠오르지 않으면 `label`을 생략해 `status` 폴백(예: `"3단계"`)에 맡깁니다.
>
> | 산업 | `label` 예시 어휘 |
> |------|------------------|
> | 제약·바이오 | 전임상, 임상1/2/3상, 허가신청, 출시 |
> | 반도체·하드웨어 | 샘플, 양산 준비, 양산 램프업, 수율 개선, 공급 확대, 팹 가동 |
> | 소프트웨어·플랫폼 | 베타, 정식출시(GA), 확장, 구독 전환 |
> | 자동차·EV | 파일럿, 양산, 증설, 신모델 출시 |
> | 에너지·인프라·건설 | 수주, 착공, 증설, 준공·가동 |
>
> 표는 예시일 뿐입니다 — 실제 이니셔티브 맥락에 맞는 짧은(≤~12자) 산업 단계명을 쓰면 됩니다.

**`risks` 객체 필드**

| 필드 | 타입 | 설명 |
|------|------|------|
| `factors` | `{category, title, description, severity}[]` | 리스크 목록 |
| `factors[].category` | string | 분류 (예: `"경쟁"`, `"가격"`, `"공급"`, `"법적"`) |
| `factors[].severity` | string | `"high"` \| `"medium"` \| `"low"` |

**`recent_disclosures` 객체 필드**

| 필드 | 타입 | 설명 |
|------|------|------|
| `period` | string | 기준 분기 (예: `"2026Q1"`) |
| `headline` | string | 핵심 이벤트 요약 |
| `metrics` | `{label, actual, consensus, vs_consensus, note}[]` | 실적 지표 테이블 |
| `metrics[].vs_consensus` | string | `+/-XX.X%` 형식 (색상 분기용) |
| `events` | `{title, description, impact}[]` | 주요 이벤트 목록 |
| `events[].impact` | string | `"positive"` \| `"negative"` \| `"neutral"` |
| `price_impact` | string | 주가 반응 요약 |
| `one_liner` | string | 종합 한 줄 요약 |

**`insights` 객체 필드** — 전문가 관점의 권고성 진입/회피 가이드

| 필드 | 타입 | 설명 |
|------|------|------|
| `stance` | string | `"진입"` \| `"관망"` \| `"회피"` — 현재 시점 종합 판단 |
| `entry` | string\|string[] | 진입(매수) 권고 조건. "전문가는 이럴 때 진입한다" 관점 |
| `avoid` | string\|string[] | 회피(관망/매도) 권고 조건. "이럴 때는 피하라" 관점 |
| `one_liner` | string | 한 줄 종합 권고 |

> `insights`는 가격·실적·이벤트를 종합해 "지금 어떻게 대응할지"를 권고하는 필드입니다. 단정적 매매 신호가 아니라 **조건부 가이드**로 작성하세요 (예: `"~ 확인 시 분할 매수"`). `entry`·`avoid`는 문자열 또는 문자열 배열 모두 가능합니다.

**`key_resource` 객체 필드** — 업종별 핵심 자원(인력/생산능력/파이프라인 등)과 분기별 지표 추이

| 필드 | 타입 | 설명 |
|------|------|------|
| `resource` | string | 핵심자원 라벨 (예: `"인력 (Human Capital)"`) |
| `thesis` | string | 왜 이 자원이 경쟁력인지 한줄 논지 |
| `metrics` | `{label, unit, series}[]` | 분기별 지표 추이 목록 |
| `metrics[].label` | string | 지표명 (예: `"직원수"`, `"1인당 매출"`) |
| `metrics[].unit` | string | 단위 (예: `"명"`, `"억원"`) |
| `metrics[].series` | `{period, value}[]` | 분기별 값. `period` 형식 `YYYYQn`(예: `"2025Q1"`). **최근 4분기(1년치) 이상** 채우는 것이 기본 — 확보 가능한 분기가 그보다 적을 때만 있는 만큼 |
| `drivers` | `{title, description}[]` | 자원 유지 동력(리텐션 인센티브) 목록 |
| `one_liner` | string | 한 줄 종합 요약 |

> 업종 판단은 서버에 `sector`가 없어 Cowork가 스스로 종목 맥락으로 판단합니다. 아래 업종별 핵심 자원 표를 참고하되, 표는 예시일 뿐 종목 실제 맥락이 우선입니다. 수치가 불확실하면 그 지표를 생략하세요(**틀린 값 < 누락**).
>
> | 산업 | 핵심 자원 | 대표 지표 | 경쟁축(`competitor_edge.axis`) | 시장 전망 조사 지침(`market_outlook`) |
> |------|-----------|-----------|-------------------------------|----------------------------------------|
> | 제약·바이오 | R&D 파이프라인 | 파이프라인 단계별 개수, R&D 집약도 | 파이프라인 단계·적응증 커버리지 | 해당 적응증(치료영역) 시장규모 — EvaluatePharma·GlobalData 등 |
> | 반도체·하드웨어 | 생산능력 | 가동률, CapEx | 공정 미세화(nm)·수율·원가 | 세그먼트(메모리/파운드리 등)별 시장 — Gartner·TrendForce·IDC |
> | 소프트웨어·플랫폼 (IT서비스·컨설팅 포함) | 인력 | 직원수, 1인당 매출, 1인당 영업이익 (완전 명세는 아래) | 제품 기능력·고객 락인(전환비용) | TAM/SAM 추정 — Gartner·IDC, 회사 IR 자료 |
> | 자동차·EV | 생산능력 | 생산대수, 공장 가동률 | 원가경쟁력·배터리/자율주행 기술 | 지역별 EV 침투율·판매 전망 — IEA, BloombergNEF |
> | 에너지·인프라·건설 | 수주잔고 | 수주잔고, 신규수주 — 단 수주잔고 수치 자체는 별도 `PUT /api/report/{ticker}/backlog` API가 자동 수집하므로 여기선 해석 중심으로 작성 | 수주 단가경쟁력·기술인증/실적 | 국가별 인프라 투자계획 — 정부 발표, 업계 리포트 |
> | 금융 | 자기자본 | NIM(순이자마진), ROE — drivers: 자본비율(CET1 등), 배당여력 | 자본비율·조달비용 | 금리 사이클·대출 성장률 전망 — 한국은행·Fed 자료 |
> | 소비재·유통 | 브랜드·매장망 | 동일매장매출 성장률(SSSG), 재고회전율 | 브랜드 파워·유통망 커버리지 | 카테고리별 소비시장 성장률 — Euromonitor, 통계청 |
> | 미디어·게임 | IP | 주요 IP 매출 비중, 신규 IP 파이프라인 | IP 포트폴리오 강도·플랫폼 장악력 | 장르/플랫폼별 시장규모 — Newzoo, PwC |
> | 통신·유틸리티 | 네트워크/설비 자산 | ARPU, 설비투자(CapEx) 효율 | 커버리지·주파수/설비 자원 | 차세대 통신 인프라 투자 전망 — 정부 통신정책, 업계 보고서 |
>
> **소프트웨어·플랫폼(및 IT서비스·컨설팅) 인력 완전 명세** — `metrics`에 **직원수(명)·1인당 매출·1인당 영업이익 3개 지표를 모두** 채웁니다(하나라도 빼지 말 것 — 단 특정 분기 값이 확인 불가하면 그 분기만 생략). 각 지표의 series는 **최근 4분기(1년치) 이상**. 산식: `1인당 X = 그 분기 X ÷ 그 분기(말) 직원수` (직원수 출처: KR=분기보고서 "직원 등의 현황", US=10-K/10-Q·proxy statement; 직원수가 연 1회만 공시되면 같은 값을 해당 연도 분기에 이월 사용 가능). 단위는 종목 통화에 맞는 자유 문자열(KR=`"억원"`, US=`"천USD"`·`"$M"` 등 — 화면에 그대로 표시). `drivers`에는 인력을 붙잡는 유지 동력 — 주식보상(RSU·스톡옵션) 규모, 이직률 추세, 보상 경쟁력 등을 담습니다.

**`competitor_edge` 객체 필드** — 경쟁사(자사 포함) 대비 사업 경쟁력이 그 업종 핵심 경쟁축에서 어디에 서 있는지의 비교

| 필드 | 타입 | 설명 |
|------|------|------|
| `axis` | string | 업종에 맞는 비교축 라벨 (예: `"원가경쟁력"`, `"임상 파이프라인 폭"`). 위 업종별 표의 "경쟁축" 열을 참고하되 예시일 뿐 실제 종목 맥락이 우선 |
| `one_liner` | string | 한 줄 종합 요약 |
| `entries` | `{ticker, name, edge, position}[]` | 경쟁사별 비교 목록 |
| `entries[].ticker` | string | 경쟁사 티커. 리포트의 `competitors`(경쟁사 목록)·`summary.competitors_data`와 티커 키로 조인되어 함께 표시됨 |
| `entries[].name` | string\|null | 경쟁사명 (생략 시 `competitors_data`에서 보완) |
| `entries[].edge` | string | 그 경쟁사 대비 비교축 상에서의 서술 |
| `entries[].position` | string\|null | 상대적 위치 (예: `"우위"`\|`"동등"`\|`"열위"`) |

> **Peer 할인/할증과 혼동 금지** — Peer 할인/할증은 `competitors_data`의 PER/PBR 등 밸류에이션 멀티플로 코드가 자동 계산하는 상대적 "싼가/비싼가" 판정입니다(리포트 경쟁사 섹션 상단 칩). `competitor_edge`는 그와 무관하게 Cowork가 서술하는 사업 경쟁력의 "강한가/약한가" 비교입니다. "기술비교"류 축이 연상되지만 비-기술 업종에선 축이 기술이 아닐 수 있습니다(축 선택은 작성자 몫).

**`market_outlook` 객체 필드** — 회사가 속한 전방시장의 규모·성장 전망 (Cowork가 조사·기입)

| 필드 | 타입 | 설명 |
|------|------|------|
| `market_name` | string | 시장 정의 (예: `"글로벌 HBM 시장"`) |
| `size_current` | `{value, unit, year}` | 현재 시장 규모 |
| `size_forecast` | `{value, unit, year}` | 전망 시장 규모 |
| `cagr_pct` | number | 연평균 성장률(%) |
| `company_share_pct` | number\|null | 회사의 해당 시장 점유율(%) |
| `position` | string\|null | 시장 내 위치 (예: `"1위"`) |
| `sources` | string[] | **필수 — 출처 없는 값은 저장하지 말 것.** 근거 출처 목록 (예: `["TrendForce (2026-03)", "회사 IR 자료"]`) |
| `one_liner` | string | 한 줄 종합 요약 |
| `segments` | `{name,period,revenue_share_pct,...}[]` | 회사 단위 전망 아래 **부문별** 매출비중·시장·점유율 분해 (「사업부문 시장 분석」). 상세는 바로 아래 참조 |

> **`growth_plan`과 혼동 금지** — `growth_plan`은 *회사의* 전략·이니셔티브이고, `market_outlook`은 *시장 자체*의 규모·성장입니다. 시장 규모/성장률의 무료 자동 수집 소스가 없어 Cowork 조사·기입이 유일한 수단이므로, 수치가 불확실하면 `market_outlook` 자체를 생략하세요(**틀린 값 < 누락**) — `sources`가 비어있는 값은 저장하지 마세요.

**`market_outlook.segments[]` 필드** — 사업부문별 매출 비중·시장 규모·자사 점유율 (「사업부문 시장 분석」). **수주잔고의 「사업부문 분해」(`PUT /api/report/{ticker}/backlog`의 `segments`, `{sector,entity,amount}[]`)와는 별개 개념** — 그건 수주잔고를 부문·법인으로 나눈 것이고, 이건 *매출과 시장*을 부문으로 나눈 것입니다.

| 필드 | 타입 | 필수 | 설명 |
|------|------|------|------|
| `name` | string | ✅ | 부문명 — **사업보고서/10-K 부문 표기 그대로** |
| `period` | string | ✅ | 당기 매출 비중의 기준 기간. **`financials_annual`의 `period`와 문자열이 정확히 일치해야** 서버가 부문 매출 금액을 환산합니다 (예: `"2024"`) |
| `revenue_share_pct` | number | ✅ | 당기 매출 비중(%) |
| `prev_period` | string | ❌ | 전기 기준 기간 |
| `prev_revenue_share_pct` | number | ❌ | 전기 매출 비중(%). 없으면 매출 증감·비중 변화(%p)가 표시되지 않습니다 |
| `market` | object | ❌ | 그 부문이 속한 시장 — `{size, unit, year, size_forecast, forecast_year, cagr_pct}` |
| `market.size` | number | ❌ | 현재 시장 규모 |
| `market.unit` | string | ❌ | 규모 단위 (예: `"억달러"`) |
| `market.year` | number | ❌ | 규모 기준 연도 |
| `market.size_forecast` | number | ❌ | 전망 시장 규모 |
| `market.forecast_year` | number | ❌ | 전망 기준 연도 |
| `market.cagr_pct` | number | ❌ | 그 시장의 연평균 성장률(%) |
| `share_pct` | number | ❌ | 그 시장에서 자사 점유율(%) |
| `share_pct_forecast` | number | ❌ | 미래 시점 점유율 전망(%). 있으면 화면 시나리오 라벨이 "회사 전망"(없으면 "점유율 유지 가정")으로 표시 |
| `note` | string | ❌ | 서술 (예: 수요 배경) |
| `sources` | string[] | ❌ | 근거 출처 목록 |

> **기입 지침**
> - 부문명은 **사업보고서/10-K 부문 표기 그대로** 쓰세요(임의로 재명명하지 마세요).
> - **최대 5개 부문**만 기입하고, 그 이상은 '기타'로 묶거나 생략하세요.
> - 비중은 **매출 기준**입니다(자산·이익 기준이 아닙니다).
> - `period`를 반드시 명시하세요 — `financials_annual`의 그 기간과 **문자열이 정확히 일치**해야 서버가 부문 매출 금액을 환산합니다. 불일치하면 그 부문은 비중·시장 수치만 남고 금액은 표시되지 않습니다.
> - **금액은 절대 쓰지 마세요** — %만 기입하면 서버가 금액(부문 매출·시장 기회)을 환산합니다(수주잔고 단위 오저장 계열의 함정을 원천 차단하기 위함).
> - 그 부문의 근거를 확인할 수 없으면 그 부문 자체를 생략하세요(**틀린 값 < 누락**).

> 모든 객체 필드는 선택적입니다. 최소 1개 이상의 최상위 필드를 포함해야 합니다.
>
> **레거시 호환:** 기존 string 값도 그대로 저장/표시됩니다.

**Response `200`**
```json
{
  "ticker": "LLY",
  "updated": ["moat", "growth_plan", "risks", "recent_disclosures", "insights", "competitors"]
}
```

**Errors**

| 상태 | 설명 |
|------|------|
| `400` | 업데이트할 필드가 없음 |
| `401` | 인증 필요 |
| `404` | 보유종목 또는 관심종목에 없는 ticker |

---

### `PUT /api/stocks/enrich/batch`

여러 종목의 AI 분석 정보를 한 번에 저장합니다.

**Auth:** `X-API-Key` 헤더

**Request Body** — 종목 배열 (`ticker` 필수, 나머지 선택. 각 필드 스키마는 단건 enrich와 동일)
```json
[
  {
    "ticker": "LLY",
    "moat": { "rating": "wide", "summary": "특허·R&D 인프라 기반 최상급 경쟁 우위", "factors": [...] },
    "growth_plan": { "strategy": "비만 시장 독점 확대", "initiatives": [...] },
    "risks": { "factors": [...] },
    "recent_disclosures": { "period": "2026Q1", "headline": "어닝 서프라이즈", "metrics": [...], "events": [...], "one_liner": "..." },
    "insights": { "stance": "관망", "entry": "눌림목 + 가이던스 상향 확인 시 분할 매수", "avoid": "경쟁 비만약 FDA 승인 임박", "one_liner": "독점 해자 견고하나 밸류 부담, 눌림 진입 권장" },
    "key_resource": { "resource": "R&D 파이프라인", "thesis": "특허 보호 파이프라인 폭이 경쟁력", "metrics": [...], "one_liner": "..." },
    "competitor_edge": { "axis": "임상 파이프라인 폭", "entries": [{ "ticker": "NVO", "edge": "GLP-1 선발주자로 처방 점유율 우위", "position": "동등" }], "one_liner": "..." },
    "market_outlook": { "market_name": "글로벌 비만치료제 시장", "size_current": {"value": 24, "unit": "십억달러", "year": 2025}, "size_forecast": {"value": 100, "unit": "십억달러", "year": 2030}, "cagr_pct": 33.0, "sources": ["Goldman Sachs Research (2026-02)"], "one_liner": "..." },
    "competitors": ["NVO", "AZN"]
  },
  {
    "ticker": "AVAV",
    "moat": { "rating": "narrow", "summary": "방위산업 규제 장벽과 운용 노하우", "factors": [...] },
    "risks": { "factors": [...] }
  }
]
```

**Response `200`**
```json
{
  "updated": ["LLY", "AVAV"],
  "not_found": ["NVDA"]
}
```

| 필드 | 타입 | 설명 |
|------|------|------|
| `updated` | string[] | 정상 저장된 ticker 목록 |
| `not_found` | string[] | 전역 tickers 테이블에 없거나 업데이트 필드가 없어서 건너뛴 ticker 목록 |

**Errors**

| 상태 | 설명 |
|------|------|
| `400` | 배열이 비어 있음 |
| `401` | 인증 필요 |

---

### `GET /api/report/backlog/pending`

DART에서 수주 섹션을 가져왔으나 코드 자동 파싱(검산)에 실패한 항목들과, 이를 분석할 **추출 지침(prompt)**을 함께 반환합니다. Claude Cowork가 `prompt` 규칙대로 각 항목의 `raw_text`에서 수치를 추출한 뒤 PUT으로 저장합니다.

**Auth:** `X-API-Key` 헤더

**Response `200`**
```json
{
  "prompt": "다음은 한 종목 정기보고서에서 추출한 [재무 컨텍스트]와 [수주 원문]입니다 ...",
  "items": [
    {
      "ticker": "012450",
      "quarter": "2025Q4",
      "raw_text": "[재무 컨텍스트] (단위: 억원, 연결재무제표)\n  매출액: 당기=267029 전기=112401\n  자산총계: 당기=539536 ...\n\n회사 | 사업 | ... | 수주잔고\n합 계 | ... | 116,800,729",
      "unit": "백만원"
    }
  ]
}
```

| 필드 | 타입 | 설명 |
|------|------|------|
| `prompt` | string | 수주잔고 추출 지침 (단위 정규화·외화·다중엔티티·공사진행·"틀린 값<누락" 규칙) |
| `items` | array | 분석 대기 항목 목록 (아래 필드) |
| `items[].ticker` | string | 종목 코드 (KR 6자리) |
| `items[].quarter` | string | 분기 (예: `"2025Q4"`, 형식 `YYYYQn`) |
| `items[].raw_text` | string | `[재무 컨텍스트]`(매출·자산 등 핵심계정, 억원) + `[수주 원문]`(표 구조 보존) 결합 텍스트 |
| `items[].unit` | string | 수주 원문 표의 원래 단위 (`"백만원"`·`"억원"`·`"조원"` 등). 외화 표 캡션 매치 시 `"기타"` (USD천·백만달러 등), 캡션 없으면 `"억원"` 기본값. **최종 저장은 prompt 지침대로 억원으로 정규화** |

> `items`가 빈 배열이면 분석 대기 항목 없음. `raw_text`의 `[재무 컨텍스트]`는 수주잔고 단위/자릿수(×100 오인) 교차검증용 참고치이며 수주잔고 값 자체는 아닙니다.

---

### `PUT /api/report/{ticker}/backlog`

Claude Cowork가 `raw_text`에서 추출한 수주잔고 수치를 저장합니다. 해당 ticker·quarter의 `source`가 `'pending'` 또는 `'llm'`인 행만 갱신됩니다(`'dart'` 자동추출 행은 보호 — 아래 참고).

> **다중엔티티 연결 종목(예: 한화에어로 012450)은 코드가 자동으로 `source='dart'` + `segments`를 채우므로 pending에 뜨지 않습니다.** 아래 `segments` 예시는 **형식 참고용**이며, Cowork의 수동 `segments` PUT은 자동추출이 안 된 잔여 케이스(검산 실패·비표준 표 등)에 사용합니다.

**Auth:** `X-API-Key` 헤더 또는 admin 로그인(task#290 — 임의 인증 사용자가 전역 공유 수주잔고를 덮어쓰던 게이팅 공백을 닫으며 admin으로 좁혔다)

**Path Parameter:** `ticker` — 종목 코드 (예: `012450`)

**Request Body** — 분기별 수치 배열
```json
[
  { "quarter": "2024Q3", "amount": 85432.0 },
  {
    "quarter": "2025Q4",
    "amount": 1168007.29,
    "segments": [
      { "sector": "항공", "entity": "한화에어로스페이스㈜", "amount": 323995.45 },
      { "sector": "방산", "entity": "한화에어로스페이스㈜", "amount": 372199.02 },
      { "sector": "해양", "entity": "한화오션㈜",          "amount": 344950.64 }
    ]
  }
]
```

| 필드 | 타입 | 필수 | 설명 |
|------|------|------|------|
| `quarter` | string | ✅ | 분기 (`YYYY Q[1-4]`) |
| `amount` | number | ✅ | 수주잔고 총액 (억원). segments가 있으면 그 합과 일치시킬 것 |
| `segments` | `{sector, entity, amount}[]` | ⬜ | 사업부문>법인별 분해(억원). 다중부문/연결 종목에서 차트가 부문별 누적 막대로 표시. 미제공 시 기존 분해 유지(COALESCE) |

> `source`가 `'pending'` 또는 `'llm'`인 행만 갱신됩니다(`'dart'` 자동추출 행은 보호). `segments`를 포함하면 같은 ticker·quarter를 다시 PUT해 분해를 수정할 수 있습니다.

**Response `200`**
```json
{ "ticker": "012450", "saved": 2 }
```

**Errors**

| 상태 | 설명 |
|------|------|
| `401` | 인증 필요 |

---

### `POST /api/report/generate`

enrich 완료 후 전체 종목의 리포트 스냅샷을 재생성합니다. 백그라운드에서 실행되며 즉시 202를 반환합니다.

**Auth:** `X-API-Key` 헤더

**Query Parameters** (모두 선택)

| 파라미터 | 설명 |
|----------|------|
| `tickers` | 쉼표 구분 티커 목록 (생략 시 전체 종목) |
| `date` | 스냅샷 날짜 `YYYY-MM-DD` (생략 시 오늘) |

**Response `202`**
```json
{ "message": "Generating reports for 92 stock(s)" }
```

> 생성 완료까지 수 분 소요. 완료 여부는 `GET /api/report/progress`로 확인 가능.

---

### `POST /api/analyst-reports/{ticker}`

발행물 누적형 애널리스트 리포트 발행 (ADR-0027). 판단·서사는 요청 본문으로 제출하고, 숫자 데이터 블록(발행 시점 시세·forward 추정·피어 멀티플·PER 밴드·컨센서스 목표가 + **컨센서스 근거** — 마트 집계 분포·증권사별 최신 의견, task#260)은 **서버가 최신 스냅샷·컨센서스 저장소에서 자동 첨부**한다 — 본문에 숫자 데이터를 넣지 말 것(요청 스키마 무변). 문서는 발행 후 불변 — 같은 날 재발행만 그날 판을 교체하고, 다른 날 발행은 새 판으로 누적된다. 같은 날 재발행 시 컨센서스 근거 조회가 일시 실패해도 **그날 판에 이미 실려 있던 근거는 보존**되므로(task#268), 정정 목적의 재발행이 근거를 지우지 않는다.

**Auth:** `X-API-Key` 헤더

**Path Parameter:** `ticker` — 종목 코드

**Request Body** (요구 최소형태 — points는 2~3개·**정량 근거는 metrics 칩으로**, body는 1~2문장, 밴드는 low ≤ high)
```json
{
  "rating": "buy",
  "title": "HBM 증설이 이끄는 실적 재평가",
  "fair_value_low": 80000,
  "fair_value_high": 95000,
  "valuation_method": "과거 5년 PER 밴드 평균 12배에 2026F EPS 적용",
  "points": [
    { "title": "HBM 캐파 2배 증설", "body": "캐파 확대가 컨센서스 증익의 40%를 설명한다(회사 가이던스 기반).",
      "metrics": [
        { "label": "2026F 영업이익", "value": "383.2조원", "change_pct": 779.0 },
        { "label": "forward PER", "value": "5.9배" },
        { "label": "2Q26E 마진", "value": "48.9%" }
      ] },
    { "title": "파운드리 적자 축소", "body": "가동률 회복으로 적자 폭 축소.", "metrics": [ { "label": "가동률", "value": "80%+" } ] }
  ],
  "risks": "메모리 수요 둔화 시 ASP 하락\n파운드리 수주 지연\nHBM 인증 실패"
}
```

| 필드 | 타입 | 필수 | 설명 |
|------|------|------|------|
| `rating` | string | ✅ | 투자의견 — `buy` \| `neutral` \| `sell` (3단계, 다른 값 422) |
| `title` | string | ✅ | 한줄 논지 (리포트 제목) |
| `fair_value_low` | number | ✅ | 적정주가 밴드 하단 |
| `fair_value_high` | number | ✅ | 적정주가 밴드 상단 (low보다 작으면 422) |
| `valuation_method` | string | ✅ | 적정주가 산정방식 — **1~2문장** |
| `points` | array | ✅ | 투자포인트 `{title, body, metrics}` — **2~3개**. `body`는 1~2문장, 정량 근거는 `metrics` 칩 `{label, value(표시용 문자열), change_pct?(숫자)}` 2~4개로 분리 |
| `risks` | string | ✅ | 리스크 요인 — **줄바꿈(`\n`) 구분 불릿 2~3개**, 각 한 문장 |

**Response `201`**
```json
{ "ok": true, "ticker": "005930", "published_date": "2026-07-25" }
```

**Errors**

| 상태 | 설명 |
|------|------|
| `401` | API Key 누락/불일치 |
| `409` | 해당 종목 스냅샷 없음 — `POST /api/report/generate?tickers={ticker}`로 먼저 생성 |
| `422` | rating enum·points 개수·밴드 역전·필수 필드 누락 |

---

### `GET /api/tech-reports`

주요기술 리포트 목록 — `reports[]`가 **기술당 1행**(이력 없음, ADR-0038). 갱신 전 조건 확인(그 기술의 마지막 갱신일이 30일 이상 지났는지 판단)에 사용. 같은 응답의 `topics[]`는 **등록 대상 정본**(`TECH_TOPICS` 파생, 15종)으로 `slug`·`name`·`order`만 담고 **발행 여부와 무관**하다 — 미발행 목록이 필요하면 `topics[]` − `reports[]` 차집합으로 구한다(별도 호출 불필요).

**Auth:** `X-API-Key` 헤더

**Response `200`**
```json
{
  "reports": [ { "slug": "smr", "published_date": "2026-07-01", "title": "SMR, 원자력의 두 번째 곡선", "...": "발행 필드 전체" } ],
  "topics": [ { "slug": "reusable-rocket", "name": "재사용 로켓", "order": 1 }, { "slug": "smr", "name": "SMR", "order": 3 } ]
}
```

> 대상 slug(아래 `POST` 절의 Path Parameter가 정본 열거, `topics[]`와 같은 집합) 중 `reports[]`에 없는 slug는 미발행 상태 — ADR-0044로 대상이 15종으로 늘어난 직후엔 미발행 종이 다수다. `topics[]`에 발행 여부 플래그는 없다(「발행됐다」를 말하는 숫자를 `reports[]` 하나로 유지하는 의도적 설계). 각 행은 발행 시 제출한 필드 전체 + `id`·`created_at`을 담는다(위 예시는 조건 확인에 쓰는 3개만 발췌). 담지 않고 발행한 선택 필드는 `null`로 나온다(`key_points`·`milestones` 등 — 빈 배열이 아니다).

---

### `POST /api/tech-reports/{slug}`

주요기술 리포트 발행(갱신) (ADR-0033, 저장모델 개정 ADR-0038). 종목이 아니라 **기술 하나**를 단위로 발행한다. 애널리스트 리포트와 달리 서버가 발행 시점에 자동 첨부하는 숫자가 전혀 없으므로, 기술설명·난이도·업체·시장 수치를 **전부 이 요청 본문에** 조사해 채운다. **slug당 1행 — 재발행(갱신)은 그 행을 덮어쓴다(이력 없음)**, 애널리스트 리포트와 달리 과거 판이 누적되지 않는다. 단 **덮어쓰기의 입도는 컬럼 단위**다 — 선택 5필드는 키를 생략하면 직전 판이 보존된다(아래 「생략 vs 명시적 `null`」).

**Auth:** `X-API-Key` 헤더

**Path Parameter:** `slug` — `reusable-rocket` \| `solid-state-battery` \| `smr` \| `robotics` \| `ai-datacenter-equipment` \| `ai-datacenter-ops` \| `autonomous-driving` \| `space-comms` \| `quantum-computing` \| `nuclear-fusion` \| `solar-pv` \| `semiconductor-equipment` \| `on-device-ai` \| `obesity-drugs` \| `unmanned-defense` (그 밖의 값은 `422`. 좁힌 이름의 범위는 ADR-0044 결정 3 — 루틴 프롬프트 §3이 지시문으로 담는다)

**Request Body**
```json
{
  "published_date": "2026-08-03",
  "title": "재사용 발사체, 궤도당 비용을 다시 쓴다",
  "description": "1단 재사용이 발사비를 낮추는 구조를 설명한다(3~5문장).",
  "difficulty": { "score": 4, "rationale": "극저온 추진제 재점화가 어렵다." },
  "players": [
    { "name": "SpaceX", "country": "US", "state_led": false, "ticker": null,
      "tech_level": 5, "gap_years": 0, "leader_name": "SpaceX",
      "share_pct": 60.0, "note": "재사용 1위", "category": "궤도급 완전재사용" },
    { "name": "Rosatom", "country": "RU", "state_led": true, "tech_level": 2,
      "gap_years": 8, "leader_name": "SpaceX", "category": "소모형 개량" }
  ],
  "challenges": [ { "title": "재점화 신뢰성", "body": "다회 재점화 엔진 내구성 확보가 관건." } ],
  "related": { "prerequisites": ["정밀 유도항법"], "derivatives": ["eVTOL"], "complements": [], "competitors": [] },
  "market": {
    "history": [ { "year": 2024, "size": { "value": 12.5, "currency": "USD", "unit": "bn" } } ],
    "forecast": [ { "year": 2030, "size": { "value": 30.5, "currency": "USD", "unit": "bn" } } ],
    "cagr_pct": 12.3, "share_basis": "발사 횟수 기준", "as_of": "2026-08-03",
    "estimates": [
      { "institution": "Morgan Stanley", "year": 2030, "size": { "value": 33.5, "currency": "USD", "unit": "bn" }, "scope": null, "is_basis": true },
      { "institution": "McKinsey", "year": 2030, "size": { "value": 32.0, "currency": "USD", "unit": "bn" }, "scope": "발사 서비스만", "is_basis": null }
    ]
  },
  "sources": [ { "title": "NASA" }, { "title": "SpaceX 공개 발표자료", "url": null } ],
  "key_points": [
    { "title": "발사비가 한 자릿수로 내려왔다",
      "metrics": [ { "label": "kg당 발사비", "value": "2,700달러", "change_pct": -22.0 },
                   { "label": "연간 발사", "value": "134회" } ],
      "body": "1단 회수 성공률이 안정되며 단위비용이 소모형 대비 1/5 수준이 됐다." },
    { "title": "경쟁자는 아직 실증 단계",
      "metrics": [ { "label": "재사용 성공 기업", "value": "1곳" } ],
      "body": "유럽·중국 모두 1단 회수 실증 중이며 상업 운용까지는 수년이 남았다." }
  ],
  "milestones": [
    { "year": 2015, "actor": "SpaceX", "event": "1단 지상 회수 성공", "status": "done" },
    { "year": 2026, "actor": "SpaceX", "event": "Starship 궤도 재사용 실증", "status": "in_progress" },
    { "year": 2030, "actor": null, "event": "완전 재사용 상업 운용", "status": "planned" }
  ],
  "variants": [
    { "axis_label": "회수 방식",
      "options": [
        { "name": "추진 수직착륙", "examples": ["SpaceX Falcon 9"], "strength": "정밀 착지, 재정비가 빠르다.", "tradeoff": "역분사 추진제만큼 탑재량이 줄어든다." },
        { "name": "그물 포획", "examples": ["Rocket Lab Electron"], "strength": "소형기체에 추진제 손실이 없다.", "tradeoff": "포획 성공률이 낮고 대형기체엔 부적합." }
      ] }
  ],
  "watch_items": [
    { "label": "같은 1단 기체의 회전율(재사용 횟수/년)이 늘어나는가",
      "detail": "정비 없이 재발사까지 걸리는 시간이 짧아져야 단가가 실제로 내려간다.",
      "not_signal": "발사 횟수 자체의 증가는 신규 기체 생산 확대일 수도 있어 회전율과 다르다." }
  ],
  "composition": {
    "tech": [
      { "name": "재점화 엔진", "share_pct": 40, "leaders": ["SpaceX"],
        "rationale": "다회 재점화 내구성이 재사용 횟수의 상한을 정한다." },
      { "name": "정밀 착륙 제어", "share_pct": 35, "leaders": ["SpaceX"],
        "rationale": "착륙 오차가 회수 성공률을 직접 좌우한다." },
      { "name": "열보호 소재", "share_pct": 25, "leaders": [],
        "rationale": "재진입 열부하가 정비 비용을 지배한다." }
    ],
    "minerals": [
      { "name": "니오븀", "share_pct": 45, "rationale": "고온 합금의 대체 불가 첨가원소다.",
        "top_source_country": "브라질", "top_source_pct": 88, "used_in": ["재점화 엔진"],
        "producers": [ { "name": "CBMM", "country": "브라질", "ticker": null, "share_pct": 78 } ] },
      { "name": "탄소섬유", "share_pct": 30, "rationale": "동체 경량화 원가의 다수를 차지한다.",
        "top_source_country": "일본", "top_source_pct": 62, "used_in": ["열보호 소재"], "producers": [] },
      { "name": "헬륨", "share_pct": 25, "rationale": "추진제 가압에 상용 대체재가 없다.",
        "top_source_country": "US", "top_source_pct": 55, "used_in": [], "producers": [] }
    ],
    "minerals_share_basis": "세계 생산량 기준",
    "experts": [
      { "name": "추진 시스템 설계", "share_pct": 50, "rationale": "재점화 사이클 설계 경험자가 가장 희소하다." },
      { "name": "유도항법 제어", "share_pct": 30, "rationale": "착륙 유도 알고리즘 실증 인력이 소수다." },
      { "name": "재진입 열역학", "share_pct": 20, "rationale": "실비행 열데이터를 다뤄본 인력이 극소수다." }
    ]
  }
}
```

| 필드 | 타입 | 필수 | 설명 |
|------|------|------|------|
| `published_date` | string | ✅ | `YYYY-MM-DD` |
| `title` | string | ✅ | 한줄 제목 |
| `description` | string | | 상세 기술설명(생략 시 `""`) |
| `difficulty` | object | ✅ | `{score, rationale}` — **기술 자체**의 진입 난이도(업체별 기술수준과는 별개 축, 아래 참고) |
| `players` | array | | 주요업체(상장 여부 무관 — SpaceX·Rosatom·CASC처럼 비상장·국영이 선두인 기술이 있다) |
| `players[].tech_level` | int 1~5 | ✅ | 그 **업체의** 기술 성숙 단계 — `1 기초연구 · 2 시제품 · 3 실증 · 4 초기상용 · 5 양산상용`(공통 5단계 이산 척도, 0~100 점수 금지) |
| `players[].gap_years` | int\|생략 | | 선두 대비 격차 **정수 년수**(`0`=선두 자신). `leader_name`을 함께 채워 무엇 대비인지 명시 |
| `players[].share_pct` | number\|생략 | | 시장점유율(%). 채우면 `market.share_basis`가 반드시 있어야 함(없으면 422) |
| `players[].category` | string\|생략 | | **업체 분류 축**(자유 문자열, ADR-0039 결정 4) — 같은 계열·섹터끼리 묶는 이름(SMR의 노형: 경수형·비등수형·고온가스로·소듐냉각고속로 / AI 데이터센터의 공급망 섹터: 전력·냉각·가속기·메모리 등). 기술마다 분류 체계가 다르므로 그 기술의 통용 분류를 쓰고, **없는 기술이면 전 업체에서 생략**한다(억지 분류 금지 — 채워지면 업체 표가 축별 소제목 행으로 묶이고 점유율도 축별 막대 그룹이 되며, 어느 업체에도 없으면 표·차트 모두 기존 평면 렌더 그대로다. 별도 「계보 분류」 칩 섹션은 더 이상 없음 — 표·차트가 묶이는 순간 중복이라 제거됨) |
| `challenges` | array | | 기술 난제 `{title, body}` |
| `related` | object | | `{prerequisites, derivatives, complements, competitors}`(문자열 배열) — 전제·파생·보완·경합 기술/티커 |
| `market` | object | ✅ | `{history, forecast, cagr_pct, share_basis, as_of, estimates}` |
| `market.history[]` | array | | **실측만**. `{year, size: {value, currency, unit}}` |
| `market.forecast[]` | array | | **예상만**. history와 같은 배열에 섞지 말 것 — 화면이 실선(실측)/점선(예상)을 이 구분으로 가른다 |
| `market.estimates[]` | array\|생략 | | **기관별 시장 추정치**(ADR-0034 개정) 최대 6건 — 조사기관마다 추정이 다를 때 나란히 보여준다(같은 기술의 시장 규모가 조사기관마다 2~3배 벌어지는 것이 드문 일이 아니다). `{institution: ≤40자, year, size: {value, currency, unit}, scope?: ≤40자, is_basis?}` |
| `market.estimates[].size` | object | ✅ | `market.history`와 같은 구조 필드(`{value, currency, unit}`) — **문자열로 쓰지 말 것**. 배열 내 `size.currency`·`size.unit`·`year`는 **전부 동일**해야 함(다르면 422 — 통화·단위·연도가 섞이면 막대 길이·최대/최소 배수 비교가 거짓말한다) |
| `market.estimates[].scope` | string\|생략 | | 그 기관이 잡은 **집계 범위**를 짧게 적는 표시 문자열("발사 서비스만"·"기체 제조 포함") — 같은 시장인데 숫자가 다른 이유를 설명. `size`와 달리 이 필드만 자유 텍스트 |
| `market.estimates[].is_basis` | boolean\|생략 | | 성장 곡선(`market.history`/`forecast`)이 **채택한 기관**임을 표시. 배열 내 **최대 1건**만 `true`(2건 이상이면 422) — 어느 기관 추정을 곡선으로 그렸는지 문자열·값 일치로 추론시키지 않는다 |
| `sources` | array | ✅ | 출처 `{title, url?}` **최소 1개**. 근거를 못 대는 수치는 그 필드를 생략한다(`null`도 `0`도 아님 — **틀린 값 < 누락**) |
| `key_points` | array\|생략 | | **핵심 포인트 카드** `{title, body, metrics?}` 3~4개 — 이 기술을 처음 보는 사람이 카드만 읽고 결론을 잡을 수 있게. `body`는 **1~2문장**, 정량 근거는 문장에 늘어놓지 말고 `metrics` 칩으로 분리(애널리스트 리포트 `points[]`와 같은 규약) |
| `key_points[].metrics[]` | array | | 지표 칩 **최대 4개**(초과 시 422). `{label: ≤40자, value: ≤40자, change_pct?}`. `value`는 **표시용 문자열**("1.1조원"·"22%"·"134회") — 단위·통화를 문자열에 그대로 쓴다. `change_pct`만 숫자(양수=상승 색·음수=하락 색), 증감이 없으면 생략 |
| `milestones` | array\|생략 | | **진척 타임라인** `{year, actor?, event, status}` — "언제 무엇이 가동/착공/실증됐나"를 산문에 묻지 말고 여기에 싣는다. `year`는 정수, `event`는 그 해에 무슨 일이 있었는지 한 구절, `actor`는 주체(국가·기업, 특정 주체가 없으면 생략) |
| `milestones[].status` | enum | ✅ | `done`(이미 일어남) \| `in_progress`(진행 중) \| `planned`(계획·전망) **3값만** — 그 밖은 422. 구체 단계명("착공"·"계통연결")은 기술마다 다르므로 `event`가 담고, 색·마커는 이 3값이 정한다 |
| `variants` | array\|생략 | | **계보 비교축**(ADR-0034 개정) 최대 2개 — 한 기술이 갈라지는 접근 방식들을 이점·대가 쌍으로 비교. `{axis_label: ≤30자, options}`. 축 이름은 자유 문자열(SMR "노형"·재사용 로켓 "회수 방식"·전고체 배터리 "고체 전해질 계열") — 이 기술에 그런 분류 축이 없으면 필드 자체를 생략한다 |
| `variants[].options` | array | ✅ | 그 축의 선택지 **최소 2개·최대 6개** — 1개뿐이면 비교가 아니라 서술이므로 **그 축을 생략하고 산문에 쓸 것**(2개 미만이면 422). `{name: ≤40자, examples?: ≤6개 문자열, strength?: ≤120자, tradeoff?: ≤120자}`. `strength`/`tradeoff`는 반드시 **쌍으로** — 어느 계열이 우월하다는 순위를 매기지 말고 이점과 대가를 함께 적는다 |
| `watch_items` | array\|생략 | | **확인할 지표**(ADR-0034 개정) 최대 5개 — "앞으로 무엇이 관측되면 이 기술의 진척으로 인정하는가"를 미리 못 박은 판정 신호. `{label: ≤60자, detail?: ≤200자, not_signal?: ≤200자}` |
| `watch_items[].not_signal` | string\|생략 | | **오독 경고** — 파일럿 라인 준공·샘플 공개·양산 목표 재확인처럼 *일정이 유지된다*는 신호일 뿐 진척이 아닌 것을 명시. 해당 지표에 그런 오독 위험이 없으면 생략 가능하지만, 있으면 반드시 `label`/`detail`과 **분리해서** 적을 것(한 문장에 섞지 말 것) |
| `composition` | object\|생략 | | **기술 해부** — 자가 서로 다른 지분 축 3개(ADR-0042). `{tech?, minerals?, experts?, minerals_share_basis?}`. 「이 기술이 무엇으로 만들어지나 · 어디가 병목인가 · 원가가 어디에 노출되나」에 답한다. **세 축을 합쳐 하나로 읽으면 안 된다** — 분모가 각각 남은 난제 총량 · 원재료비 · 인력 병목 총량으로 다르다. 축은 전부 선택이되 **최소 한 축**은 있어야 한다(`{}`는 422 — 「해부 없음」은 필드 생략으로 표현) |
| `composition.tech[]` | array\|생략 | | **필요기술 축**(자 = 남은 난제 총량) **3~7개** — `{name: ≤40자, share_pct, rationale: ≤200자, leaders?: ≤6개}`. `leaders[]`엔 업체 **이름만** 싣는다(기술수준·점유율·티커는 화면이 `players[]`에서 끌어온다) — 그래서 **`players[].name`과 바이트 동일**해야 하고 없는 이름은 422로 거부된다(그 이름이 에러 메시지에 실린다) |
| `composition.minerals[]` | array\|생략 | | **핵심 광물 축**(자 = 원재료비) **3~7개** — `{name, share_pct, rationale, top_source_country?, top_source_pct?, used_in?: ≤6개, producers?: ≤6개}`. `used_in[]`은 **같은 요청의 `composition.tech[].name`과 바이트 동일**해야 하고 없는 이름은 422로 거부된다(`leaders`와 같은 규율 — 해부 화면이 그 이름을 조인 없이 「쓰임」 문구로 렌더하므로 끊긴 참조는 *없는 기술을 사실처럼 적은 문구*가 된다. 같은 요청에 `tech` 축이 없으면 참조 대상이 없어 이 검증은 생략된다). `producers[]`(`{name, country, ticker?, share_pct?}`)는 채굴·정제 업체라 **`players[]`와 별개 목록**이고 기술수준을 붙이지 않는다 — 리튬을 캐는 회사에 "양산상용 단계"란 없다 |
| `composition.experts[]` | array\|생략 | | **전문가 축**(자 = 인력 병목 총량) **3~7개** — `{name, share_pct, rationale}`. **업체를 붙이지 마라** — 인력 병목은 특정 회사가 소유한 것이 아니고, 붙이면 기술 축의 선도기업과 중복되거나 대학·규제기관이 섞여 축이 무너진다 |
| `composition.minerals_share_basis` | string\|생략 | | 광물 점유의 **기준 문구**(≤60자, 예: `"세계 생산량 기준"`). 어느 `producers[].share_pct`라도 실으면 **필수**(없으면 422) — 이 점유는 *그 광물 세계 생산* 기준이라 `market.share_basis`(그 **기술 시장**의 점유)와 자가 다르다 |
| `composition.*[].share_pct` | number | ✅ | 그 축 안에서의 지분(%) — **5의 배수만**(37·32.5는 422)이고 **축마다 합이 정확히 100**(95·105는 422). 잔여는 숨기지 말고 **「기타」 항목**으로 명시하라. ⚠️ 이 그리드는 **축 지분에만** 적용된다 — `producers[].share_pct`·`top_source_pct`는 출처 있는 외부 통계라 반올림하지 마라 |
| `composition.*[].rationale` | string | ✅ | **그 지분이 왜 그 몫인지 1문장**(≤200자, 공백만이면 422). 이 축엔 출처를 달 자리가 없으므로 판단 근거가 그 역할을 한다 — 근거를 못 쓰면 **그 항목을 발행하지 마라**(틀린 값 < 누락) |
| `composition.*[].name` | string | ✅ | 항목명(≤40자). **한 축 안에서는 서로 다른 이름을 써라** — 같으면 422다(같은 이름의 행이 두 번 그려지면 독자가 서로 다른 둘로 읽는다). **다른 축에 같은 이름은 괜찮다** — 「리튬」이 광물 축과 기술 축에 함께 나오는 것은 정당하다 |

**통화·단위 enum(필수, 자유 텍스트·환산 금지)** — `currency`: `USD` \| `KRW`. `unit`: `mn`(백만) \| `bn`(십억) \| `tn`(조). 렌더러가 절대 추측·환산하지 않으므로 enum 밖 값은 `422`.

> **문자열 수치는 요약 칩에만** — `key_points[].metrics[].value`가 표시용 문자열인 것은 그 칩이 **그래프를 그리지 않기 때문**이다(ADR-0034). 차트를 그리는 수치(`market` 금액 — `history`·`forecast`·`estimates[].size` 전부 포함·`milestones[].year`·`tech_level`·`share_pct`)는 **절대 문자열로 쓰지 말 것** — 구조 데이터여야 곡선·축·밴드를 그릴 수 있다(ADR-0033). `market.estimates[].scope`·`variants[].options[].examples/strength/tradeoff`는 예외(자유 텍스트) — 어느 것도 좌표를 계산하지 않는 순수 요약 칩이다.
> **모르면 생략** — `key_points`·`milestones`·`players[].category`·`market.estimates`·`variants`·`watch_items`·`composition` 일곱 필드는 전부 선택이다(`composition`은 **축 단위로도** 생략 가능 — 아는 축만 싣는다. 단 재발행에서는 아래 축 소실 규칙이 걸린다). 조사로 확인되지 않으면 억지로 채우지 말고 생략한다 — **첫 발행에서는** 화면이 그 섹션째 생략하고(`players[].category`만 예외로 표·점유율이 평면 렌더로 폴백) **재발행에서는 생략의 뜻이 필드마다 갈린다**(바로 아래). 다만 `description` 산문에는 썼는데 필드를 비우면 **독자가 그 정보를 화면에서 못 본다** — 산문에 쓸 내용이 있으면 필드에도 싣는다.

#### 생략 vs 명시적 `null` — 재발행의 필드 보존 (task#313)

**선택 5필드 `key_points`·`milestones`·`variants`·`watch_items`·`composition`은 키를 생략하면 직전 판의 값이 그대로 보존된다.** 지우려면 **명시적 `null`**을 실어야 한다(`"composition": null`). 신규 slug(첫 발행)에서는 둘 다 결과가 같다.

그래서 **재발행에서 생략은 「조사 안 했다」가 아니라 「직전 판을 계속 쓰겠다」는 선언**이다. 세 갈래로 갈린다:

| 필드 | 키를 생략하면 |
|---|---|
| `key_points`·`milestones`·`variants`·`watch_items`·`composition` | **직전 판 보존** (지우려면 명시적 `null`) |
| `challenges`·`related`·`players[].category` | **사라진다** — 리포트 본문이라 생략을 부분 갱신으로 다루지 않는다 |
| `market.estimates` | **사라진다** — `market`이 통째 치환되므로 그 안의 선택 키도 함께 |

⚠️ `market`·`description`의 수치를 갱신했으면 **그 수치를 인용하는 `key_points`·`milestones`도 같은 요청에 다시 실어라** — 보존된 옛 카드가 새 본문과 어긋난 채 남는다.

⚠️ **`composition`의 보존 입도는 필드 하나(컬럼)다.** `composition`을 실으면 그 필드가 통째 치환되므로 **직전 판에 있던 축(`tech`/`minerals`/`experts`)을 말없이 빼면 422**다 — 그 축을 함께 다시 싣거나(`GET /api/tech-reports/{slug}`에서 복사), 정말 지울 때만 축에 명시적 `null`(`"tech": null`)을 실어라. 축 단위 자동 병합은 하지 않는다.

⚠️ **`published_date`·`created_at`은 항상 갱신된다** — 그래서 행은 여러 발행 시점의 모자이크가 될 수 있고 화면의 「YYYY-MM-DD 갱신」은 *본문* 갱신일이다. 응답 `preserved`가 그 요청에서 무엇이 오늘 값이 아닌지 알려주는 유일한 수단이다.

> **기술수준 vs 기술난이도 vs 기술격차** — 세 축을 섞지 마세요. `players[].tech_level`은 *그 업체가* 지금 어느 단계인지, `difficulty`는 *그 기술 자체가* 얼마나 어려운지(기술 단위 필드 하나, 업체별이 아님), `gap_years`는 *선두 대비 몇 년 뒤인지*입니다.
> **상용 시장이 아직 형성되지 않은 기술**(예: SMR·재사용 로켓 일부 세그먼트)은 점유율 근거를 댈 수 없으면 `share_pct`를 생략하세요(업체 표는 그대로, 점유율 칸만 빔).

**Response `201`**
```json
{ "ok": true, "slug": "reusable-rocket", "published_date": "2026-08-03", "preserved": [] }
```

`preserved` — 이 요청이 **키를 생략해 보존된** 선택 필드 이름(사전순). 전부 실은 판은 `[]`, `composition`·`watch_items`를 생략했으면 `["composition", "watch_items"]`. 명시적 `null`(삭제)은 여기 들어오지 않는다.

**Errors**

| 상태 | 설명 |
|------|------|
| `401` | API Key 누락/불일치 |
| `422` | 미등록 slug · currency/unit/`milestones[].status` enum 위반 · NaN/Infinity 값 · `sources` 0개 · `key_points[].metrics` 5개 이상 · `market.estimates` 7건 이상 · `market.estimates` 내 currency/unit/year 불일치 · `market.estimates[].is_basis=true` 2건 이상 · `variants` 3개 이상 · `variants[].options` 1개 이하 또는 7개 이상 · `watch_items` 6개 이상 · `share_pct` 있고 `share_basis` 없음 · `composition` 축 항목 2개 이하/8개 이상 · `composition` 축 `share_pct`가 5의 배수 아님 또는 합 ≠ 100 · `composition.*[].rationale` 공백 · `composition.tech[].leaders[]`가 `players[].name`에 없음 · `producers[].share_pct` 있고 `minerals_share_basis` 없음 · `composition: {}` · `composition` 한 축 안의 항목 `name` 중복 · 필수 필드 누락 · **`composition.minerals[].used_in[]`이 같은 요청의 `composition.tech[].name`에 없음** · **`composition`을 생략해 보존되는 직전 판의 `tech[].leaders`가 새 `players[]`에 없음** · **`composition`을 실었는데 직전 판에 있던 축이 빠짐**(축 소실) |

> **422 봉투가 두 형태다.** 스키마 검증(위 대부분 + `used_in`)은 표준 `{"detail": [{...}]}`(**배열**)이고, 직전 판을 읽어 판정하는 마지막 둘(**보존분 `leaders` 끊김**·**축 소실**)은 `{"detail": "<문자열>"}`이다. 두 문자열 메시지는 어느 이름·어느 축이 문제인지와 해법(그 값을 다시 싣기 / 그 업체를 `players[]`에 유지하기 / 정말 지울 때의 명시적 `null`)을 담으므로 **`detail`을 읽고 고쳐 재시도할 수 있다**. 해부를 지워서 422를 회피하지 말 것.

---

## 공통 에러 형식

```json
{ "detail": "에러 메시지" }
```

단 **스키마 검증 실패(`422`)의 `detail`은 문자열이 아니라 객체 배열**이다(FastAPI/pydantic 기본 — `[{"loc": [...], "msg": "...", "type": "..."}]`). 핸들러가 던지는 오류(`401`·`409`·핸들러 내부 `422`)만 위 문자열 형태다. `detail`을 로그에 찍을 때 문자열로 가정하지 말 것.

**`500`도 이 JSON 봉투다** — 미포착 예외는 `main.py`의 전역 `Exception` 핸들러가 `{ "detail": "Internal Server Error" }` 고정 문자열로 바꾼다(전에는 `text/plain` raw 500이라 JSON 파싱이 실패했다). 스택·내부 메시지는 응답에 실리지 않으므로 원인은 서버 로그에서만 확인할 수 있다 — 재시도 판단에 `detail` 문자열을 쓰지 말 것.

---

## 저장 후 효과

`enrich` API로 저장한 값은 리포트 생성 시 자동으로 반영됩니다.

- **`moat`** — 리포트 "경제적 해자" 섹션에 표시
- **`growth_plan`** — 리포트 "장기 성장 계획" 섹션에 표시
- **`risks`** — 리포트 "리스크" 섹션에 표시
- **`recent_disclosures`** — 리포트 "최근 공시 & 주가 영향" 섹션 상단에 표시
- **`insights`** — 리포트 "권고 인사이트(진입/회피 가이드)" 섹션에 표시
- **`key_resource`** — 리포트 "핵심 자원" 섹션(사업분석 탭)에 표시
- **`competitor_edge`** — 리포트 "경쟁사 기술·경쟁력 비교" 섹션(사업분석 탭)에 표시
- **`market_outlook`** — 리포트 "시장 전망" 섹션(사업분석 탭)에 표시. `segments`가 있으면 그 안에 "사업부문 시장 분석"이 함께 표시됨(부문별 매출비중 증감·시장 규모·자사 점유율→금액 환산)
- **`competitors`** — 경쟁사 비교 섹션에 반영

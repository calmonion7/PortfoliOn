# 투자 필수 정보 갭 분석 보고서

> **시점성 문서** — 분석일 **2026-06-27** 기준. 유지보수 대상 레퍼런스(API_SPEC.md 등)가 아니라, "신규 기능을 무엇부터 만들지" 결정을 돕기 위한 1회성 감사 산출물입니다. 코드가 변하면 자연히 stale해지며, 갱신이 필요하면 재감사로 대체합니다.
>
> - **렌즈**: 중장기 펀더멘털 + 수급 개인투자자가 "무엇을 살지(발굴)·언제 사고팔지·들고갈지" 판단에 필요한 정보. 단타/실시간 호가·주문/계좌 연동은 의도적 범위 밖(ADR-0009/0011).
> - **시장**: KR·US 둘 다, 데이터포인트별 시장 가용성 표기.
> - **입자**: 데이터포인트 단위 ✅보유 / 🔶부분 / ❌미보유 / —해당없음. 모든 판정은 실제 코드(엔드포인트·테이블·컴포넌트)에 그라운딩.
> - **범례**: ✅ 보유 · 🔶 부분(일부만/얕게/저장은 되나 미표시) · ❌ 미보유 · — 해당없음(시장 원천 부재)

---

## 1. 한눈 요약

### 강점 (이미 잘 갖춘 영역)
- **수급·스마트머니 (KR)** — 외인/기관 순매수·외국인보유율·공매도 거래추이·신용/대차잔고·내부자/5%룰·구루 카운트·수급 스코어까지 폭넓게 보유. 앱의 최대 차별점.
- **매크로·시장환경** — FX·VIX·원자재·국채·FRED 경제지표·매크로 신호·KR/US 섹터 모멘텀·보유종목-매크로 상관까지 6개 핵심 축 완비.
- **밸류에이션 코어** — PER/PBR(실적+컨센 추정)·목표가·상승여력·컨센서스 투자의견 분포 KR/US 모두 보유.
- **기술·정성** — 매물대(Volume Profile)·RSI(일/주/월)·해자(moat)·AI 내러티브(insights/risks)·뉴스 수집 KR/US 공통.
- **KR 고유 데이터** — 수주잔고(DART)·DART 공시 피드·성장 이니셔티브/단계라벨.

### 핵심 갭 (가장 큰 공백)
1. **재무 건전성 지표 전반** — 영업/순이익률·ROE·부채/유동비율·FCF·이자보상배율이 거의 전무. **그런데 KR은 Naver API에 데이터가 이미 있고(미추출), US도 yfinance에서 이미 접근 중인 데이터로 파생 가능** — "손 안의 데이터를 안 꺼내 쓰는" 갭이라 가성비 최고.
2. **US 수급** — KR이 강한 반면 US는 기관 flow·공매도·내부자 거래가 통째로 미보유.
3. **상대 밸류에이션** — 동종업계 Peer PER/PBR·시장지수 밸류에이션(KOSPI/S&P PER·CAPE)이 없어 "싼지 비싼지"의 기준점 부재.
4. **벤치마크 지수** — KOSPI·S&P500 지수 레벨 자체가 미수집 → 포트폴리오 vs 시장 비교 불가.
5. **이벤트 캘린더 깊이** — KR 실적발표 예정일·정확한 배당락일·경제지표 발표 일정·주총/락업/IPO 부재.

### 추천 빌드 후보 (상세는 §4)
| 순위 | 빌드 후보 | 핵심 이유 | 데이터 |
|---|---|---|---|
| 1 | **재무 건전성·수익성 지표 보강** | 데이터가 이미 손안에 있음(KR Naver 미추출 row + US yfinance 미사용 필드), 펀더멘털 투자 핵심 | 거의 전부 기존 연동 |
| 2 | **상대 밸류에이션(Peer + 멀티플 보강)** | "싼지 비싼지" 판단 기준, 경쟁사 루프 이미 존재 | 기존 연동 |
| 3 | **시장지수 레벨·밸류에이션(벤치마크)** | 포트폴리오 vs 시장 비교, 시장 과열도 | US 기존(FRED/yfinance), KR 일부 신규 |
| 4 | **US 수급 보강** | KR 강점을 US로 대칭 확장 | yfinance 기존 + 구루 드릴다운(프론트만) |
| 5 | **이벤트 캘린더 확장** | KR 실적일·배당락 정확화·경제 일정·주총 | 대부분 기존 DART/Naver/FRED |
| 6 | **가격·기술 표면 보강** | 52주/EMA 연결·추세요약·베타/변동성 | 기존 함수/소스(미연결) |

---

## 2. 축별 판정표

### ① 밸류에이션
> PER/PBR·목표가·상승여력·컨센서스 투자의견은 KR/US 완비. PSR·EV/EBITDA·PEG·동종업계 상대비교·내재가치(DDM/DCF)는 미보유.

| 데이터포인트 | KR | US | 근거 (요약) |
|---|:--:|:--:|---|
| PER/PBR (실적 기반) | ✅ | ✅ | KR `get_financials_kr`(FnGuide row 12/14), US `get_financials`(yfinance 파생) → `FinancialsChart.jsx` |
| PER/PBR (컨센 추정 포함) | ✅ | 🔶 | KR FnGuide isConsensus 행, US forward PER은 snapshot엔 있으나 시계열 미반영 |
| 목표가 (평균/상단/하단) | ✅ | ✅ | `daily_consensus_mart.avg_target_price`, `GET /api/consensus/{ticker}`, `ConsensusChart.jsx` |
| 상승여력(Upside %) | ✅ | ✅ | `DetailTab.jsx`/`StockCard.jsx` (목표가-현재가 파생) |
| 컨센서스 투자의견 분포 | ✅ | ✅ | `consensus_history`/`daily_consensus_mart`(buy/hold/sell), `ConsensusChart.jsx` |
| Finviz 종합의견 점수 | — | ✅ | `scraper.scrape_finviz_consensus`(finviz_recom 1~5), `DetailTab.jsx` |
| PSR | ❌ | ❌ | 수집·표시 전무. KR FnGuide 매출/US yfinance priceToSales 미활용 |
| EV/EBITDA | ❌ | ❌ | 키 없음. US yfinance `enterpriseToEbitda` 미활용 |
| 동종업계 상대밸류(Peer PER/PBR) | ❌ | ❌ | `Sections.ReportSectionCompetitors`는 price/시총/YTD만, 멀티플 없음 |
| PEG | ❌ | ❌ | US yfinance `pegRatio` 미활용 |
| 내재가치(DDM/DCF) | ❌ | ❌ | 내재가치 추정 모델 전무(백엔드 LLM 없음) |

**갭·제안**
- 🔶 **US forward 컨센 PER 시계열** — *low* — yfinance `analyst_price_targets` EPS를 `get_financials_us`에 is_consensus 행으로 append. (기존 yfinance)
- ❌ **PSR** — *medium* — KR FnGuide 매출/US `priceToSales`로 산출, FinancialsChart에 라인 추가. (기존 연동)
- ❌ **EV/EBITDA** — *medium* — US `enterpriseToEbitda`(기존), KR FnGuide 항목 확인 필요(신규 파싱).
- ❌ **동종업계 Peer PER/PBR** — *high* — 경쟁사 루프(`report_generator.py:82`)가 이미 있음. 경쟁사별 PER/PBR 함께 수집해 카드에 추가. (기존 연동)
- ❌ **PEG** — *low* — US `pegRatio`(기존), KR은 EPS 성장률 별도 수집 필요.
- ❌ **DDM/DCF 내재가치** — *low* — Gordon Growth(DPS/(r-g)) 또는 Cowork enrich에 `intrinsic_value` 위임. 사용자 파라미터 필요.

### ② 재무 건전성·수익성
> 매출·영업이익 추이는 KR/US 보유. **나머지 건전성 지표(이익률·ROE·부채/유동비율·FCF·이자보상)는 거의 전무** — 단, KR은 Naver API row에 이미 존재(미추출), US도 yfinance 기존 접근분에서 파생 가능.

| 데이터포인트 | KR | US | 근거 (요약) |
|---|:--:|:--:|---|
| 매출/영업이익 추이 | ✅ | ✅ | `get_financials_kr`/`get_annual_financials_us`, `FinancialsChart.jsx`(연간/분기 토글) |
| 순이익 추이 | 🔶 | 🔶 | KR Naver row2 미추출 / US NetIncome는 EPS계산용만, 차트 미표시 |
| 영업이익률·순이익률 | ❌ | ❌ | **KR Naver row5·6 실존하나 미추출**, US 파생 미구현 |
| ROE/ROIC | ❌ | ❌ | **KR Naver row7(ROE) 미추출, US `returnOnEquity` 미사용**. ROIC는 양시장 계산 없음 |
| 부채비율·유동비율 | ❌ | ❌ | **KR Naver row8·9 미추출**, US balance_sheet 접근 중이나 미계산 |
| 영업현금흐름·FCF | ❌ | ❌ | **US yfinance `cash_flow` 미사용**, KR Naver 현금흐름 엔드포인트 없음(DART 폴백) |
| 이자보상배율 | ❌ | ❌ | US income_stmt `InterestExpense` 미사용, KR은 DART 필요 |
| 자산·자본 규모 | ❌ | 🔶 | US equity 접근 중이나 snapshot 미노출, KR 소스 미확인 |

**갭·제안**
- 🔶 **순이익 추이** — *medium* — KR `rv(2)`, US dict에 `net_income` 키 추가, 차트 3번째 라인. (기존)
- ❌ **영업/순이익률** — *high* — KR `rv(5)`/`rv(6)` 즉시 추출, US 영업이익/매출 파생. (기존, 즉시 가능)
- ❌ **ROE/ROIC** — *high* — ROE: KR `rv(7)`/US `returnOnEquity`(기존). ROIC는 1단계 제외(balance sheet 파싱 필요).
- ❌ **부채/유동비율** — *high* — KR `rv(8)`/`rv(9)`, US balance sheet 파생. (기존)
- ❌ **영업CF·FCF** — *high* — US `t.cash_flow`(미사용 필드), KR DART 폴백. FinancialsChart에 FCF 섹션.
- ❌ **이자보상배율** — *medium* — US income_stmt `InterestExpense`(기존 접근), KR DART.
- 🔶 **자산·자본 규모** — *low* — US `TotalAssets`/`CommonStockEquity` snapshot 노출, KR 소스 확인.

### ③ 성장성
> 매출/이익 성장률 시각화·수주잔고(KR)·성장 이니셔티브 완비. 컨센 추정치는 US forward 보유/KR 부분, 구조화 가이던스·CAPEX/R&D·TAM은 미보유.

| 데이터포인트 | KR | US | 근거 (요약) |
|---|:--:|:--:|---|
| 매출/이익 성장률(YoY/QoQ) | ✅ | ✅ | `FinancialsChart.calcChg`(QoQ 성장률 라벨) |
| 컨센 추정치(forward 매출·EPS) | 🔶 | ✅ | US yfinance earnings/revenue_estimate(0y/+1y), KR은 분기 revenue/영업이익만 |
| 가이던스(경영진 목표) | 🔶 | 🔶 | `tickers.recent_disclosures`/`growth_plan` 비정형 텍스트만, 구조화 필드 없음 |
| 수주잔고(Order Backlog) | ✅ | — | `backlog.py`(DART), `backlog_history`, `BacklogChart.jsx` (KR 전용) |
| 성장 이니셔티브·단계라벨 | ✅ | ✅ | `tickers.growth_plan`, `Sections.GrowthPlanSection`(status 칩) |
| CAPEX/R&D 투자 | ❌ | ❌ | 절대금액·매출대비 비율 시계열 없음 |
| TAM/시장성장 | ❌ | ❌ | TAM/시장규모/CAGR 필드 전무 |

**갭·제안**
- 🔶 **컨센 추정치 보강** — *medium* — KR forward EPS 보강(FnGuide), US quarterly에도 적용. (기존)
- 🔶 **가이던스 구조화** — *medium* — Cowork `recent_disclosures.metrics[]`에 FY가이던스 항목 추가(테이블 불필요).
- ❌ **CAPEX/R&D** — *medium* — US `t.cash_flow`(CapEx/R&D), KR Naver row 확인. FinancialsChart 탭 추가.
- ❌ **TAM** — *low* — Cowork `growth_plan.tam` 서브필드(공개 자동소스 없음, 수동 입력).

### ④ 배당·주주환원
> 배당수익률·DPS·배당락일(추정)은 보유. 배당성장 이력·배당성향·자사주·총주주환원율은 미보유 — 현재는 연간 단일 스냅샷이라 시계열·환원전략 분석 불가.

| 데이터포인트 | KR | US | 근거 (요약) |
|---|:--:|:--:|---|
| 배당수익률 | ✅ | ✅ | `dividends.py`(KR DART/US yfinance), `stock_dividends`, 대시보드 카드 |
| DPS(연 주당배당) | ✅ | ✅ | `stock_dividends.annual_dividend_per_share`, `yield_on_cost` 계산 |
| DPS 배당성장 이력(시계열/CAGR) | ❌ | ❌ | ticker PK 단일행(최신값만). 연도별 시계열 미저장 |
| 배당성향(Payout) | ❌ | ❌ | payout 컬럼/계산 없음 |
| 자사주 매입·소각 | ❌ | ❌ | buyback 수집·저장 전무 |
| 총주주환원율(배당+자사주) | ❌ | ❌ | buyback 미보유로 합산 불가 |
| 배당락일 | 🔶 | ✅ | yfinance 히스토리 평균 *예측*. KR은 yfinance 커버리지 부실 |

**갭·제안**
- ❌ **DPS 배당성장 이력** — *medium* — (ticker,year) 히스토리. US `t.dividends`(즉시), KR DART `bsns_year` 반복. CAGR 표시.
- ❌ **배당성향** — *medium* — 이력 테이블 후 DPS/EPS 산출. US `payoutRatio`(기존).
- ❌ **자사주 매입** — *low* — US cashflow `RepurchaseOfCapitalStock`, KR DART 자기주식 공시(피드 확장).
- ❌ **총주주환원율** — *low* — 자사주 선행 필요(buyback/시총 + 배당수익률).
- 🔶 **배당락일 정확화** — *medium* — US `info.exDividendDate`(확정일), KR DART `alotMatter` 기준일 역산.

### ⑤ 수급·스마트머니
> KR은 앱 최강 영역. 주 갭은 ① US 수급(기관 flow·공매도·내부자) 전반 미보유, ② KR 공매도 잔량 차트 미노출, ③ 구루 보유 드릴다운 부재.

| 데이터포인트 | KR | US | 근거 (요약) |
|---|:--:|:--:|---|
| 외국인/기관 순매수 추이 | ✅ | ❌ | KR `investor_service`(키움 ka10059/ka10008), `InvestorTrendSection.jsx`. US 미수집 |
| 외국인보유율 | ✅ | — | `market_investor_trend.foreign_hold_ratio`. US 제도 부재 |
| 공매도 추이(거래량·비중) | ✅ | ❌ | KR `kiwoom/shortsell.py`(ka10014), `ShortSellSection.jsx`. US 미수집 |
| 공매도 잔고(미상환 잔량) | 🔶 | ❌ | KR `short_balance` 저장되나 차트 시계열 아닌 헤더 텍스트만 |
| 신용잔고·반대매매 | ✅ | — | `market_leverage_indicators`(KOFIA), `LeverageSection.jsx` (시장 집계) |
| 대차잔고 | ✅ | — | `market_lending_balance`(금융위), `LendingSection.jsx` (시장 집계) |
| 내부자 거래(임원·주요주주) | ✅ | ❌ | KR `insider_trades.py`(DART elestock). US SEC Form4 미수집 |
| 5%룰 대량보유 | ✅ | ❌ | KR DART majorstock. US SEC 13D/13G 미수집 |
| 구루 13F 보유 | — | 🔶 | `guru_scraper`(dataroma top10), 카운트 뱃지만(드릴다운 없음) |
| 수급 종합 스코어 | ✅ | — | `supply_score.py`(밴드+플래그), `SupplySection.jsx` (KR 전용) |

**갭·제안**
- ❌ **US 외국인/기관 순매수** — *medium* — yfinance `institutional_holders`(분기 QoQ delta). 일별은 무료 소스 없음.
- ❌ **US 공매도 비중** — *medium* — yfinance `shortPercentOfFloat` 주간 스냅샷 누적.
- 🔶 **KR 공매도 잔량 시계열** — *low* — 저장된 `short_balance`를 차트에 시계열로(재활용).
- ❌ **US 내부자 거래(Form4)** — *medium* — yfinance `insider_purchases`/`insider_sales`, 기존 `stock_insider_trades` 재활용(market 분기 이미 존재).
- ❌ **US 5%룰(13D/13G)** — *low* — SEC EDGAR API(무료·신규).
- 🔶 **구루 보유 드릴다운** — *medium* — 리포트 상세에 보유 구루 목록·비중(`guru_managers` JSONB에 이미 있음, **프론트만**).

### ⑥ 매크로·시장환경
> 핵심 6축(FX·VIX·원자재·국채·경제지표·매크로 신호·섹터 모멘텀·매크로 상관) 완비. 공백은 ① 시장지수 레벨·밸류에이션, ② 한국 국내 경제지표.

| 데이터포인트 | KR | US | 근거 (요약) |
|---|:--:|:--:|---|
| FX (USDKRW/JPY/EUR) | ✅ | ✅ | `market_indicators/fx.py`, `FxSection.jsx` |
| VIX | ✅ | ✅ | `fx.get_vix`(^VIX), `VixSection.jsx` |
| 유가·금·구리 | ✅ | ✅ | `commodities.py`, `CommoditiesSection.jsx` |
| 미국 국채(3M~30Y) | — | ✅ | `commodities.py`(^IRX/^FVX/^TNX/^TYX), `TreasurySection.jsx` |
| 경제지표(CPI·실업률) | ❌ | ✅ | `econ.py`(FRED). 한국 거시지표 미수집 |
| 매크로 신호(금리차·HY·M2·기준금리) | — | ✅ | `macro.py`(FRED, evaluate_signals), `MacroSignalsSection.jsx` |
| 섹터 모멘텀 | ✅ | ✅ | US `analysis_service.SECTOR_ETFS`, KR `kr_sector_service`(키움 ka20006) |
| 시장지수 레벨(KOSPI/S&P) | ❌ | ❌ | ^GSPC/^KS11 미수집. 벤치마크 비교 불가 |
| 시장지수 밸류에이션(지수 PER/CAPE) | ❌ | ❌ | 시장 단위 멀티플 미수집 |
| 보유종목-매크로 상관 | ✅ | ✅ | `analysis_service.MACRO_TICKERS`(TLT/UUP/USO/^VIX 90일), `MacroTab.jsx` |

**갭·제안**
- ❌ **한국 경제지표** — *medium* — FRED 한국 시리즈(KORCPIALLMINMEI 등), 기존 `_fetch_series` 재사용 `?market=KR`.
- ❌ **시장지수 레벨** — *medium* — yfinance ^GSPC/^KS11/^KQ11 → `GET /api/market/indices`, 포트폴리오 벤치마크 비교.
- ❌ **시장지수 밸류에이션** — *high* — US FRED `CAPE_RATIO`+SPY forward PE(기존). KR은 공식 API 부재(KRX 크롤/네이버 비공식, 신규).

### ⑦ 이벤트·촉매
> 실적발표일·배당락일·DART 공시 피드는 KR/US 실질 보유(정확도 편차 있음). 경제지표 발표 일정·락업·IPO·주총·액면분할은 미보유.

| 데이터포인트 | KR | US | 근거 (요약) |
|---|:--:|:--:|---|
| 실적발표 예정일 | 🔶 | ✅ | `calendar._collect_earnings`(yfinance). KR은 yfinance 빈값 빈번 |
| 배당락일 | 🔶 | 🔶 | yfinance 히스토리 *평균 추정*(확정일 아님), KR 커버리지 부실 |
| DART 공시 피드 | ✅ | — | `disclosures.py`(A·B·C·D 유형), `stock_disclosures`, 매일 07:30 |
| 경제지표 캘린더(발표 일정) | ❌ | ❌ | FRED 시계열(실측값)만, FOMC·CPI 발표 *예정일* 없음 |
| 락업해제/보호예수 | ❌ | ❌ | 의무보유 만료일 수집 경로 없음 |
| IPO 일정 | ❌ | ❌ | 신규 상장 일정 수집 없음(편입 종목만 추적 구조) |
| 주주총회(AGM) | ❌ | ❌ | DART 주총소집공고 수집되나 예정일로 미활용 |
| 액면분할/합병 | ❌ | ❌ | split/merger 수집 없음 |

**갭·제안**
- 🔶 **KR 실적발표 예정일** — *medium* — Naver `earningCalendar` 또는 DART, `calendar_cache`에 통합. (기존 연동)
- 🔶 **배당락일 정확화** — *medium* — US `info.exDividendDate`, KR DART `alotMatter` 기준일. (기존)
- ❌ **경제지표 캘린더** — *medium* — FRED `/fred/release/dates` 또는 FOMC 정적 JSON, Calendar에 econ_event. (기존)
- ❌ **주주총회** — *low* — **기존 `stock_disclosures`에서 '주주총회소집공고' 필터+파싱만**(신규 소스 불필요). KR 가성비 좋음.
- ❌ **락업해제/IPO** — *low* — KR KIND API(공개·신규), US는 단기 부적합.
- ❌ **액면분할/합병** — *low* — US `t.splits`(기존 확장), KR DART 공시 필터.

### ⑧ 가격·기술 컨텍스트·정성
> 매물대·RSI·해자·AI 내러티브·뉴스 수집은 KR/US 공통 구현. 52주/EMA는 함수만 있고 미연결, 변동성/베타 전무, 뉴스 센티먼트 점수화 없음.

| 데이터포인트 | KR | US | 근거 (요약) |
|---|:--:|:--:|---|
| 매물대(Volume Profile) | ✅ | ✅ | `indicators.get_volume_profile`(POC/VAH/VAL), `PriceLevelChart` |
| RSI(일/주/월) | ✅ | ✅ | `indicators.get_timeframe_rsi`, `PriceLevelChart`/`HistoryTab` |
| 52주 고저·이동평균(EMA) | 🔶 | 🔶 | `get_support_resistance` 함수 존재하나 **report에 미연결**. 20일 고점만 표시 |
| 추세/모멘텀 | 🔶 | 🔶 | `recommendation/funnel`(return_pct 등) 발굴 내부값만, 리포트 상세 표면 없음 |
| 변동성/베타 | ❌ | ❌ | beta/HV/ATR 계산·저장 전무 |
| 해자(moat)·사업모델 | ✅ | ✅ | `tickers.moat`(Cowork enrich), `Sections.MoatSection` |
| AI 내러티브(리스크/공시/권고) | ✅ | ✅ | `tickers.risks/recent_disclosures/insights`(Cowork), 요약/리포트 탭 |
| 뉴스/센티먼트 | 🔶 | 🔶 | `scraper.get_news`(Naver/yfinance 제목+링크). 센티먼트 점수화 없음, 일배치 박제 |

**갭·제안**
- 🔶 **52주 고저·EMA 연결** — *medium* — 기존 `get_support_resistance`를 snapshot에 연결, 리포트 헤더/차트 노출. (기존 함수)
- 🔶 **추세 요약 카드** — *medium* — EMA 대비 위치·30일 수익률·골든/데드크로스 뱃지. (기존 지표 재활용)
- ❌ **변동성/베타** — *medium* — US `info.beta`(즉시), KR 자체계산(일봉 vs KOSPI OLS), HV는 일봉 stddev.
- 🔶 **뉴스 센티먼트** — *low* — 온디맨드 뉴스 연결로 최신성↑, 키워드 분류 뱃지, 시장 Fear&Greed(Alternative.me 신규).

---

## 3. 우선순위별 갭 종합

### 🔴 High (투자가치 높고 대부분 기존 데이터)
| 갭 | 축 | 데이터 가용성 |
|---|---|---|
| 영업/순이익률 | 재무 | KR Naver row5·6 / US 파생 — 즉시 |
| ROE | 재무 | KR Naver row7 / US `returnOnEquity` — 기존 |
| 부채/유동비율 | 재무 | KR Naver row8·9 / US balance sheet — 기존 |
| 영업CF·FCF | 재무 | US yfinance cash_flow(미사용) / KR DART |
| 동종업계 Peer PER/PBR | 밸류 | 경쟁사 루프 기존 + yfinance/FnGuide |
| 시장지수 밸류에이션(PER/CAPE) | 매크로 | US FRED CAPE(기존) / KR 신규 크롤 |

### 🟠 Medium
순이익 추이 · PSR · EV/EBITDA · 이자보상배율 · 컨센 추정치 보강 · 가이던스 구조화 · CAPEX/R&D · DPS 배당성장 이력 · 배당성향 · 배당락일 정확화 · US 기관 순매수 · US 공매도 비중 · US 내부자(Form4) · 구루 드릴다운 · 한국 경제지표 · 시장지수 레벨 · KR 실적발표 예정일 · 경제지표 캘린더 · 52주/EMA 연결 · 추세 요약 · 변동성/베타

### 🟡 Low
US forward 컨센 PER · PEG · DDM/DCF · 자산/자본 규모 · TAM · 자사주 매입 · 총주주환원율 · KR 공매도 잔량 차트 · US 5%룰 · 주총/락업/IPO/액면분할 · 뉴스 센티먼트

---

## 4. 추천 빌드 후보 (다음 fg-ask 씨앗)

각 후보는 독립적으로 그릴링·구축·봉인 가능한 단위입니다. 위 순위대로 후속 `forge ask`로 넘기면 됩니다.

### 후보 1 — 재무 건전성·수익성 지표 보강 🔴 (최우선)
- **무엇**: 순이익 추이·영업/순이익률·ROE·부채/유동비율·영업CF/FCF·이자보상배율을 수집·표시.
- **왜 최우선**: 펀더멘털 투자 핵심인데 거의 전무. **데이터가 이미 손안에 있음** — KR은 Naver finance API의 미추출 row(2·5·6·7·8·9), US는 yfinance에서 이미 접근 중인 cash_flow/balance_sheet/income_stmt 필드.
- **데이터**: 거의 전부 기존 연동(신규 소스는 KR 일부 DART 폴백 정도). 가성비 최고.
- **그릴링 포인트**: 어느 지표를 1차에 넣을지(ROIC·이자보상은 파싱 추가 부담), KR Naver row 인덱스 실검증, FinancialsChart 표시 방식(별도 % 축/탭).

### 후보 2 — 상대 밸류에이션 (Peer + 멀티플 보강) 🔴
- **무엇**: 경쟁사 카드에 PER/PBR 추가 + PSR/EV/EBITDA 멀티플 수집·표시.
- **왜**: "싼지 비싼지"의 비교 기준 부재. 경쟁사 루프(`report_generator.py:82`)가 이미 있어 확장 용이.
- **데이터**: US yfinance / KR FnGuide 기존(EV/EBITDA만 KR 신규 파싱 확인).

### 후보 3 — 시장지수 레벨·밸류에이션 (벤치마크) 🔴🟠
- **무엇**: KOSPI/S&P500 지수값·등락(`GET /api/market/indices`) + 지수 PER/CAPE.
- **왜**: 포트폴리오 vs 시장 비교, 시장 과열도 판단. 중장기 투자자 핵심 컨텍스트.
- **데이터**: 지수 레벨·CAPE는 US yfinance/FRED 기존, KR 지수 밸류는 신규 크롤 필요.

### 후보 4 — US 수급 보강 🟠
- **무엇**: US 기관 보유추이(yfinance institutional_holders)·공매도 비중(shortPercentOfFloat)·내부자(Form4) + 구루 보유 드릴다운(프론트).
- **왜**: KR 강점을 US로 대칭 확장. 기존 컴포넌트(InvestorTrend/ShortSell/InsiderTrades)가 market 분기 구조라 US 조건 추가 용이.
- **데이터**: yfinance 기존 + 구루는 `guru_managers` JSONB 재활용(백엔드 무변경).

### 후보 5 — 이벤트 캘린더 확장 🟠
- **무엇**: KR 실적발표 예정일(Naver/DART)·배당락일 정확화(exDividendDate/DART)·경제지표 발표 일정(FRED release)·주총(기존 공시피드 필터).
- **왜**: 촉매·리스크 관리 정보. KR 실적일/배당락 정확도가 현재 약점.
- **데이터**: 대부분 기존 DART/Naver/FRED 재사용. 주총은 기존 `stock_disclosures` 필터만으로 가능.

### 후보 6 — 가격·기술 표면 보강 🟠
- **무엇**: 52주 고저·EMA20/50/200 리포트 연결(`get_support_resistance` 이미 구현) + 추세 요약 카드 + 베타/변동성.
- **왜**: 기존 함수가 있는데 리포트에 미연결된 "꺼내 쓰면 되는" 갭.
- **데이터**: 기존 indicators 함수/일봉 재활용, US 베타는 yfinance 기존.

---

*분석 방법: 8축 병렬 감사 서브에이전트가 실제 코드(routers·services·app_schema·프론트 컴포넌트)·API_SPEC·CONTEXT에 그라운딩해 데이터포인트별 판정. task#110.*

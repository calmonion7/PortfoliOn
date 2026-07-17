import { useState, useEffect } from 'react'
import api from '../../api'
import Skeleton from '../ui/Skeleton'
import { ConsensusSummary, VolumeRsiSnapshot, BacklogSection, RsiTable, TechnicalStats } from './DetailTab'
import ConsensusChart from './ConsensusChart'
import FinancialsChart from './FinancialsChart'
import HistoryTab from './HistoryTab'
import { ReportSectionCompetitors, MoatSection, KeyResourceSection, GrowthPlanSection, RisksSection, RecentDisclosuresSection, InsightsSection } from './Sections'
import InvestorTrendSection from './InvestorTrendSection'
import ShortSellSection from './ShortSellSection'
import SupplySection from './SupplySection'
import LatestDisclosuresSection from './LatestDisclosuresSection'
import InsiderTradesSection from './InsiderTradesSection'
import UsSupplySection from './UsSupplySection'
import UsInsiderSection from './UsInsiderSection'
import GuruHoldersSection from './GuruHoldersSection'

const noop = () => {}

// 리포트 상세 탭(요약/지표/심층분석/히스토리) 공통 렌더. Reports.jsx 상세 뷰와 Ranking.jsx 모달이 공유.
// ETF는 표시 가능한 데이터만: 요약·심층분석 탭과 컨센서스/재무 서브탭 숨김 → 지표(기술·수급)+히스토리.
// 헤더·스크롤 컨테이너·로딩 위치는 호출부가 관리하고, 두 화면의 차이는 props로 흡수한다.
export default function ReportDetailTabs({
  summary,
  ticker,
  enrichedAt = null,
  loading = false,
  historyDates = [],
  historyMarket,
  onConsensusRefresh = noop,
  onTabChange,
}) {
  const [tab, setTab] = useState('summary')
  const [analysisSubTab, setAnalysisSubTab] = useState('consensus')
  // 라이브 뉴스 — null=아직 없음(스냅샷 news로 폴백), 배열=fetch 성공(빈 배열이면 폴백 유지)
  const [liveNews, setLiveNews] = useState(null)

  const isEtf = !!summary?.is_etf
  const analysisSub = isEtf ? 'technical' : analysisSubTab
  const detailTab = isEtf && tab === 'summary' ? 'analysis' : tab
  const market = summary?.market
  const histMarket = historyMarket ?? summary?.market ?? 'US'
  const hasRsi = [summary?.daily_rsi, summary?.weekly_rsi, summary?.monthly_rsi].some(r => r?.rsi != null)
  const news = liveNews?.length ? liveNews : summary?.news

  // 마운트/종목 전환 시 라이브 뉴스 fetch — 실패·빈값이면 news가 자동으로 스냅샷 summary.news 폴백 유지 (Ranking.jsx BasicInfo와 동일 패턴)
  useEffect(() => {
    setLiveNews(null)
    if (!ticker) return
    let cancelled = false
    api.get(`/api/stocks/${ticker}/news`, { params: { market: market || 'US' } })
      .then(({ data }) => { if (!cancelled) setLiveNews(data.news || []) })
      .catch(() => {})
    return () => { cancelled = true }
  }, [ticker, market])

  const content = (
    <>
      {loading && <Skeleton variant="chart" height={280} />}
      {!loading && detailTab === 'summary' && (
        summary
          ? (
            <div className="anim-fade-up" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <InsightsSection insights={summary.insights} />
              <ConsensusSummary summary={summary} ticker={ticker} onRefreshSuccess={onConsensusRefresh} />
              <VolumeRsiSnapshot summary={summary} chartOnly />
            </div>
          )
          : <p style={{ color: 'var(--text-3)', fontSize: 13 }}>요약 데이터가 없습니다.</p>
      )}
      {!loading && detailTab === 'analysis' && (
        summary
          ? (
            <div className="anim-fade-up" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {/* 하위 탭 바 — 메인 탭과 동일한 언어(.tab-btn.sm, 작은 변형)로 구분. ETF는 기술·수급만이라 숨김 */}
              {!isEtf && (
              <div style={{ display: 'flex', borderBottom: '1px solid var(--border)', alignSelf: 'stretch' }}>
                {[
                  { key: 'consensus', label: '컨센서스' },
                  { key: 'financials', label: '재무·수주' },
                  { key: 'technical', label: '기술·수급' },
                ].map(({ key, label }) => (
                  <button
                    key={key}
                    onClick={() => setAnalysisSubTab(key)}
                    className={`tab-btn sm${analysisSubTab === key ? ' active' : ''}`}
                    style={{ marginBottom: -1 }}
                  >
                    {label}
                  </button>
                ))}
              </div>
              )}
              {analysisSub === 'consensus' && (
                <ConsensusChart ticker={ticker} market={market} />
              )}
              {analysisSub === 'financials' && (
                <>
                  <FinancialsChart
                    financials={summary.financials}
                    financialsAnnual={summary.financials_annual}
                    market={market}
                  />
                  <BacklogSection ticker={ticker} market={market} />
                </>
              )}
              {analysisSub === 'technical' && (
                (summary.daily_rsi || market === 'KR')
                  ? (
                    <>
                      {/* RSI 있으면 RSI 예상 타점, 없으면(신규 상장 <14봉 등) 요약 탭과 동일한 매물대 차트 폴백 */}
                      {hasRsi
                        ? (
                          <RsiTable
                            dailyRsi={summary.daily_rsi}
                            weeklyRsi={summary.weekly_rsi}
                            monthlyRsi={summary.monthly_rsi}
                            price={summary.price}
                            vp={summary.volume_profile}
                            target={summary.target_mean}
                            market={market}
                          />
                        )
                        : <VolumeRsiSnapshot summary={summary} />}
                      <TechnicalStats summary={summary} />
                      {market === 'KR' && <SupplySection ticker={ticker} />}
                      {market === 'KR' && <InvestorTrendSection ticker={ticker} />}
                      {market === 'KR' && <ShortSellSection ticker={ticker} />}
                      {market !== 'KR' && <UsSupplySection ticker={ticker} market={market} />}
                      {market !== 'KR' && <UsInsiderSection ticker={ticker} market={market} />}
                      {market !== 'KR' && <GuruHoldersSection ticker={ticker} market={market} />}
                    </>
                  )
                  : <p style={{ color: 'var(--text-3)', fontSize: 13 }}>기술·수급 데이터가 없습니다.</p>
              )}
            </div>
          )
          : <p style={{ color: 'var(--text-3)', fontSize: 13 }}>지표 데이터가 없습니다.</p>
      )}
      {!loading && detailTab === 'report' && (
        summary
          ? (
            <div className="anim-fade-up" style={{ padding: '0 4px' }}>
              {enrichedAt && (
                <div style={{ marginBottom: 14, fontSize: 11, color: 'var(--text-3)', display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ color: 'var(--color-success)', fontWeight: 600 }}>✓</span>
                  AI 분석 업데이트: <span className="mono tnum">{new Date(enrichedAt).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}</span>
                </div>
              )}
              {!enrichedAt && (
                <div style={{ marginBottom: 14, fontSize: 11, color: 'var(--warn)', display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span>⚠</span> AI 분석 미업데이트 (enrich API 미실행)
                </div>
              )}
              <ReportSectionCompetitors
                competitors={summary.competitors_data}
                market={market}
                ticker={ticker}
              />
              <MoatSection moat={summary.moat} />
              <KeyResourceSection key_resource={summary.key_resource} />
              <GrowthPlanSection growth_plan={summary.growth_plan} />
              <RisksSection risks={summary.risks} />
              <RecentDisclosuresSection
                disclosures={summary.recent_disclosures}
                news={news}
              />
              <LatestDisclosuresSection ticker={ticker} market={market} />
              <InsiderTradesSection ticker={ticker} market={market} />
            </div>
          )
          : <p style={{ color: 'var(--text-3)', fontSize: 13 }}>심층분석 데이터가 없습니다.</p>
      )}
      {!loading && detailTab === 'history' && (
        <HistoryTab ticker={ticker} dates={historyDates} market={histMarket} />
      )}
    </>
  )

  return (
    <>
      <div style={{ display: 'flex', borderBottom: '1px solid var(--border)', marginBottom: 16, marginTop: 4 }}>
        {[
          { key: 'summary', label: '📊 요약' },
          { key: 'analysis', label: '📈 지표' },
          { key: 'report', label: '📝 심층분석' },
          { key: 'history', label: '📅 히스토리' },
        ].filter(({ key }) => !(isEtf && (key === 'report' || key === 'summary'))).map(({ key, label }) => (
          <button
            key={key}
            onClick={() => { setTab(key); onTabChange?.(key) }}
            className={`tab-btn${detailTab === key ? ' active' : ''}`}
            style={{ padding: '6px 16px', fontSize: 12, marginBottom: -1 }}
          >
            {label}
          </button>
        ))}
      </div>
      {content}
    </>
  )
}

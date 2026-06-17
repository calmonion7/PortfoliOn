import { useState } from 'react'
import LoadingSpinner from '../LoadingSpinner'
import { ConsensusSummary, VolumeRsiSnapshot, BacklogSection, RsiTable } from './DetailTab'
import ConsensusChart from './ConsensusChart'
import FinancialsChart from './FinancialsChart'
import HistoryTab from './HistoryTab'
import { ReportSectionCompetitors, MoatSection, GrowthPlanSection, RisksSection, RecentDisclosuresSection, InsightsSection } from './Sections'
import InvestorTrendSection from './InvestorTrendSection'
import ShortSellSection from './ShortSellSection'
import SupplySection from './SupplySection'
import LatestDisclosuresSection from './LatestDisclosuresSection'
import InsiderTradesSection from './InsiderTradesSection'

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
  contentMaxHeight,
}) {
  const [tab, setTab] = useState('summary')
  const [analysisSubTab, setAnalysisSubTab] = useState('consensus')

  const isEtf = !!summary?.is_etf
  const analysisSub = isEtf ? 'technical' : analysisSubTab
  const detailTab = isEtf && tab === 'summary' ? 'analysis' : tab
  const market = summary?.market
  const histMarket = historyMarket ?? summary?.market ?? 'US'

  const content = (
    <>
      {loading && <LoadingSpinner />}
      {!loading && detailTab === 'summary' && (
        summary
          ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <InsightsSection insights={summary.insights} />
              <ConsensusSummary summary={summary} ticker={ticker} onRefreshSuccess={onConsensusRefresh} />
              <VolumeRsiSnapshot summary={summary} />
            </div>
          )
          : <p style={{ color: 'var(--text-3)', fontSize: 13 }}>요약 데이터가 없습니다.</p>
      )}
      {!loading && detailTab === 'analysis' && (
        summary
          ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {/* 하위 탭 바 (세그먼트형, 메인 탭과 구분) — ETF는 기술·수급만이라 숨김 */}
              {!isEtf && (
              <div style={{ display: 'flex', gap: 4, alignSelf: 'flex-start' }}>
                {[
                  { key: 'consensus', label: '컨센서스' },
                  { key: 'financials', label: '재무·수주' },
                  { key: 'technical', label: '기술·수급' },
                ].map(({ key, label }) => (
                  <button
                    key={key}
                    onClick={() => setAnalysisSubTab(key)}
                    style={{
                      padding: '5px 14px', fontSize: 12, borderRadius: 6, cursor: 'pointer',
                      background: analysisSubTab === key ? 'var(--accent-soft)' : 'transparent',
                      color: analysisSubTab === key ? 'var(--accent)' : 'var(--text-3)',
                      border: `1px solid ${analysisSubTab === key ? 'var(--accent)' : 'var(--border)'}`,
                      fontWeight: analysisSubTab === key ? 600 : 400,
                    }}
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
                      {summary.daily_rsi && (
                        <RsiTable
                          dailyRsi={summary.daily_rsi}
                          weeklyRsi={summary.weekly_rsi}
                          monthlyRsi={summary.monthly_rsi}
                          price={summary.price}
                          vp={summary.volume_profile}
                          target={summary.target_mean}
                          market={market}
                        />
                      )}
                      {market === 'KR' && <SupplySection ticker={ticker} />}
                      {market === 'KR' && <InvestorTrendSection ticker={ticker} />}
                      {market === 'KR' && <ShortSellSection ticker={ticker} />}
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
            <div style={{ padding: '0 4px' }}>
              {enrichedAt && (
                <div style={{ marginBottom: 14, fontSize: 11, color: 'var(--text-3)', display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ color: '#81c784', fontWeight: 600 }}>✓</span>
                  AI 분석 업데이트: {new Date(enrichedAt).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}
                </div>
              )}
              {!enrichedAt && (
                <div style={{ marginBottom: 14, fontSize: 11, color: '#ffb74d', display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span>⚠</span> AI 분석 미업데이트 (enrich API 미실행)
                </div>
              )}
              <ReportSectionCompetitors
                competitors={summary.competitors_data}
                market={market}
                ticker={ticker}
              />
              <MoatSection moat={summary.moat} />
              <GrowthPlanSection growth_plan={summary.growth_plan} />
              <RisksSection risks={summary.risks} />
              <RecentDisclosuresSection
                disclosures={summary.recent_disclosures}
                news={summary.news}
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
      {contentMaxHeight ? <div style={{ maxHeight: contentMaxHeight, overflowY: 'auto' }}>{content}</div> : content}
    </>
  )
}

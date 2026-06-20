import { useState } from 'react'
import { trackEvent } from '../utils/analytics'
import usePortfolioData from '../hooks/usePortfolioData'
import PriceFreshness from '../components/portfolio/PriceFreshness'
import { krFreshnessLabel } from '../utils/marketHours'
import Skeleton from '../components/ui/Skeleton'
import DashboardCard from '../components/portfolio/DashboardCard'
import FlashValue from '../components/portfolio/FlashValue'
import { fmt } from '../components/ui/icons'
import useIsMobile from '../hooks/useIsMobile'
import SectorTab from './SectorTab'
import MacroTab from './MacroTab'
import Analytics from './Analytics'

const DividendSummary = ({ totals }) => {
  if (!totals || !totals.total_expected_annual_income_krw) return null
  const income = Math.round(totals.total_expected_annual_income_krw).toLocaleString('ko-KR')
  const avgYield = totals.avg_dividend_yield
  return (
    <div style={{
      display: 'flex', flexWrap: 'wrap', gap: 24, padding: '12px 16px', marginBottom: 12,
      background: 'var(--bg-elev)', border: '1px solid var(--border)', borderRadius: 10,
    }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        <span style={{ fontSize: 11, color: 'var(--text-3)' }}>총 연 예상배당</span>
        <span className="tnum" style={{ fontSize: 16, fontWeight: 700 }}>₩{income}</span>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        <span style={{ fontSize: 11, color: 'var(--text-3)' }}>평균 배당수익률</span>
        <span className="tnum" style={{ fontSize: 16, fontWeight: 700 }}>
          {avgYield != null ? `${avgYield.toFixed(2)}%` : '—'}
        </span>
      </div>
    </div>
  )
}

const DashboardGrid = ({ cards, totals, loading, tick }) => {
  if (loading) return <Skeleton variant="card" count={6} />
  if (!cards.length) return <p style={{ color: 'var(--text-3)', textAlign: 'center', padding: 40 }}>보유종목이 없습니다.</p>
  return (
    <>
      <DividendSummary totals={totals} />
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 12, padding: '4px 0' }}>
        {cards.map(item => <DashboardCard key={item.ticker} item={item} tick={tick} />)}
      </div>
    </>
  )
}

export default function Portfolio() {
  const isMobile = useIsMobile()
  const [tab, setTab] = useState('dash')
  const [analysisTab, setAnalysisTab] = useState('sector')

  const { stocks, watchlist, dashboardCards, dashboardTotals, dashboardLoading, fx, priceTick, lastUpdated, fetchDashboard } = usePortfolioData()

  // KPI 계산
  const toKrw = (h, price) => (price || 0) * (h.quantity || 0) * ((h.market || 'US') === 'KR' ? 1 : fx)
  const totalCost = stocks.reduce((sum, h) => sum + toKrw(h, h.avg_cost || 0), 0)
  const hasPrice = stocks.some(h => h.current_price != null)
  const totalValue = hasPrice ? stocks.reduce((sum, h) => sum + toKrw(h, h.current_price ?? h.avg_cost ?? 0), 0) : null
  const totalPnl = totalValue != null ? totalValue - totalCost : null
  const totalPnlPct = totalPnl != null && totalCost > 0 ? totalPnl / totalCost * 100 : null
  const totalValueUsd = stocks.length > 0 ? (totalValue ?? totalCost) / fx : null

  if (isMobile) return (
    <>
      <header className="appbar">
        <h1>포트폴리오</h1>
      </header>

      <div className="hero">
        <div className="label">{totalValue != null ? '평가금액' : '투자 원가'} · {new Date().toLocaleDateString('ko-KR', { month: 'long', day: 'numeric' })} · {krFreshnessLabel()}</div>
        <FlashValue as="div" className="val tnum" value={totalValue ?? totalCost} tick={priceTick}>₩{fmt(totalValue ?? totalCost, 0)}</FlashValue>
        {totalPnl != null ? (
          <div className={`delta tnum ${totalPnl >= 0 ? 'up' : 'down'}`}>
            {totalPnl >= 0 ? '+' : ''}₩{fmt(Math.abs(totalPnl), 0)}
            {totalPnlPct != null && <span style={{ marginLeft: 6, fontSize: 13 }}>({totalPnlPct >= 0 ? '+' : ''}{totalPnlPct.toFixed(1)}%)</span>}
          </div>
        ) : (
          <div className="delta muted tnum">{stocks.length}개 보유 · 관심 {watchlist.length}</div>
        )}
        {totalPnl != null && (
          <div className="delta muted tnum" style={{ fontSize: 12, marginTop: 2 }}>{stocks.length}개 보유 · 원가 ₩{fmt(totalCost, 0)}</div>
        )}
        {totalValueUsd != null && (
          <div className="delta muted tnum" style={{ fontSize: 12, marginTop: 1 }}>
            ${fmt(totalValueUsd, 2)} · 기준환율 ₩{fmt(fx, 0)}
          </div>
        )}
      </div>

      <div className="seg-pad">
        <div className="seg">
          <button className={tab === 'dash' ? 'is-active' : ''} onClick={() => { setTab('dash'); fetchDashboard(); trackEvent('tab_dash') }}>
            대시보드
          </button>
          <button className={tab === 'analysis' ? 'is-active' : ''} onClick={() => { setTab('analysis'); trackEvent('tab_analysis') }}>
            분석
          </button>
        </div>
      </div>

      {tab === 'dash' && (
        <div style={{ padding: '0 20px' }}>
          <DashboardGrid cards={dashboardCards} totals={dashboardTotals} loading={dashboardLoading} tick={priceTick} />
        </div>
      )}

      {tab === 'analysis' && (
        <>
          <div className="seg-pad">
            <div className="seg">
              <button className={analysisTab === 'sector' ? 'is-active' : ''} onClick={() => setAnalysisTab('sector')}>섹터</button>
              <button className={analysisTab === 'macro' ? 'is-active' : ''} onClick={() => setAnalysisTab('macro')}>매크로</button>
              <button className={analysisTab === 'correlation' ? 'is-active' : ''} onClick={() => setAnalysisTab('correlation')}>상관관계</button>
            </div>
          </div>
          <div className="m-page">
            {analysisTab === 'sector' && <SectorTab />}
            {analysisTab === 'macro' && <MacroTab />}
            {analysisTab === 'correlation' && <Analytics />}
          </div>
        </>
      )}
    </>
  )

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1 className="page-title">내 포트폴리오</h1>
          <p className="page-sub">{new Date().toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric' })} · <PriceFreshness lastUpdated={lastUpdated} /></p>
        </div>
      </div>

      {/* KPI 4종 */}
      <div className="kpi-row">
        <div className="kpi">
          <div className="label">{totalValue != null ? '평가금액' : '투자 원가'}</div>
          <FlashValue as="div" className="val tnum" value={totalValue ?? totalCost} tick={priceTick}>₩{fmt(totalValue ?? totalCost, 0)}</FlashValue>
          {totalPnl != null && (
            <div className={`delta tnum ${totalPnl >= 0 ? 'up' : 'down'}`} style={{ marginTop: 4 }}>
              {totalPnl >= 0 ? '+' : ''}₩{fmt(Math.abs(totalPnl), 0)}
              {totalPnlPct != null && <span style={{ marginLeft: 5, fontSize: 12 }}>({totalPnlPct >= 0 ? '+' : ''}{totalPnlPct.toFixed(1)}%)</span>}
            </div>
          )}
          {totalValue != null && (
            <div className="delta muted tnum" style={{ fontSize: 12, marginTop: 2 }}>원가 ₩{fmt(totalCost, 0)}</div>
          )}
          {totalValueUsd != null && (
            <div className="delta muted tnum" style={{ fontSize: 12, marginTop: 1 }}>
              ${fmt(totalValueUsd, 2)} · 기준환율 ₩{fmt(fx, 0)}
            </div>
          )}
        </div>
        <div className="kpi">
          <div className="label">보유 종목</div>
          <div className="val tnum">{stocks.length}</div>
          <div className="delta muted">
            미국 {stocks.filter(h => (h.market || 'US') === 'US').length} · 한국 {stocks.filter(h => h.market === 'KR').length}
          </div>
        </div>
        <div className="kpi">
          <div className="label">관심 종목</div>
          <div className="val tnum">{watchlist.length}</div>
        </div>
        <div className="kpi">
          <div className="label">총 종목</div>
          <div className="val tnum">{stocks.length + watchlist.length}</div>
        </div>
      </div>

      {/* 세그먼트 탭 */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
        <div className="tabs">
          <button className={tab === 'dash' ? 'is-active' : ''} onClick={() => { setTab('dash'); fetchDashboard(); trackEvent('tab_dash') }}>대시보드</button>
          <button className={tab === 'analysis' ? 'is-active' : ''} onClick={() => { setTab('analysis'); trackEvent('tab_analysis') }}>분석</button>
        </div>
        {tab === 'dash' && (
          <button className="btn" onClick={() => fetchDashboard({ invalidate: true })} disabled={dashboardLoading}>↺ 새로고침</button>
        )}
      </div>

      {/* 대시보드 탭 */}
      {tab === 'dash' && <DashboardGrid cards={dashboardCards} totals={dashboardTotals} loading={dashboardLoading} tick={priceTick} />}

      {tab === 'analysis' && (
        <div>
          <div className="tabs" style={{ marginBottom: 20 }}>
            <button className={analysisTab === 'sector' ? 'is-active' : ''} onClick={() => setAnalysisTab('sector')}>섹터</button>
            <button className={analysisTab === 'macro' ? 'is-active' : ''} onClick={() => setAnalysisTab('macro')}>매크로</button>
            <button className={analysisTab === 'correlation' ? 'is-active' : ''} onClick={() => setAnalysisTab('correlation')}>상관관계</button>
          </div>
          {analysisTab === 'sector' && <SectorTab />}
          {analysisTab === 'macro' && <MacroTab />}
          {analysisTab === 'correlation' && <Analytics />}
        </div>
      )}
    </div>
  )
}

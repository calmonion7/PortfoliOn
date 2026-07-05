import { useState, useEffect } from 'react'
import { trackEvent } from '../utils/analytics'
import usePortfolioData from '../hooks/usePortfolioData'
import PriceFreshness from '../components/portfolio/PriceFreshness'
import { krFreshnessLabel } from '../utils/marketHours'
import Skeleton from '../components/ui/Skeleton'
import DashboardCard from '../components/portfolio/DashboardCard'
import FlashValue from '../components/portfolio/FlashValue'
import { fmt } from '../components/ui/icons'
import Button from '../components/ui/Button'
import useIsMobile from '../hooks/useIsMobile'
import SectorTab from './SectorTab'
import MacroTab from './MacroTab'
import Analytics from './Analytics'
import RebalanceTab from './RebalanceTab'
import ExposureTab from './ExposureTab'

// 평가금액 한국식 억/만 축약 (예: 84,975,545 → ₩8,498만, 1억 이상은 ₩X.X억)
const fmtKrwCompact = (n) => {
  if (n == null || !isFinite(n)) return '₩—'
  const sign = n < 0 ? '-' : ''
  const v = Math.abs(n)
  if (v >= 1e8) return `${sign}₩${(v / 1e8).toFixed(1)}억`
  if (v >= 1e4) return `${sign}₩${Math.round(v / 1e4).toLocaleString('ko-KR')}만`
  return `${sign}₩${Math.round(v).toLocaleString('ko-KR')}`
}

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

const DashboardGrid = ({ cards, totals, loading, tick, hasHoldings, retriesExhausted, onRetry }) => {
  if (loading) return <Skeleton variant="card" count={6} />
  if (!cards.length) {
    // 재시도 소진 + 에러: 사용자에게 복구 수단 제공
    if (hasHoldings && retriesExhausted) return (
      <div style={{ textAlign: 'center', padding: 40 }}>
        <p style={{ color: 'var(--text-3)', marginBottom: 12 }}>대시보드를 불러오지 못했습니다.</p>
        <Button variant="secondary" size="sm" onClick={onRetry}>다시 시도</Button>
      </div>
    )
    // 헤더 N ↔ 그리드 빈 모순 제거(task#102): 재시도 중엔 Skeleton
    if (hasHoldings) return <Skeleton variant="card" count={6} />
    return <p style={{ color: 'var(--text-3)', textAlign: 'center', padding: 40 }}>보유 종목이 없습니다. 리서치 탭에서 종목을 추가해 보세요.</p>
  }
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

  // heal 카운터는 state(렌더-reactive): ref이면 소진 판정이 dashboardError 갱신 타이밍에 결합돼
  // 에러카드가 누락될 수 있고(리뷰 major), 리셋만으로는 effect가 재발화하지 않는다.
  const [dashHealTries, setDashHealTries] = useState(0)
  useEffect(() => { fetchDashboard() }, [fetchDashboard])   // 마운트 시(dash가 기본탭) 그리드 fetch
  useEffect(() => {
    // 헤더 N인데 그리드 빈 = 첫 fetch가 일시 실패(콜드 빌드 throw 등, task#102) → bounded 재시도.
    // one-shot이 아니라 최대 3회 — 콜드 실패에 한 방 헛쓰고 포기하던 회귀(재네비 전까지 stuck) 차단.
    if (!dashboardLoading && dashboardCards.length === 0 && stocks.length > 0 && dashHealTries < 3) {
      setDashHealTries(t => t + 1)
      fetchDashboard({ invalidate: true })
    }
  }, [dashboardLoading, dashboardCards.length, stocks.length, dashHealTries, fetchDashboard])

  const dashRetriesExhausted = dashHealTries >= 3
  // 리셋만 — heal effect가 fetch를 주도해 클릭당 중복 fetch(1 direct + 3 heal) 없이 재시도 루프 재가동
  const handleDashRetry = () => setDashHealTries(0)

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
        <FlashValue as="div" className="val tnum" value={totalValue ?? totalCost} tick={priceTick} title={`₩${Math.round(totalValue ?? totalCost).toLocaleString('ko-KR')}`}>{fmtKrwCompact(totalValue ?? totalCost)}</FlashValue>
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
        <div style={{ padding: '0 20px 100px' }}>
          <DashboardGrid cards={dashboardCards} totals={dashboardTotals} loading={dashboardLoading} tick={priceTick} hasHoldings={stocks.length > 0} retriesExhausted={dashRetriesExhausted} onRetry={handleDashRetry} />
        </div>
      )}

      {tab === 'analysis' && (
        <>
          <div className="seg-pad">
            <div className="seg">
              <button className={analysisTab === 'sector' ? 'is-active' : ''} onClick={() => setAnalysisTab('sector')}>섹터</button>
              <button className={analysisTab === 'macro' ? 'is-active' : ''} onClick={() => setAnalysisTab('macro')}>매크로</button>
              <button className={analysisTab === 'correlation' ? 'is-active' : ''} onClick={() => setAnalysisTab('correlation')}>상관관계</button>
              <button className={analysisTab === 'rebalance' ? 'is-active' : ''} onClick={() => setAnalysisTab('rebalance')}>리밸런싱</button>
              <button className={analysisTab === 'exposure' ? 'is-active' : ''} onClick={() => setAnalysisTab('exposure')}>노출</button>
            </div>
          </div>
          <div className="m-page">
            {analysisTab === 'sector' && <SectorTab />}
            {analysisTab === 'macro' && <MacroTab />}
            {analysisTab === 'correlation' && <Analytics />}
            {analysisTab === 'rebalance' && <RebalanceTab />}
            {analysisTab === 'exposure' && <ExposureTab />}
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
          <FlashValue as="div" className="val tnum" value={totalValue ?? totalCost} tick={priceTick} title={`₩${Math.round(totalValue ?? totalCost).toLocaleString('ko-KR')}`}>{fmtKrwCompact(totalValue ?? totalCost)}</FlashValue>
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
          <div className="delta muted">
            미국 {watchlist.filter(h => (h.market || 'US') === 'US').length} · 한국 {watchlist.filter(h => h.market === 'KR').length}
          </div>
        </div>
        <div className="kpi">
          <div className="label">총 종목</div>
          <div className="val tnum">{stocks.length + watchlist.length}</div>
          <div className="delta muted">보유 {stocks.length} · 관심 {watchlist.length}</div>
        </div>
      </div>

      {/* 세그먼트 탭 — 새로고침 액션은 탭바와 분리(우측 icon-only ui/Button) */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
        <div className="tabs">
          <button className={tab === 'dash' ? 'is-active' : ''} onClick={() => { setTab('dash'); fetchDashboard(); trackEvent('tab_dash') }}>대시보드</button>
          <button className={tab === 'analysis' ? 'is-active' : ''} onClick={() => { setTab('analysis'); trackEvent('tab_analysis') }}>분석</button>
        </div>
        {tab === 'dash' && (
          <Button
            variant="ghost"
            size="sm"
            iconOnly
            icon="↺"
            onClick={() => fetchDashboard({ invalidate: true })}
            disabled={dashboardLoading}
            loading={dashboardLoading}
            title="새로고침"
            aria-label="새로고침"
            style={{ marginLeft: 'auto' }}
          />
        )}
      </div>

      {/* 대시보드 탭 */}
      {tab === 'dash' && <DashboardGrid cards={dashboardCards} totals={dashboardTotals} loading={dashboardLoading} tick={priceTick} hasHoldings={stocks.length > 0} retriesExhausted={dashRetriesExhausted} onRetry={handleDashRetry} />}

      {tab === 'analysis' && (
        <div>
          <div className="tabs" style={{ marginBottom: 20 }}>
            <button className={analysisTab === 'sector' ? 'is-active' : ''} onClick={() => setAnalysisTab('sector')}>섹터</button>
            <button className={analysisTab === 'macro' ? 'is-active' : ''} onClick={() => setAnalysisTab('macro')}>매크로</button>
            <button className={analysisTab === 'correlation' ? 'is-active' : ''} onClick={() => setAnalysisTab('correlation')}>상관관계</button>
            <button className={analysisTab === 'rebalance' ? 'is-active' : ''} onClick={() => setAnalysisTab('rebalance')}>리밸런싱</button>
            <button className={analysisTab === 'exposure' ? 'is-active' : ''} onClick={() => setAnalysisTab('exposure')}>노출</button>
          </div>
          {analysisTab === 'sector' && <SectorTab />}
          {analysisTab === 'macro' && <MacroTab />}
          {analysisTab === 'correlation' && <Analytics />}
          {analysisTab === 'rebalance' && <RebalanceTab />}
          {analysisTab === 'exposure' && <ExposureTab />}
        </div>
      )}
    </div>
  )
}

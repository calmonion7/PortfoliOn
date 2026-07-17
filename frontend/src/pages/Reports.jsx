import { useState, useEffect } from 'react'
import api from '../api'
import { useAuth } from '../contexts/AuthContext'
import useReportList from '../hooks/useReportList'
import useReportFilters from '../hooks/useReportFilters'
import useStockManagement from '../hooks/useStockManagement'
import useReportGeneration from '../hooks/useReportGeneration'
import usePortfolioData from '../hooks/usePortfolioData'
import useIsMobile from '../hooks/useIsMobile'
import { Plus } from '../components/ui/icons'
import Skeleton from '../components/ui/Skeleton'
import StockModal from '../components/StockModal'
import PromoteModal from '../components/PromoteModal'
import { useToast } from '../components/Toast'
import ReportDetailTabs from '../components/reports/ReportDetailTabs'
import StockCard from '../components/reports/StockCard'
import TickerListItem from '../components/reports/TickerListItem'
import ReportFilters from '../components/reports/ReportFilters'
import ReportDetailHeader from '../components/reports/ReportDetailHeader'
import { trackEvent } from '../utils/analytics'
import { SketchEmpty } from '../components/sketches'






export default function Reports({ initialTicker = null }) {
  const { role } = useAuth() || { role: 'user' }
  const isAdmin = role === 'admin'
  const { showToast } = useToast()
  const isMobile = useIsMobile()
  // S3(#80): 모바일 카드 액션 버튼 터치타깃 ≥44×44px — 패딩으로 클릭영역만 확보(아이콘 크기 유지)
  const touchStyle = isMobile ? { minWidth: 44, minHeight: 44, padding: '0 8px' } : undefined

  const {
    reportList, listLoading,
    guruMap, fetchList, applyList,
    holdingsCount, watchlistCount,
    watchlistWarnCount, watchlistLowCount, watchlistHighCount,
    _targetPct, _hasWarning, _isUngenerated,
    ungeneratedTickers, ungeneratedCount,
  } = useReportList()

  const { generating, genProgress, generateOne, generateBatch, cleanup } = useReportGeneration({ onApplyList: applyList })

  const { stocks, watchlist, fetchAll } = usePortfolioData()

  // ticker(대문자)→보유/관심 항목 맵 — reportList 키가 대문자라 정규화해 맞춘다
  const holdingMap = {}
  for (const h of stocks) holdingMap[h.ticker?.toUpperCase()] = h
  const watchMap = {}
  for (const w of watchlist) watchMap[w.ticker?.toUpperCase()] = w

  // 보유 카드 라이브 손익 — current_price(라이브)·avg_cost·quantity 모두 있을 때만
  const pnlOf = (ticker, market) => {
    const h = holdingMap[ticker?.toUpperCase()]
    if (!h || h.current_price == null || h.avg_cost == null || h.quantity == null) return null
    const ccy = (market || h.market || 'US') === 'KR' ? '₩' : '$'
    const dec = (market || h.market || 'US') === 'KR' ? 0 : 2
    const pnl = (h.current_price - h.avg_cost) * h.quantity
    const pnlPct = h.avg_cost ? (h.current_price - h.avg_cost) / h.avg_cost * 100 : null
    return { ccy, dec, pnl, pnlPct, quantity: h.quantity, avg_cost: h.avg_cost }
  }

  const [selected, setSelected] = useState({ ticker: null, date: null })
  const [detail, setDetail] = useState({ summary: null, enriched_at: null })
  const [loading, setLoading] = useState(false)
  const [activeTab, setActiveTab] = useState('holdings')
  const [othersData, setOthersData] = useState(null)
  const [othersLoading, setOthersLoading] = useState(false)
  const [view, setView] = useState('list')
  const [detailRefreshKey] = useState(0)

  // 필터/정렬 파생 — useReportFilters 훅으로 추출(R4 part 1/2, ADR-0019)
  const {
    activeEntries, tabEntries,
    mCountAll, mCountKR, mCountUS,
    sortCol, handleSort, sortArrow,
    marketFilter, setMarketFilter,
    watchlistSub, setWatchlistSub,
  } = useReportFilters({ reportList, othersData, activeTab, _targetPct, _hasWarning, _isUngenerated })

  // 종목 관리(추가/편집/삭제/승격) — useStockManagement 훅으로 추출(R4 part 2/2, ADR-0019)
  const {
    modalOpen, setModalOpen,
    editing, setEditing,
    addMode,
    promoteTarget, setPromoteTarget,
    mutError,
    handleSave, handleDelete, handleGlobalDelete, handlePromote, handlePinToggle, openEdit, openAdd,
  } = useStockManagement({ holdingMap, watchMap, fetchList, fetchAll, showToast, activeTab, setActiveTab, refreshOthers: () => setOthersData(null) })

  useEffect(() => {
    if (activeTab !== 'others' || !isAdmin || othersData !== null) return
    setOthersLoading(true)
    api.get('/api/report/list?scope=all')
      .then(({ data }) => {
        const all = data.stocks ?? data
        setOthersData(Object.fromEntries(Object.entries(all).filter(([, v]) => !v.is_mine)))
      })
      .finally(() => setOthersLoading(false))
  }, [activeTab, isAdmin, othersData])

  useEffect(() => {
    if (!selected.ticker || !selected.date) return
    setLoading(true)
    api.get(`/api/report/${selected.ticker}/${selected.date}`)
      .then(({ data }) => setDetail({ summary: data.summary, enriched_at: data.enriched_at || null }))
      .finally(() => setLoading(false))
  }, [selected, detailRefreshKey])

  const openDetail = (ticker, date) => {
    setSelected({ ticker, date })
    setView('detail')
    trackEvent('report_view_open', { ticker })
  }

  // 추천 탭 '분석 보기' 딥링크 — 목록 로드 후 해당 종목 최신 리포트 상세로 자동 진입 (task#131)
  useEffect(() => {
    if (!initialTicker || listLoading) return
    const t = initialTicker.toUpperCase()
    const dates = reportList[t]?.dates
    if (dates?.length) openDetail(t, dates[0])
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialTicker, listLoading])

  useEffect(() => cleanup, [cleanup])

  useEffect(() => {
    if (activeTab === 'ungenerated' && ungeneratedCount === 0) setActiveTab('holdings')
  }, [ungeneratedCount, activeTab])

  return (
    <>
    {mutError && <p style={{ color: 'var(--color-error)', fontSize: 12, marginTop: 0 }}>{mutError}</p>}
    <div className="reports-filters" data-view={view}>
      <ReportFilters
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        holdingsCount={holdingsCount}
        watchlistCount={watchlistCount}
        ungeneratedCount={ungeneratedCount}
        isAdmin={isAdmin}
        othersData={othersData}
        watchlistSub={watchlistSub}
        setWatchlistSub={setWatchlistSub}
        watchlistLowCount={watchlistLowCount}
        watchlistHighCount={watchlistHighCount}
        watchlistWarnCount={watchlistWarnCount}
        mCountAll={mCountAll}
        mCountKR={mCountKR}
        mCountUS={mCountUS}
        marketFilter={marketFilter}
        setMarketFilter={setMarketFilter}
        listLoading={listLoading}
        ungeneratedTickers={ungeneratedTickers}
        reportList={reportList}
        generating={generating}
        genProgress={genProgress}
        generateBatch={generateBatch}
        tabEntries={tabEntries}
      />
    </div>
    <div className="reports-layout" data-view={view}>
      {/* 좌측 사이드바 */}
      <div className="reports-sidebar">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
          <h3 style={{ color: 'var(--text)', margin: 0 }}>리포트 목록</h3>
        </div>
        {(activeTab === 'others' ? othersLoading : listLoading)
          ? <Skeleton variant="row" count={8} />
          : (activeEntries.length === 0)
            ? <p style={{ color: 'var(--text-3)', fontSize: 12 }}>리포트 없음</p>
            : null
        }
        <div className="anim-stagger" style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {!(activeTab === 'others' ? othersLoading : listLoading) && activeEntries.map(([t, info]) => (
            <TickerListItem
              key={t}
              ticker={t}
              info={info}
              selected={selected}
              view={view}
              pnl={pnlOf(t, info.summary?.market || info.market)}
              guruMap={guruMap}
              isAdmin={isAdmin}
              generating={generating}
              genProgress={genProgress}
              touchStyle={touchStyle}
              openDetail={openDetail}
              generateOne={generateOne}
              openEdit={openEdit}
              handleDelete={handleDelete}
              handleGlobalDelete={handleGlobalDelete}
              setPromoteTarget={setPromoteTarget}
              handlePinToggle={handlePinToggle}
            />
          ))}
        </div>
      </div>

      {/* 우측 패널 */}
      <div className="reports-main">
        {view === 'list' ? (
          /* 목록화면 */
          (activeTab === 'others' ? othersLoading : listLoading) ? (
            <div className="stock-card-grid">
              <Skeleton variant="row" count={8} />
            </div>
          ) : (
            <>
              {activeEntries.length === 0 ? (
                <div style={{ textAlign: 'center', marginTop: 60, color: 'var(--text-3)', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10 }}>
                  <div className="sketch-draw"><SketchEmpty size={140} /></div>
                  <p style={{ margin: 0 }}>리포트가 없습니다.</p>
                  {activeTab !== 'others' && <p style={{ margin: 0, fontSize: 13 }}>설정 페이지에서 "지금 생성" 버튼을 눌러 첫 리포트를 만드세요.</p>}
                </div>
              ) : (
                <>
                  <div className="card-list-header">
                    <span>종목</span>
                    <span className={`sort-col${sortCol === 'chg' ? ' active' : ''}`} onClick={() => handleSort('chg')}>현재가 / 고점{sortArrow('chg')}</span>
                    <span className={`sort-col${sortCol === 'gap' ? ' active' : ''}`} onClick={() => handleSort('gap')}>목표가 / 컨센서스{sortArrow('gap')}</span>
                    <span>밸류</span>
                    <span className={`sort-col${sortCol === 'rsi' ? ' active' : ''}`} onClick={() => handleSort('rsi')}>RSI{sortArrow('rsi')}<br/><small>일/주/월</small></span>
                    <span style={{ color: 'var(--semantic-buy)' }} title="일봉 RSI가 20·25·30(과매도 기준선)에 도달할 때의 예상 가격">RSI 매수<br/><small>일봉 20 / 25 / 30</small></span>
                    <span style={{ color: 'var(--semantic-sell)' }} title="일봉 RSI가 70·75·80(과매수 기준선)에 도달할 때의 예상 가격">RSI 매도<br/><small>일봉 70 / 75 / 80</small></span>
                    <span></span>
                  </div>
                  <div className="stock-card-grid anim-stagger">
                    {activeEntries.map(([t, info]) => (
                      <StockCard
                        key={t}
                        ticker={t}
                        info={info}
                        pnl={pnlOf(t, info.summary?.market || info.market)}
                        guruMap={guruMap}
                        isAdmin={isAdmin}
                        generating={generating}
                        genProgress={genProgress}
                        touchStyle={touchStyle}
                        openDetail={openDetail}
                        generateOne={generateOne}
                        openEdit={openEdit}
                        handleDelete={handleDelete}
                        handleGlobalDelete={handleGlobalDelete}
                        setPromoteTarget={setPromoteTarget}
                        handlePinToggle={handlePinToggle}
                      />
                    ))}
                  </div>
                </>
              )}
            </>
          )
        ) : (
          /* 상세화면 */
          <div>
            <button
              onClick={() => setView('list')}
              style={{
                position: 'fixed', bottom: 80, right: 16, zIndex: 100,
                background: 'var(--text)', color: 'var(--bg)',
                border: 'none', borderRadius: 24, padding: '10px 18px',
                fontSize: 13, fontWeight: 600, cursor: 'pointer',
                boxShadow: '0 2px 12px rgba(0,0,0,0.25)',
              }}
            >
              ← 목록으로
            </button>
            <ReportDetailHeader
              detail={detail}
              selected={selected}
              setSelected={setSelected}
              setView={setView}
              isAdmin={isAdmin}
              generating={generating}
              genProgress={genProgress}
              generateOne={generateOne}
              guruMap={guruMap}
              reportList={reportList}
            />
            <ReportDetailTabs
              key={selected.ticker}
              summary={detail.summary}
              ticker={selected.ticker}
              enrichedAt={detail.enriched_at}
              loading={loading}
              historyDates={reportList[selected.ticker]?.dates ?? []}
              historyMarket={reportList[selected.ticker]?.market ?? 'US'}
              onConsensusRefresh={(patched) => {
                setDetail(prev => ({ ...prev, summary: { ...prev.summary, ...patched } }))
                fetchList()
              }}
              onTabChange={(t) => trackEvent('report_tab_switch', { tab: t })}
            />
          </div>
        )}
      </div>

      {/* 종목 추가 FAB — 목록 화면에서만 */}
      {view === 'list' && activeTab !== 'others' && (
        <button className="fab" onClick={openAdd} title={activeTab === 'watchlist' ? '관심종목 추가' : '보유종목 추가'}>
          <Plus />
        </button>
      )}

      {modalOpen && (
        <StockModal
          stock={editing}
          mode={editing ? (editing.isWatch ? 'watchlist' : 'holding') : addMode}
          onSave={handleSave}
          onClose={() => { setModalOpen(false); setEditing(null) }}
        />
      )}
      {promoteTarget && (
        <PromoteModal
          ticker={promoteTarget.ticker}
          market={promoteTarget.market}
          onConfirm={handlePromote}
          onClose={() => setPromoteTarget(null)}
        />
      )}
    </div>
    </>
  )
}

import { useState, useEffect } from 'react'
import api from '../api'
import { useAuth } from '../contexts/AuthContext'
import useReportList from '../hooks/useReportList'
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






export default function Reports() {
  const { role } = useAuth() || { role: 'user' }
  const isAdmin = role === 'admin'
  const { showToast } = useToast()
  const isMobile = useIsMobile()
  // S3(#80): 모바일 카드 액션 버튼 터치타깃 ≥44×44px — 패딩으로 클릭영역만 확보(아이콘 크기 유지)
  const touchStyle = isMobile ? { minWidth: 44, minHeight: 44, padding: '0 8px' } : undefined

  const {
    reportList, listLoading, hasFetched,
    guruMap, fetchList, applyList,
    holdingsCount, watchlistAll, watchlistCount,
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
  const [watchlistSub, setWatchlistSub] = useState('low')
  const [sortCol, setSortCol] = useState(null)
  const [sortDir, setSortDir] = useState('asc')
  const [othersData, setOthersData] = useState(null)
  const [othersLoading, setOthersLoading] = useState(false)
  const [view, setView] = useState('list')
  const [detailRefreshKey, setDetailRefreshKey] = useState(0)
  const [marketFilter, setMarketFilter] = useState('ALL')

  // 종목 관리(추가/편집/삭제/승격) — 종목관리에서 흡수
  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState(null)        // { ...stock, isWatch }
  const [addMode, setAddMode] = useState('holding')    // 'holding' | 'watchlist'
  const [promoteTarget, setPromoteTarget] = useState(null)
  const [mutError, setMutError] = useState('')

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

  // ── 종목 관리 핸들러 (종목관리 → 리포트 탭 흡수) ──
  const pollReportGeneration = (ticker) => {
    let attempts = 0
    const maxAttempts = 6
    const id = setInterval(async () => {
      attempts++
      try {
        const { data } = await api.get(`/api/report/${ticker}/history`)
        if (data && data.length > 0) {
          clearInterval(id)
        } else if (attempts >= maxAttempts) {
          clearInterval(id)
          showToast(`${ticker} 리포트 생성에 실패했습니다.\n다시 시도해주세요.`, 'warning')
        }
      } catch {
        if (attempts >= maxAttempts) {
          clearInterval(id)
          showToast(`${ticker} 리포트 생성에 실패했습니다.\n다시 시도해주세요.`, 'warning')
        }
      }
    }, 15000)
  }

  const refreshAfterMutation = () => { fetchList(); fetchAll() }

  const handleSave = async (stockData) => {
    try {
      const isWatch = editing ? editing.isWatch : addMode === 'watchlist'
      if (editing) {
        await api.put(`/api/${isWatch ? 'watchlist' : 'portfolio'}/${editing.ticker}`, stockData)
        showToast(`${editing.ticker} 수정됐습니다`)
      } else {
        const res = await api.post(`/api/${isWatch ? 'watchlist' : 'portfolio'}`, stockData)
        showToast(`${stockData.ticker} 추가됐습니다`)
        if (res.data?.report_queued) {
          pollReportGeneration(stockData.ticker.toUpperCase())
        }
      }
      setModalOpen(false); setEditing(null); setMutError(''); refreshAfterMutation()
    } catch (err) {
      const msg = err.response?.data?.detail || '저장 실패'
      setMutError(msg); showToast(msg, 'error')
      throw err
    }
  }

  const handleDelete = async (ticker, isWatch) => {
    const msg = isWatch ? `${ticker}를 완전히 삭제하시겠습니까?` : `${ticker}를 보유종목에서 제거하고 관심종목으로 이동합니까?`
    if (!window.confirm(msg)) return
    try {
      await api.delete(`/api/${isWatch ? 'watchlist' : 'portfolio'}/${ticker}`)
      setMutError(''); refreshAfterMutation()
      showToast(`${ticker} 삭제됐습니다`)
    } catch (err) {
      const errMsg = err.response?.data?.detail || '삭제 실패'
      setMutError(errMsg); showToast(errMsg, 'error')
    }
  }

  const handlePromote = async ({ quantity, avg_cost }) => {
    try {
      await api.post(`/api/watchlist/${promoteTarget.ticker}/promote`, { quantity, avg_cost })
      showToast(`${promoteTarget.ticker} 보유종목으로 이동됐습니다`)
      setPromoteTarget(null); setActiveTab('holdings'); refreshAfterMutation()
    } catch (err) {
      showToast('이동 실패', 'error')
      throw err
    }
  }

  // 편집 — 수량·평단은 reportList엔 없고 stocks/watchlist에 있다. ticker로 찾아 넘긴다.
  const openEdit = (ticker, category) => {
    const isWatch = category === 'watchlist'
    const src = isWatch ? watchMap[ticker?.toUpperCase()] : holdingMap[ticker?.toUpperCase()]
    setEditing({ ...(src || { ticker, market: 'US' }), isWatch })
    setModalOpen(true)
  }
  const openAdd = () => {
    setEditing(null)
    setAddMode(activeTab === 'watchlist' ? 'watchlist' : 'holding')
    setModalOpen(true)
  }

  useEffect(() => cleanup, [cleanup])

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (activeTab === 'ungenerated' && ungeneratedCount === 0) setActiveTab('holdings')
  }, [ungeneratedCount, activeTab])

  const _matchSubTab = ([, v]) => {
    if (activeTab === 'others') return false
    if (activeTab === 'ungenerated') return _isUngenerated([, v])
    if (activeTab === 'holdings') return v.category === 'holdings'
    if (v.category !== 'watchlist') return false
    if (watchlistSub === 'warn') return _hasWarning(v.summary, v.is_etf)
    const g = _targetPct(v.summary)
    if (watchlistSub === 'low') return !_hasWarning(v.summary, v.is_etf) && (g === null || g >= 40)
    return !_hasWarning(v.summary, v.is_etf) && (g !== null && g < 40)
  }
  const subTabEntries = Object.entries(reportList).filter(_matchSubTab)
  const _mktBase = activeTab === 'others' ? Object.entries(othersData || {}) : subTabEntries
  const mCountAll = _mktBase.length
  const mCountKR = _mktBase.filter(([, v]) => (v.summary?.market || v.market) === 'KR').length
  const mCountUS = _mktBase.filter(([, v]) => (v.summary?.market || v.market) === 'US').length

  const tabEntries = subTabEntries
    .filter(([, v]) => {
      if (marketFilter === 'ALL') return true
      const m = v.summary?.market || v.market
      return m === marketFilter
    })
    .sort(([, a], [, b]) => {
      const cmp = (va, vb, dir) => {
        if (va === null && vb === null) return 0
        if (va === null) return 1
        if (vb === null) return -1
        return dir === 'asc' ? va - vb : vb - va
      }
      const gapOf = (s) => {
        const t = s.summary?.target_mean, p = s.summary?.price
        return t != null && p ? (t - p) / p * 100 : null
      }
      if (sortCol === 'gap') return cmp(gapOf(a), gapOf(b), sortDir)
      if (sortCol === 'rsi') return cmp(a.summary?.daily_rsi?.rsi ?? null, b.summary?.daily_rsi?.rsi ?? null, sortDir)
      if (sortCol === 'chg') return cmp(a.summary?.drop_from_high_20d ?? null, b.summary?.drop_from_high_20d ?? null, sortDir)
      // 기본 정렬
      if (activeTab === 'holdings') {
        const gapA = gapOf(a), gapB = gapOf(b)
        if (gapA !== gapB) { if (gapA === null) return 1; if (gapB === null) return -1; return gapA - gapB }
        const rA = a.summary?.daily_rsi?.rsi ?? null, rB = b.summary?.daily_rsi?.rsi ?? null
        if (rA === null && rB === null) return 0; if (rA === null) return 1; if (rB === null) return -1; return rB - rA
      }
      const gapA = gapOf(a), gapB = gapOf(b)
      if (gapA !== gapB) { if (gapA === null) return 1; if (gapB === null) return -1; return gapB - gapA }
      const rA = a.summary?.daily_rsi?.rsi ?? null, rB = b.summary?.daily_rsi?.rsi ?? null
      if (rA === null && rB === null) return 0; if (rA === null) return 1; if (rB === null) return -1; return rA - rB
    })

  const othersEntries = othersData
    ? Object.entries(othersData)
        .filter(([, v]) => marketFilter === 'ALL' || (v.summary?.market || v.market) === marketFilter)
        .sort(([a], [b]) => a.localeCompare(b))
    : []
  const activeEntries = activeTab === 'others' ? othersEntries : tabEntries

  const handleSort = (col) => {
    if (sortCol === col) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortCol(col); setSortDir('asc') }
  }
  const sortArrow = (col) => sortCol === col ? (sortDir === 'asc' ? ' ▲' : ' ▼') : ' ↕'

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
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
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
              setPromoteTarget={setPromoteTarget}
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
                <div style={{ textAlign: 'center', marginTop: 80, color: 'var(--text-3)' }}>
                  <p>리포트가 없습니다.</p>
                  {activeTab !== 'others' && <p style={{ marginTop: 8, fontSize: 13 }}>설정 페이지에서 "지금 생성" 버튼을 눌러 첫 리포트를 만드세요.</p>}
                </div>
              ) : (
                <div className="stock-card-grid">
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
                      setPromoteTarget={setPromoteTarget}
                    />
                  ))}
                </div>
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

import { useState, useEffect, useCallback } from 'react'
import api from '../api'
import StockModal from '../components/StockModal'
import PromoteModal from '../components/PromoteModal'
import LoadingSpinner from '../components/LoadingSpinner'
import DashboardCard from '../components/portfolio/DashboardCard'
import { Search, Plus, Spark, MarketBadge, Sig, fmt, sparkFor, Pencil } from '../components/ui/icons'
import useIsMobile from '../hooks/useIsMobile'
import { useToast } from '../components/Toast'
import SectorTab from './SectorTab'
import MacroTab from './MacroTab'
import Analytics from './Analytics'

const DashboardGrid = ({ cards, loading }) => {
  if (loading) return <LoadingSpinner label="보유종목 불러오는 중입니다." />
  if (!cards.length) return <p style={{ color: 'var(--text-3)', textAlign: 'center', padding: 40 }}>보유종목이 없습니다.</p>
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 12, padding: '4px 0' }}>
      {cards.map(item => <DashboardCard key={item.ticker} item={item} />)}
    </div>
  )
}

export default function Portfolio() {
  const isMobile = useIsMobile()
  const { showToast } = useToast()
  const [tab, setTab] = useState('holdings')
  const [filter, setFilter] = useState('all')
  const [search, setSearch] = useState('')
  const [stocks, setStocks] = useState([])
  const [watchlist, setWatchlist] = useState([])
  const [listLoading, setListLoading] = useState(true)
  const [hasFetched, setHasFetched] = useState(false)
  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState(null)
  const [promoteTarget, setPromoteTarget] = useState(null)
  const [error, setError] = useState('')
  const [dashboardCards, setDashboardCards] = useState([])
  const [dashboardLoading, setDashboardLoading] = useState(false)
  const [analysisTab, setAnalysisTab] = useState('sector')
  const [fx, setFx] = useState(1380)
  const [events7d, setEvents7d] = useState([])

  const fetchAll = useCallback(async () => {
    setListLoading(true)
    const { data } = await api.get('/api/portfolio')
    setStocks(data.stocks || [])
    setWatchlist(data.watchlist || [])
    setListLoading(false)
    setHasFetched(true)
    // 시세는 목록 렌더 후 별도 로드
    api.get('/api/portfolio/prices').then(({ data: prices }) => {
      setStocks(prev => prev.map(s => prices[s.ticker] ? { ...s, ...prices[s.ticker] } : s))
    }).catch(() => {})
  }, [])

  const fetchDashboard = useCallback(async ({ invalidate = false } = {}) => {
    setDashboardLoading(true)
    try {
      if (invalidate) await api.delete('/api/stocks/dashboard/cache').catch(() => {})
      const res = await api.get('/api/stocks/dashboard')
      setDashboardCards(res.data || [])
    } catch {
      // silent
    } finally {
      setDashboardLoading(false)
    }
  }, [])

  useEffect(() => { fetchAll() }, [fetchAll])
  useEffect(() => {
    api.get('/api/market/fx').then(({ data }) => {
      const rate = data?.rates?.usdkrw?.current
      if (rate) setFx(rate)
    }).catch(() => {})
  }, [])
  useEffect(() => {
    api.get('/api/digest/latest').then(({ data }) => {
      setEvents7d(data?.events_7d || [])
    }).catch(() => {})
  }, [])

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

  const handleSave = async (stockData) => {
    try {
      const isWatch = tab === 'watch'
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
      setModalOpen(false); setEditing(null); setError(''); fetchAll()
    } catch (err) {
      const msg = err.response?.data?.detail || '저장 실패'
      setError(msg); showToast(msg, 'error')
      throw err
    }
  }

  const handleDelete = async (ticker) => {
    const isWatch = tab === 'watch'
    const msg = isWatch ? `${ticker}를 완전히 삭제하시겠습니까?` : `${ticker}를 보유종목에서 제거하고 관심종목으로 이동합니까?`
    if (!window.confirm(msg)) return
    try {
      await api.delete(`/api/${isWatch ? 'watchlist' : 'portfolio'}/${ticker}`)
      setError(''); fetchAll()
      showToast(`${ticker} 삭제됐습니다`)
    } catch (err) {
      const errMsg = err.response?.data?.detail || '삭제 실패'
      setError(errMsg); showToast(errMsg, 'error')
    }
  }

  const handlePromote = async ({ quantity, avg_cost }) => {
    try {
      await api.post(`/api/watchlist/${promoteTarget.ticker}/promote`, { quantity, avg_cost })
      showToast(`${promoteTarget.ticker} 보유종목으로 이동됐습니다`)
      setPromoteTarget(null); setTab('holdings'); fetchAll()
    } catch (err) {
      showToast('이동 실패', 'error')
      throw err
    }
  }

  const openEdit = (stock) => { setEditing(stock); setModalOpen(true) }
  const openAdd = () => { setEditing(null); setModalOpen(true) }

  const q = search.trim().toLowerCase()
  const applyFilter = (list) => list.filter(s => {
    const matchSearch = !q || s.ticker.toLowerCase().includes(q) || (s.name || '').toLowerCase().includes(q)
    const matchMarket = filter === 'all' || (s.market || 'US') === filter
    return matchSearch && matchMarket
  })

  const filteredStocks = applyFilter(stocks)
  const filteredWatchlist = applyFilter(watchlist)

  // KPI 계산
  const toKrw = (h, price) => (price || 0) * (h.quantity || 0) * ((h.market || 'US') === 'KR' ? 1 : fx)
  const totalCost = stocks.reduce((sum, h) => sum + toKrw(h, h.avg_cost || 0), 0)
  const hasPrice = stocks.some(h => h.current_price != null)
  const totalValue = hasPrice ? stocks.reduce((sum, h) => sum + toKrw(h, h.current_price ?? h.avg_cost ?? 0), 0) : null
  const totalPnl = totalValue != null ? totalValue - totalCost : null
  const totalPnlPct = totalPnl != null && totalCost > 0 ? totalPnl / totalCost * 100 : null
  const totalValueUsd = stocks.length > 0 ? (totalValue ?? totalCost) / fx : null
  const totalCostUsd = stocks.length > 0 ? totalCost / fx : null

  if (isMobile) return (
    <>
      <header className="appbar">
        <h1>포트폴리오</h1>
      </header>

      <div className="hero">
        <div className="label">{totalValue != null ? '평가금액' : '투자 원가'} · {new Date().toLocaleDateString('ko-KR', { month: 'long', day: 'numeric' })} · 15분 지연</div>
        <div className="val tnum">₩{fmt(totalValue ?? totalCost, 0)}</div>
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
          <button className={tab === 'holdings' ? 'is-active' : ''} onClick={() => setTab('holdings')}>
            보유 <span className="count">{stocks.length}</span>
          </button>
          <button className={tab === 'watch' ? 'is-active' : ''} onClick={() => setTab('watch')}>
            관심 <span className="count">{watchlist.length}</span>
          </button>
          <button className={tab === 'dash' ? 'is-active' : ''} onClick={() => { setTab('dash'); fetchDashboard() }}>
            대시보드
          </button>
          <button className={tab === 'analysis' ? 'is-active' : ''} onClick={() => setTab('analysis')}>
            분석
          </button>
        </div>
      </div>

      {tab !== 'dash' && tab !== 'analysis' && (
        <div style={{ padding: '0 20px 10px' }}>
          <input
            className="m-list-search"
            placeholder="종목 검색..."
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
          <div className="filter-chips">
            <button className={filter === 'all' ? 'is-active' : ''} onClick={() => setFilter('all')}>전체</button>
            <button className={filter === 'US' ? 'is-active' : ''} onClick={() => setFilter('US')}>🇺🇸 해외</button>
            <button className={filter === 'KR' ? 'is-active' : ''} onClick={() => setFilter('KR')}>🇰🇷 국내</button>
          </div>
        </div>
      )}

      {error && <p style={{ color: 'var(--down)', fontSize: 13, padding: '0 20px 8px' }}>{error}</p>}

      {tab === 'holdings' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, margin: '0 20px', paddingBottom: 80 }}>
          {filteredStocks.map(h => {
            const ccy = (h.market || 'US') === 'KR' ? '₩' : '$'
            const dec = (h.market || 'US') === 'KR' ? 0 : 2
            const pnl = h.current_price != null ? (h.current_price - h.avg_cost) * h.quantity : null
            const pnlPct = h.current_price != null && h.avg_cost ? (h.current_price - h.avg_cost) / h.avg_cost * 100 : null
            const isUp = pnl != null && pnl >= 0
            return (
              <div key={h.ticker} className="h-row">
                <div className="logo">{h.ticker.slice(0, 3)}</div>
                <div className="meta">
                  <div className="name">{h.ticker} <span style={{ color: 'var(--text-3)', fontWeight: 400 }}>· {h.name}</span></div>
                  <div className="sub">{(h.market || 'US') === 'US' ? '🇺🇸' : '🇰🇷'} {h.quantity}주 · 평단 {ccy}{fmt(h.avg_cost || 0, dec)}</div>
                </div>
                <div className="price">
                  {pnl != null ? (
                    <>
                      <div className={`v tnum ${isUp ? 'up' : 'down'}`}>{isUp ? '+' : '-'}{ccy}{fmt(Math.abs(pnl), dec)}</div>
                      <div className={`d tnum ${isUp ? 'up' : 'down'}`}>{pnlPct >= 0 ? '+' : ''}{pnlPct.toFixed(1)}%</div>
                    </>
                  ) : null}
                </div>
                <button className="row-edit" onClick={() => openEdit(h)}><Pencil /></button>
                <button className="row-del" onClick={() => handleDelete(h.ticker)}>×</button>
              </div>
            )
          })}
          {listLoading && <div style={{ textAlign: 'center', padding: 24 }}><LoadingSpinner label="불러오는 중…" /></div>}
          {!listLoading && hasFetched && filteredStocks.length === 0 && (
            <div className="muted" style={{ textAlign: 'center', padding: 24, fontSize: 13 }}>종목을 추가해 주세요</div>
          )}
          {events7d.length > 0 && (
            <div className="card" style={{ marginTop: 8, padding: '12px 16px' }}>
              <div className="muted" style={{ fontSize: 12, marginBottom: 8 }}>향후 7일 이벤트</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {events7d.map((ev, i) => (
                  <div key={i} style={{ display: 'flex', gap: 12, alignItems: 'center', fontSize: 13 }}>
                    <span className="tnum" style={{ color: 'var(--accent)', minWidth: 36 }}>D-{ev.days_until}</span>
                    <span>{ev.ticker}</span>
                    <span className="muted">{ev.event_type === 'earnings' ? '실적발표' : '배당락일'}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {tab === 'watch' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, margin: '0 20px', paddingBottom: 80 }}>
          {filteredWatchlist.map(h => (
              <div key={h.ticker} className="h-row" onClick={() => setPromoteTarget({ ticker: h.ticker, market: h.market || 'US' })} style={{ cursor: 'pointer' }}>
                <div className="logo">{h.ticker.slice(0, 3)}</div>
                <div className="meta">
                  <div className="name">{h.ticker} <span style={{ color: 'var(--text-3)', fontWeight: 400 }}>· {h.name}</span></div>
                  <div className="sub">{(h.market || 'US') === 'US' ? '🇺🇸' : '🇰🇷'} 관심종목</div>
                </div>
                <button className="row-edit" onClick={e => { e.stopPropagation(); openEdit(h) }}><Pencil /></button>
                <button className="row-del" onClick={e => { e.stopPropagation(); handleDelete(h.ticker) }}>×</button>
              </div>
          ))}
          {listLoading && <div style={{ textAlign: 'center', padding: 24 }}><LoadingSpinner label="불러오는 중…" /></div>}
          {!listLoading && hasFetched && filteredWatchlist.length === 0 && (
            <div className="muted" style={{ textAlign: 'center', padding: 24, fontSize: 13 }}>관심종목을 추가해 주세요</div>
          )}
        </div>
      )}

      {tab === 'dash' && (
        <div style={{ padding: '0 20px' }}>
          <DashboardGrid cards={dashboardCards} loading={dashboardLoading} />
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

      <button className="fab" onClick={openAdd}>
        <Plus />
      </button>

      {modalOpen && (
        <StockModal stock={editing} mode={tab === 'watch' ? 'watchlist' : 'holding'}
          onSave={handleSave} onClose={() => { setModalOpen(false); setEditing(null) }} />
      )}
      {promoteTarget && (
        <PromoteModal ticker={promoteTarget.ticker} market={promoteTarget.market} onConfirm={handlePromote} onClose={() => setPromoteTarget(null)} />
      )}
    </>
  )

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1 className="page-title">내 포트폴리오</h1>
          <p className="page-sub">{new Date().toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric' })} · 15분 지연</p>
        </div>
      </div>

      {/* KPI 4종 */}
      <div className="kpi-row">
        <div className="kpi">
          <div className="label">{totalValue != null ? '평가금액' : '투자 원가'}</div>
          <div className="val tnum">₩{fmt(totalValue ?? totalCost, 0)}</div>
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
          <button className={tab === 'holdings' ? 'is-active' : ''} onClick={() => setTab('holdings')}>
            보유종목 <span className="count">{stocks.length}</span>
          </button>
          <button className={tab === 'watch' ? 'is-active' : ''} onClick={() => setTab('watch')}>
            관심종목 <span className="count">{watchlist.length}</span>
          </button>
          <button className={tab === 'dash' ? 'is-active' : ''} onClick={() => { setTab('dash'); fetchDashboard() }}>대시보드</button>
          <button className={tab === 'analysis' ? 'is-active' : ''} onClick={() => setTab('analysis')}>분석</button>
        </div>
        {tab === 'dash' && (
          <button className="btn" onClick={() => fetchDashboard({ invalidate: true })} disabled={dashboardLoading}>↺ 새로고침</button>
        )}
        {(tab === 'holdings' || tab === 'watch') && (
          <button className="btn btn-primary" onClick={openAdd}><Plus /> 종목 추가</button>
        )}
      </div>

      {/* 검색 + 필터 칩 */}
      {tab !== 'dash' && tab !== 'analysis' && (
        <div className="search-row">
          <div className="search-input">
            <span className="ico"><Search /></span>
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="티커 또는 회사명 검색…" />
          </div>
          <button className={'filter-chip' + (filter === 'all' ? ' is-active' : '')} onClick={() => setFilter('all')}>전체</button>
          <button className={'filter-chip' + (filter === 'US' ? ' is-active' : '')} onClick={() => setFilter('US')}>🇺🇸 US</button>
          <button className={'filter-chip' + (filter === 'KR' ? ' is-active' : '')} onClick={() => setFilter('KR')}>🇰🇷 KR</button>
        </div>
      )}

      {error && <p style={{ color: 'var(--down)', marginBottom: 8, fontSize: 13 }}>{error}</p>}

      {/* 보유종목 테이블 */}
      {tab === 'holdings' && (
        <div className="tbl-wrap">
          <table className="tbl">
            <thead>
              <tr>
                <th style={{ width: 60 }}>시장</th>
                <th style={{ width: 90 }}>티커</th>
                <th>회사명</th>
                <th className="num">수량</th>
                <th className="num">평단가</th>
                <th className="num">평가손익</th>
                <th>추세</th>
                <th className="actions" />
              </tr>
            </thead>
            <tbody>
              {filteredStocks.map(h => {
                const ccy = (h.market || 'US') === 'KR' ? '₩' : '$'
                const dec = (h.market || 'US') === 'KR' ? 0 : 2
                const pnl = h.current_price != null ? (h.current_price - h.avg_cost) * h.quantity : null
                const pnlPct = h.current_price != null && h.avg_cost ? (h.current_price - h.avg_cost) / h.avg_cost * 100 : null
                return (
                  <tr key={h.ticker}>
                    <td><MarketBadge mkt={h.market || 'US'} /></td>
                    <td className="ticker-cell">{h.ticker}</td>
                    <td>{h.name}</td>
                    <td className="num tnum">{h.quantity}</td>
                    <td className="num tnum">{ccy}{fmt(h.avg_cost || 0, dec)}</td>
                    <td className="num tnum">
                      {pnl != null ? (
                        <>
                          <div className={pnl >= 0 ? 'up' : 'down'} style={{ fontWeight: 600 }}>
                            {ccy}{fmt(Math.abs(pnl), dec)}
                          </div>
                          <div style={{ fontSize: 11.5 }}><Sig v={pnlPct} /></div>
                        </>
                      ) : <span className="muted">—</span>}
                    </td>
                    <td style={{ width: 100 }}>
                      <Spark data={sparkFor(h.ticker, 40, pnl == null ? 0 : pnl >= 0 ? 0.4 : -0.4)} w={96} h={24}
                        color={pnl == null ? 'var(--text-3)' : pnl >= 0 ? 'var(--up)' : 'var(--down)'} />
                    </td>
                    <td className="actions">
                      <button className="btn btn-sm" onClick={() => openEdit(h)}>수정</button>
                      <button className="btn btn-sm" style={{ marginLeft: 4, color: 'var(--down)' }} onClick={() => handleDelete(h.ticker)}>삭제</button>
                    </td>
                  </tr>
                )
              })}
              {listLoading && (
                <tr><td colSpan={8} style={{ textAlign: 'center', padding: 32 }}><LoadingSpinner label="불러오는 중…" /></td></tr>
              )}
              {!listLoading && hasFetched && filteredStocks.length === 0 && (
                <tr><td colSpan={8} className="muted" style={{ textAlign: 'center', padding: 32 }}>종목을 추가해 주세요</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* 관심종목 테이블 */}
      {tab === 'watch' && (
        <div className="tbl-wrap">
          <table className="tbl">
            <thead>
              <tr>
                <th style={{ width: 60 }}>시장</th>
                <th>티커</th>
                <th>회사명</th>
                <th>추세</th>
                <th className="actions" />
              </tr>
            </thead>
            <tbody>
              {filteredWatchlist.map(h => (
                <tr key={h.ticker}>
                  <td><MarketBadge mkt={h.market || 'US'} /></td>
                  <td className="ticker-cell">{h.ticker}</td>
                  <td>{h.name}</td>
                  <td><Spark data={sparkFor(h.ticker)} w={80} h={22} color="var(--text-2)" /></td>
                  <td className="actions">
                    <button className="btn btn-sm" onClick={() => setPromoteTarget(h.ticker)}>보유로 이동</button>
                    <button className="btn btn-sm" style={{ marginLeft: 4 }} onClick={() => openEdit(h)}>수정</button>
                    <button className="btn btn-sm" style={{ marginLeft: 4, color: 'var(--down)' }} onClick={() => handleDelete(h.ticker)}>삭제</button>
                  </td>
                </tr>
              ))}
              {listLoading && (
                <tr><td colSpan={5} style={{ textAlign: 'center', padding: 32 }}><LoadingSpinner label="불러오는 중…" /></td></tr>
              )}
              {!listLoading && hasFetched && filteredWatchlist.length === 0 && (
                <tr><td colSpan={5} className="muted" style={{ textAlign: 'center', padding: 32 }}>관심종목을 추가해 주세요</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* 대시보드 탭 */}
      {tab === 'dash' && <DashboardGrid cards={dashboardCards} loading={dashboardLoading} />}

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

      {modalOpen && (
        <StockModal
          stock={editing}
          mode={tab === 'watch' ? 'watchlist' : 'holding'}
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
  )
}

import { useState, useEffect, useCallback } from 'react'
import api from '../api'
import StockModal from '../components/StockModal'
import PromoteModal from '../components/PromoteModal'
import { TAB_STYLE, fmtPrice } from '../utils'
import LoadingSpinner from '../components/LoadingSpinner'
import { MarketBadge } from '../components/ui/Badge'
import DashboardCard from '../components/portfolio/DashboardCard'

const DashboardGrid = ({ cards, loading }) => {
  if (loading) return <LoadingSpinner label="보유종목 불러오는 중입니다." />
  if (!cards.length) return <p style={{ color: 'var(--text-muted)', textAlign: 'center', padding: 40 }}>보유종목이 없습니다.</p>
  return (
    <div className="dashboard-grid">
      {cards.map(item => <DashboardCard key={item.ticker} item={item} />)}
    </div>
  )
}

export default function Portfolio() {
  const [activeTab, setActiveTab] = useState('holdings')
  const [stocks, setStocks] = useState([])
  const [watchlist, setWatchlist] = useState([])
  const [listLoading, setListLoading] = useState(true)
  const [hasFetched, setHasFetched] = useState(false)
  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState(null)
  const [promoteTarget, setPromoteTarget] = useState(null)
  const [error, setError] = useState('')
  const [searchQuery, setSearchQuery] = useState('')
  const [marketFilter, setMarketFilter] = useState('ALL')
  const [dashboardCards, setDashboardCards] = useState([])
  const [dashboardLoading, setDashboardLoading] = useState(false)

  const fetchAll = useCallback(async () => {
    setListLoading(true)
    const [portfolioRes, watchlistRes] = await Promise.all([
      api.get('/api/portfolio'),
      api.get('/api/watchlist'),
    ])
    setStocks(portfolioRes.data.stocks || [])
    setWatchlist(watchlistRes.data || [])
    setListLoading(false)
    setHasFetched(true)
  }, [])

  const fetchDashboard = useCallback(async ({ invalidate = false } = {}) => {
    setDashboardLoading(true)
    try {
      if (invalidate) await api.delete('/api/stocks/dashboard/cache').catch(() => {})
      const res = await api.get('/api/stocks/dashboard')
      setDashboardCards(res.data || [])
    } catch {
      // silent — keep empty array on error
    } finally {
      setDashboardLoading(false)
    }
  }, [])

  useEffect(() => { fetchAll() }, [fetchAll])

  const handleSave = async (stockData) => {
    try {
      if (activeTab === 'holdings') {
        if (editing) {
          await api.put(`/api/portfolio/${editing.ticker}`, stockData)
        } else {
          await api.post('/api/portfolio', stockData)
        }
      } else {
        if (editing) {
          await api.put(`/api/watchlist/${editing.ticker}`, stockData)
        } else {
          await api.post('/api/watchlist', stockData)
        }
      }
      setModalOpen(false)
      setEditing(null)
      setError('')
      fetchAll()
    } catch (err) {
      setError(err.response?.data?.detail || '저장 실패')
    }
  }

  const handleDelete = async (ticker) => {
    const msg = activeTab === 'holdings'
      ? `${ticker}를 보유종목에서 제거하고 관심종목으로 이동합니까?`
      : `${ticker}를 완전히 삭제하시겠습니까?`
    if (!window.confirm(msg)) return
    try {
      if (activeTab === 'holdings') {
        await api.delete(`/api/portfolio/${ticker}`)
      } else {
        await api.delete(`/api/watchlist/${ticker}`)
      }
      setError('')
      fetchAll()
    } catch (err) {
      setError(err.response?.data?.detail || '삭제 실패')
    }
  }

  const handlePromote = async ({ quantity, avg_cost }) => {
    try {
      await api.post(`/api/watchlist/${promoteTarget}/promote`, { quantity, avg_cost })
      setPromoteTarget(null)
      setActiveTab('holdings')
      fetchAll()
    } catch (err) {
      setError(err.response?.data?.detail || '전환 실패')
      setPromoteTarget(null)
    }
  }

  const openEdit = (stock) => { setEditing(stock); setModalOpen(true) }
  const openAdd = () => { setEditing(null); setModalOpen(true) }

  const q = searchQuery.trim().toLowerCase()
  const filterList = (list) => list.filter(s => {
    const matchSearch = !q || s.ticker.toLowerCase().includes(q) || (s.name || '').toLowerCase().includes(q)
    const matchMarket = marketFilter === 'ALL' || (s.market || 'US') === marketFilter
    return matchSearch && matchMarket
  })

  const filteredStocks = filterList(stocks)
  const filteredWatchlist = filterList(watchlist)
  const krHoldings = stocks.filter(s => (s.market || 'US') === 'KR').length
  const usHoldings = stocks.filter(s => (s.market || 'US') === 'US').length
  const krWatch = watchlist.filter(s => (s.market || 'US') === 'KR').length
  const usWatch = watchlist.filter(s => (s.market || 'US') === 'US').length

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
        <h1 style={{ color: 'var(--text-heading)' }}>내 포트폴리오</h1>
        <button className="btn-primary" onClick={openAdd}>+ 종목 추가</button>
      </div>

      {/* 탭 */}
      <div style={{ display: 'flex', borderBottom: '1px solid var(--border)', marginBottom: 12 }}>
        <button style={TAB_STYLE(activeTab === 'holdings')} onClick={() => setActiveTab('holdings')}>
          보유종목 ({stocks.length})
        </button>
        <button style={TAB_STYLE(activeTab === 'watchlist')} onClick={() => setActiveTab('watchlist')}>
          관심종목 ({watchlist.length})
        </button>
        <button
          style={TAB_STYLE(activeTab === 'dashboard')}
          onClick={() => { setActiveTab('dashboard'); fetchDashboard() }}
        >
          대시보드
        </button>
      </div>

      {/* 검색 + 시장 필터 */}
      {activeTab !== 'dashboard' && (
        <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
          <input
            type="text"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            placeholder="🔍 티커 또는 회사명 검색..."
            style={{
              flex: 1, padding: '7px 12px', background: 'var(--input-bg)',
              border: '1px solid var(--input-border)', borderRadius: 4,
              color: 'var(--text)', fontSize: 13,
            }}
          />
          {['ALL', 'US', 'KR'].map(m => (
            <button
              key={m}
              onClick={() => setMarketFilter(m)}
              style={{
                padding: '6px 12px', border: '1px solid var(--border)', borderRadius: 4, cursor: 'pointer', fontSize: 12,
                background: marketFilter === m ? 'var(--bg-surface)' : 'var(--bg-card)',
                color: marketFilter === m ? 'var(--accent)' : 'var(--text-muted)',
              }}
            >
              {m === 'ALL' ? `전체 (${activeTab === 'holdings' ? stocks.length : watchlist.length})`
                : m === 'US' ? `🇺🇸 US (${activeTab === 'holdings' ? usHoldings : usWatch})`
                : `🇰🇷 KR (${activeTab === 'holdings' ? krHoldings : krWatch})`}
            </button>
          ))}
        </div>
      )}

      {error && <p style={{ color: 'var(--negative)', marginBottom: 8 }}>{error}</p>}

      {/* 대시보드 탭 */}
      {activeTab === 'dashboard' && (
        <>
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 12 }}>
            <button className="btn-secondary" onClick={() => fetchDashboard({ invalidate: true })} disabled={dashboardLoading}>
              ↺ 새로고침
            </button>
          </div>
          <DashboardGrid cards={dashboardCards} loading={dashboardLoading} />
        </>
      )}

      {/* 보유종목 탭 */}
      {activeTab === 'holdings' && (
        <div className="table-mobile-wrap">
        <table style={{ fontSize: 13 }}>
          <thead>
            <tr>
              <th className="col-sticky" style={{ fontSize: 11 }}>시장</th>
              <th style={{ fontSize: 11 }}>티커</th>
              <th style={{ fontSize: 11 }}>회사명</th>
              <th style={{ fontSize: 11 }}>수량</th>
              <th style={{ fontSize: 11 }}>평단가</th>
              <th style={{ fontSize: 11 }}>경쟁사</th>
              <th style={{ fontSize: 11 }}>관리</th>
            </tr>
          </thead>
          <tbody>
            {filteredStocks.map(stock => (
              <tr key={stock.ticker}>
                <td className="col-sticky"><MarketBadge market={stock.market || 'US'} /></td>
                <td><strong>{stock.ticker}</strong></td>
                <td>{stock.name}</td>
                <td>{stock.quantity}</td>
                <td>{fmtPrice(stock.avg_cost, stock.market)}</td>
                <td style={{ fontSize: 12, color: 'var(--text-muted)' }}>{stock.competitors?.join(', ') || '-'}</td>
                <td>
                  <button className="btn-secondary" style={{ marginRight: 6 }} onClick={() => openEdit(stock)}>수정</button>
                  <button className="btn-danger" onClick={() => handleDelete(stock.ticker)}>삭제</button>
                </td>
              </tr>
            ))}
            {listLoading && (
              <tr><td colSpan={7} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: 32 }}><LoadingSpinner label="보유종목 불러오는 중입니다." /></td></tr>
            )}
            {!listLoading && hasFetched && filteredStocks.length === 0 && (
              <tr><td colSpan={7} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: 32 }}>종목을 추가해 주세요</td></tr>
            )}
          </tbody>
        </table>
        </div>
      )}

      {/* 관심종목 탭 */}
      {activeTab === 'watchlist' && (
        <div className="table-mobile-wrap">
        <table style={{ fontSize: 13 }}>
          <thead>
            <tr>
              <th className="col-sticky" style={{ fontSize: 11 }}>시장</th>
              <th style={{ fontSize: 11 }}>티커</th>
              <th style={{ fontSize: 11 }}>회사명</th>
              <th style={{ fontSize: 11 }}>경쟁사</th>
              <th style={{ fontSize: 11 }}>관리</th>
            </tr>
          </thead>
          <tbody>
            {filteredWatchlist.map(stock => (
              <tr key={stock.ticker}>
                <td className="col-sticky"><MarketBadge market={stock.market || 'US'} /></td>
                <td><strong>{stock.ticker}</strong></td>
                <td>{stock.name}</td>
                <td style={{ fontSize: 12, color: 'var(--text-muted)' }}>{stock.competitors?.join(', ') || '-'}</td>
                <td>
                  <button className="btn-secondary" style={{ marginRight: 6 }} onClick={() => openEdit(stock)}>수정</button>
                  <button
                    className="btn-primary"
                    style={{ marginRight: 6, background: '#2e7d32' }}
                    onClick={() => setPromoteTarget(stock.ticker)}
                  >
                    보유로 전환
                  </button>
                  <button className="btn-danger" onClick={() => handleDelete(stock.ticker)}>삭제</button>
                </td>
              </tr>
            ))}
            {listLoading && (
              <tr><td colSpan={5} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: 32 }}><LoadingSpinner label="관심종목 불러오는 중입니다." /></td></tr>
            )}
            {!listLoading && hasFetched && filteredWatchlist.length === 0 && (
              <tr><td colSpan={5} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: 32 }}>관심종목을 추가해 주세요</td></tr>
            )}
          </tbody>
        </table>
        </div>
      )}

      {modalOpen && (
        <StockModal
          stock={editing}
          mode={activeTab === 'watchlist' ? 'watchlist' : 'holding'}
          onSave={handleSave}
          onClose={() => { setModalOpen(false); setEditing(null) }}
        />
      )}

      {promoteTarget && (
        <PromoteModal
          ticker={promoteTarget}
          onConfirm={handlePromote}
          onClose={() => setPromoteTarget(null)}
        />
      )}
    </div>
  )
}

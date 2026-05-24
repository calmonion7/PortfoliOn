import { useState, useEffect, useCallback } from 'react'
import api from '../api'
import StockModal from '../components/StockModal'
import PromoteModal from '../components/PromoteModal'
import { TAB_STYLE, fmtPrice } from '../utils'

const MarketBadge = ({ market }) => (
  <span style={{
    fontSize: 10, padding: '1px 5px', borderRadius: 3,
    background: market === 'KR' ? '#1a3a2a' : '#1a2a3a',
    color: market === 'KR' ? '#81c784' : '#4fc3f7',
    border: `1px solid ${market === 'KR' ? '#2e6b4a' : '#2a4a6a'}`,
    whiteSpace: 'nowrap',
  }}>
    {market === 'KR' ? '🇰🇷 KR' : '🇺🇸 US'}
  </span>
)

const _weather = (score) => {
  if (score <= 0) return { icon: '☀️', label: '맑음' }
  if (score <= 1) return { icon: '⛅', label: '구름 조금' }
  if (score <= 2) return { icon: '☁️', label: '흐림' }
  return { icon: '🌧️', label: '비' }
}

const overallWeather = (item) => {
  const scores = []
  if (item.current_price && item.target_mean) {
    const gap = (item.target_mean - item.current_price) / item.current_price * 100
    const total = (item.buy ?? 0) + (item.hold ?? 0) + (item.sell ?? 0)
    const buyPct = total > 0 ? (item.buy ?? 0) / total * 100 : 50
    if (gap >= 15 && buyPct >= 60) scores.push(0)
    else if (gap >= 5 && buyPct >= 45) scores.push(1)
    else if (gap >= -5) scores.push(2)
    else scores.push(3)
  }
  if (item.rsi != null) {
    if (item.rsi < 30) scores.push(0)
    else if (item.rsi < 45) scores.push(1)
    else if (item.rsi < 65) scores.push(2)
    else scores.push(3)
  }
  if (!scores.length) return null
  return _weather(Math.round(scores.reduce((a, b) => a + b, 0) / scores.length))
}

const DashboardCard = ({ item }) => {
  const weather = overallWeather(item)
  const pnlPct = item.current_price != null && item.avg_cost != null
    ? (item.current_price - item.avg_cost) / item.avg_cost * 100
    : null
  const consPct = item.current_price && item.target_mean
    ? (item.target_mean - item.current_price) / item.current_price * 100
    : null

  const fmtPct = (v) => v == null ? '—' : `${v >= 0 ? '▲' : '▼'} ${Math.abs(v).toFixed(1)}%`
  const pctColor = (v) => v == null ? 'var(--text-muted)' : v >= 0 ? 'var(--positive)' : 'var(--negative)'

  return (
    <div style={{
      background: 'var(--bg-card)',
      border: '1px solid var(--border)',
      borderRadius: 8,
      padding: '14px 16px',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
        {weather && <span style={{ fontSize: 16 }} title={weather.label}>{weather.icon}</span>}
        <strong style={{ fontSize: 14 }}>{item.ticker}</strong>
        <MarketBadge market={item.market || 'US'} />
      </div>
      <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 10 }}>{item.name}</div>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 4 }}>
        <span style={{ fontSize: 15, fontWeight: 600 }}>
          {item.current_price == null ? '—' : fmtPrice(item.current_price, item.market)}
        </span>
        <span style={{ fontSize: 12, color: pctColor(item.daily_change_pct) }}>
          {fmtPct(item.daily_change_pct)} 오늘
        </span>
      </div>
      <div style={{ display: 'flex', gap: 12, fontSize: 12, marginBottom: 10 }}>
        <span style={{ color: pctColor(item.weekly_change_pct) }}>주간 {fmtPct(item.weekly_change_pct)}</span>
        <span style={{ color: pctColor(item.monthly_change_pct) }}>월간 {fmtPct(item.monthly_change_pct)}</span>
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 6 }}>
        <span style={{ color: 'var(--text-muted)' }}>수익률</span>
        <span style={{ color: pctColor(pnlPct), fontWeight: 600 }}>{fmtPct(pnlPct)}</span>
      </div>

      <div style={{
        display: 'flex', justifyContent: 'space-between', fontSize: 12,
        borderTop: '1px solid var(--border)', paddingTop: 6,
      }}>
        <span style={{ color: 'var(--text-muted)' }}>
          RSI <strong style={{ color: 'var(--text)' }}>{item.rsi != null ? item.rsi.toFixed(1) : '—'}</strong>
        </span>
        <span style={{ color: pctColor(consPct) }}>
          컨센서스 {consPct != null ? `${consPct >= 0 ? '+' : ''}${consPct.toFixed(0)}%` : '—'}
        </span>
      </div>
    </div>
  )
}

const DashboardGrid = ({ cards, loading }) => {
  if (loading) return <p style={{ color: 'var(--text-muted)', textAlign: 'center', padding: 40 }}>불러오는 중...</p>
  if (!cards.length) return <p style={{ color: 'var(--text-muted)', textAlign: 'center', padding: 40 }}>보유종목이 없습니다.</p>
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 12 }}>
      {cards.map(item => <DashboardCard key={item.ticker} item={item} />)}
    </div>
  )
}

export default function Portfolio() {
  const [activeTab, setActiveTab] = useState('holdings')
  const [stocks, setStocks] = useState([])
  const [watchlist, setWatchlist] = useState([])
  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState(null)
  const [promoteTarget, setPromoteTarget] = useState(null)
  const [error, setError] = useState('')
  const [searchQuery, setSearchQuery] = useState('')
  const [marketFilter, setMarketFilter] = useState('ALL')
  const [dashboardCards, setDashboardCards] = useState([])
  const [dashboardLoading, setDashboardLoading] = useState(false)

  const fetchAll = useCallback(async () => {
    const [portfolioRes, watchlistRes] = await Promise.all([
      api.get('/api/portfolio'),
      api.get('/api/watchlist'),
    ])
    setStocks(portfolioRes.data.stocks || [])
    setWatchlist(watchlistRes.data || [])
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
        <table style={{ fontSize: 13 }}>
          <thead>
            <tr>
              <th style={{ fontSize: 11 }}>시장</th>
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
                <td><MarketBadge market={stock.market || 'US'} /></td>
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
            {filteredStocks.length === 0 && (
              <tr><td colSpan={7} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: 32 }}>종목을 추가해 주세요</td></tr>
            )}
          </tbody>
        </table>
      )}

      {/* 관심종목 탭 */}
      {activeTab === 'watchlist' && (
        <table style={{ fontSize: 13 }}>
          <thead>
            <tr>
              <th style={{ fontSize: 11 }}>시장</th>
              <th style={{ fontSize: 11 }}>티커</th>
              <th style={{ fontSize: 11 }}>회사명</th>
              <th style={{ fontSize: 11 }}>경쟁사</th>
              <th style={{ fontSize: 11 }}>관리</th>
            </tr>
          </thead>
          <tbody>
            {filteredWatchlist.map(stock => (
              <tr key={stock.ticker}>
                <td><MarketBadge market={stock.market || 'US'} /></td>
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
            {filteredWatchlist.length === 0 && (
              <tr><td colSpan={5} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: 32 }}>관심종목을 추가해 주세요</td></tr>
            )}
          </tbody>
        </table>
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

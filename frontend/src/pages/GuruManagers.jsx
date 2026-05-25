import { useState, useEffect, useCallback } from 'react'
import api from '../api'
import LoadingSpinner from '../components/LoadingSpinner'

function formatValue(val) {
  if (!val) return '-'
  if (val >= 1e12) return `$${(val / 1e12).toFixed(1)}T`
  if (val >= 1e9)  return `$${(val / 1e9).toFixed(1)}B`
  if (val >= 1e6)  return `$${(val / 1e6).toFixed(1)}M`
  return `$${val.toLocaleString()}`
}

const tdStyle = { padding: '8px 12px', color: 'var(--text)' }

const COLUMNS = [
  { key: '#',     label: '#',               sortKey: null },
  { key: 'name',  label: 'Manager',         sortKey: 'name' },
  { key: 'firm',  label: 'Firm',            sortKey: 'firm' },
  { key: 'pval',  label: 'Portfolio Value', sortKey: 'portfolio_value' },
  { key: 'stocks',label: 'Stocks',          sortKey: 'num_stocks' },
  { key: 'top10', label: 'Top 10',          sortKey: null },
]

export default function GuruManagers() {
  const [data, setData]         = useState({ last_updated: null, managers: [] })
  const [stockMap, setStockMap] = useState({})
  const [loading, setLoading]   = useState(true)
  const [sort, setSort]         = useState({ key: 'num_stocks', dir: 1 })
  const [query, setQuery]       = useState('')

  const loadStockMap = useCallback(() => {
    api.get('/api/stocks').then(({ data }) => {
      const map = {}
      data.forEach(s => { map[s.ticker] = s.type })
      setStockMap(map)
    })
  }, [])

  useEffect(() => {
    api.get('/api/guru/managers')
      .then(({ data }) => setData(data))
      .finally(() => setLoading(false))
    loadStockMap()
  }, [loadStockMap])

  const handleBadgeClick = async (h) => {
    const type = stockMap[h.ticker]
    if (type === 'holding') return
    try {
      if (type === 'watchlist') {
        await api.delete(`/api/watchlist/${h.ticker}`)
      } else {
        await api.post('/api/watchlist', { ticker: h.ticker, name: h.name_kr || h.name || h.ticker })
      }
      loadStockMap()
    } catch (err) {
      alert(err.response?.data?.detail || '오류가 발생했습니다')
    }
  }

  const badgeStyle = (ticker) => {
    const type = stockMap[ticker]
    if (type === 'holding')   return { background: '#1a3a1a', color: '#81c784' }
    if (type === 'watchlist') return { background: '#3a1a1a', color: '#ef9a9a' }
    return { background: '#1e3a5f', color: '#4fc3f7' }
  }

  const handleSort = (col) => {
    if (!col.sortKey) return
    setSort(prev =>
      prev.key === col.sortKey
        ? { key: col.sortKey, dir: -prev.dir }
        : { key: col.sortKey, dir: col.sortKey === 'num_stocks' ? 1 : -1 }
    )
  }

  const q = query.trim().toLowerCase()
  const filtered = q
    ? data.managers.filter(m =>
        m.name.toLowerCase().includes(q) ||
        (m.firm || '').toLowerCase().includes(q) ||
        (m.top10 || []).some(h => h.ticker.toLowerCase().includes(q) || (h.name_kr || '').toLowerCase().includes(q))
      )
    : data.managers

  const sorted = [...filtered].sort((a, b) => {
    const av = a[sort.key] ?? ''
    const bv = b[sort.key] ?? ''
    if (av < bv) return -sort.dir
    if (av > bv) return sort.dir
    return 0
  })

  if (loading) return <LoadingSpinner label="구루 운용역 불러오는 중입니다." />
  if (!data.managers.length) return (
    <p style={{ color: 'var(--text-muted)', fontSize: 14 }}>
      데이터 없음 — "크롤링 설정" 탭에서 데이터를 가져오세요.
    </p>
  )

  return (
    <div>
      {data.last_updated && (
        <p style={{ color: 'var(--text-muted)', fontSize: 12, marginBottom: 8 }}>마지막 갱신: {data.last_updated}</p>
      )}
      <div style={{ marginBottom: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
        <input
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="매니저명 / 펌 / 티커 검색..."
          style={{ padding: '5px 10px', borderRadius: 4, border: '1px solid var(--input-border)', background: 'var(--input-bg)', color: 'var(--text)', fontSize: 13, width: 260 }}
        />
        {query && (
          <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>{sorted.length} / {data.managers.length}명</span>
        )}
      </div>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ borderBottom: '1px solid var(--border)', color: 'var(--text-heading)' }}>
              {COLUMNS.map(col => (
                <th
                  key={col.key}
                  onClick={() => handleSort(col)}
                  style={{
                    padding: '8px 12px', textAlign: 'left', fontWeight: 600, fontSize: 12,
                    cursor: col.sortKey ? 'pointer' : 'default',
                    userSelect: 'none',
                    color: sort.key === col.sortKey ? 'var(--accent)' : 'var(--text-heading)',
                  }}
                >
                  {col.label}
                  {col.sortKey && sort.key === col.sortKey && (
                    <span style={{ marginLeft: 4 }}>{sort.dir === 1 ? '▲' : '▼'}</span>
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sorted.map((m, i) => (
              <tr key={m.id} style={{ borderBottom: '1px solid var(--border)' }}>
                <td style={tdStyle}>{i + 1}</td>
                <td style={tdStyle}>{m.name}</td>
                <td style={{ ...tdStyle, color: 'var(--text-muted)' }}>{m.firm}</td>
                <td style={tdStyle}>{formatValue(m.portfolio_value)}</td>
                <td style={{ ...tdStyle, textAlign: 'right' }}>{m.num_stocks}</td>
                <td style={tdStyle}>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                    {(m.top10 || []).map(h => {
                      const type = stockMap[h.ticker]
                      const tooltip = `#${h.rank} ${h.name || h.ticker}${h.name_kr ? ` (${h.name_kr})` : ''} — ${h.weight_pct}%`
                        + (type === 'holding' ? '\n[보유중]' : type === 'watchlist' ? '\n[관심 — 클릭하여 삭제]' : '\n[클릭하여 관심종목 추가]')
                      return (
                        <span
                          key={h.rank}
                          title={tooltip}
                          onClick={() => handleBadgeClick(h)}
                          style={{
                            ...badgeStyle(h.ticker),
                            borderRadius: 3, padding: '2px 6px',
                            fontSize: 11, fontWeight: 600,
                            cursor: type === 'holding' ? 'default' : 'pointer',
                          }}
                        >
                          {h.ticker}
                        </span>
                      )
                    })}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

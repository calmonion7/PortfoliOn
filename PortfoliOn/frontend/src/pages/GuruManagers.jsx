import { useState, useEffect, useCallback } from 'react'
import axios from 'axios'

function formatValue(val) {
  if (!val) return '-'
  if (val >= 1e12) return `$${(val / 1e12).toFixed(1)}T`
  if (val >= 1e9)  return `$${(val / 1e9).toFixed(1)}B`
  if (val >= 1e6)  return `$${(val / 1e6).toFixed(1)}M`
  return `$${val.toLocaleString()}`
}

const thStyle = { padding: '8px 12px', textAlign: 'left', fontWeight: 600, fontSize: 12 }
const tdStyle = { padding: '8px 12px', color: '#e0e0e0' }

export default function GuruManagers() {
  const [data, setData]       = useState({ last_updated: null, managers: [] })
  const [stockMap, setStockMap] = useState({})  // ticker -> 'holding'|'watchlist'
  const [loading, setLoading] = useState(true)

  const loadStockMap = useCallback(() => {
    axios.get('/api/stocks').then(({ data }) => {
      const map = {}
      data.forEach(s => { map[s.ticker] = s.type })
      setStockMap(map)
    })
  }, [])

  useEffect(() => {
    axios.get('/api/guru/managers')
      .then(({ data }) => setData(data))
      .finally(() => setLoading(false))
    loadStockMap()
  }, [loadStockMap])

  const handleBadgeClick = async (h) => {
    const type = stockMap[h.ticker]
    if (type === 'holding') return
    try {
      if (type === 'watchlist') {
        await axios.delete(`/api/watchlist/${h.ticker}`)
      } else {
        await axios.post('/api/watchlist', { ticker: h.ticker, name: h.name_kr || h.name || h.ticker })
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

  if (loading) return <p style={{ color: '#aaa' }}>로딩 중...</p>
  if (!data.managers.length) return (
    <p style={{ color: '#888', fontSize: 14 }}>
      데이터 없음 — "크롤링 설정" 탭에서 데이터를 가져오세요.
    </p>
  )

  return (
    <div>
      {data.last_updated && (
        <p style={{ color: '#666', fontSize: 12, marginBottom: 12 }}>마지막 갱신: {data.last_updated}</p>
      )}
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ borderBottom: '1px solid #333', color: '#80cbc4' }}>
              {['#', 'Manager', 'Firm', 'Portfolio Value', 'Stocks', 'Top 10'].map(h => (
                <th key={h} style={thStyle}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.managers.map((m, i) => (
              <tr key={m.id} style={{ borderBottom: '1px solid #222' }}>
                <td style={tdStyle}>{i + 1}</td>
                <td style={tdStyle}>{m.name}</td>
                <td style={{ ...tdStyle, color: '#aaa' }}>{m.firm}</td>
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

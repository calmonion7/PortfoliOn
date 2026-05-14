import { useState, useEffect } from 'react'
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
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    axios.get('/api/guru/managers')
      .then(({ data }) => setData(data))
      .finally(() => setLoading(false))
  }, [])

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
                    {(m.top10 || []).map(h => (
                      <span
                        key={h.rank}
                        title={`#${h.rank} ${h.name || h.ticker}${h.name_kr ? ` (${h.name_kr})` : ''} — ${h.weight_pct}%`}
                        style={{
                          background: '#1e3a5f', color: '#4fc3f7',
                          borderRadius: 3, padding: '2px 6px',
                          fontSize: 11, fontWeight: 600, cursor: 'default',
                        }}
                      >
                        {h.ticker}
                      </span>
                    ))}
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

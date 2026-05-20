import { useState, useEffect, useCallback } from 'react'
import axios from 'axios'

const WEIGHT_LEGEND = [1,2,3,4,5,6,7,8,9,10].map(r => ({ rank: r, score: (1/r).toFixed(3) }))
const thStyle = { padding: '8px 12px', textAlign: 'left', fontWeight: 600, fontSize: 12 }
const tdStyle = { padding: '8px 12px', color: 'var(--text)' }

const TABS = [
  { key: 'popularity', label: '인기순' },
  { key: 'top3',       label: '매니저별 탑3' },
  { key: 'weighted',   label: '가중치 통계' },
]

function WatchlistBtn({ ticker, name, stockMap, onToggle }) {
  const entry = stockMap[ticker]
  if (entry === 'holding') {
    return <span style={{ fontSize: 11, color: '#555', padding: '3px 8px' }}>보유중</span>
  }
  const inWatchlist = entry === 'watchlist'
  return (
    <button
      onClick={() => onToggle(ticker, name, inWatchlist)}
      style={{
        fontSize: 11, padding: '3px 8px', borderRadius: 4, border: 'none',
        cursor: 'pointer',
        background: inWatchlist ? 'var(--bg-hover)' : 'var(--bg-surface)',
        color: inWatchlist ? 'var(--negative)' : 'var(--positive)',
      }}
    >
      {inWatchlist ? '★ 삭제' : '☆ 추가'}
    </button>
  )
}

export default function GuruStats() {
  const [popularity, setPopularity] = useState([])
  const [top3, setTop3]             = useState([])
  const [weighted, setWeighted]     = useState([])
  const [stockMap, setStockMap]     = useState({})  // ticker -> 'holding'|'watchlist'
  const [loading, setLoading]       = useState(true)
  const [tab, setTab]               = useState('popularity')
  const [query, setQuery]           = useState('')

  const loadStockMap = useCallback(() => {
    axios.get('/api/stocks').then(({ data }) => {
      const map = {}
      data.forEach(s => { map[s.ticker] = s.type })
      setStockMap(map)
    })
  }, [])

  useEffect(() => {
    Promise.all([
      axios.get('/api/guru/stats/popularity'),
      axios.get('/api/guru/stats/manager-top3'),
      axios.get('/api/guru/stats/weighted'),
    ]).then(([p, t, w]) => {
      setPopularity(p.data)
      setTop3(t.data)
      setWeighted(w.data)
    }).finally(() => setLoading(false))
    loadStockMap()
  }, [loadStockMap])

  const handleToggle = async (ticker, name, inWatchlist) => {
    try {
      if (inWatchlist) {
        await axios.delete(`/api/watchlist/${ticker}`)
      } else {
        await axios.post('/api/watchlist', { ticker, name: name || ticker })
      }
      loadStockMap()
    } catch (err) {
      alert(err.response?.data?.detail || '오류가 발생했습니다')
    }
  }

  const tabStyle = (active) => ({
    padding: '6px 14px', borderRadius: 16,
    border: `1px solid ${active ? 'var(--accent)' : 'var(--border)'}`,
    background: active ? 'var(--accent-btn)' : 'transparent',
    color: active ? 'white' : 'var(--text-muted)',
    cursor: 'pointer', fontSize: 13,
  })

  const q = query.trim().toLowerCase()

  const filteredPopularity = q
    ? popularity.filter(r => r.ticker.toLowerCase().includes(q) || (r.name_kr || '').toLowerCase().includes(q) || (r.name || '').toLowerCase().includes(q))
    : popularity

  const filteredWeighted = q
    ? weighted.filter(r => r.ticker.toLowerCase().includes(q) || (r.name_kr || '').toLowerCase().includes(q) || (r.name || '').toLowerCase().includes(q))
    : weighted

  const filteredTop3 = q
    ? top3.filter(m =>
        m.manager_name.toLowerCase().includes(q) ||
        m.top3.some(h => h && (h.ticker.toLowerCase().includes(q) || (h.name_kr || '').toLowerCase().includes(q)))
      )
    : top3

  if (loading) return <p style={{ color: 'var(--text-muted)' }}>로딩 중...</p>
  if (!popularity.length) return (
    <p style={{ color: 'var(--text-muted)', fontSize: 14 }}>데이터 없음 — 크롤링을 먼저 실행하세요.</p>
  )

  return (
    <div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
        {TABS.map(t => (
          <button key={t.key} style={tabStyle(tab === t.key)} onClick={() => setTab(t.key)}>
            {t.label}
          </button>
        ))}
      </div>

      <div style={{ marginBottom: 14, display: 'flex', alignItems: 'center', gap: 8 }}>
        <input
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="티커 / 종목명 / 매니저명 검색..."
          style={{ padding: '5px 10px', borderRadius: 4, border: '1px solid var(--input-border)', background: 'var(--input-bg)', color: 'var(--text)', fontSize: 13, width: 260 }}
        />
        {query && tab === 'popularity' && <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>{filteredPopularity.length}개</span>}
        {query && tab === 'weighted'   && <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>{filteredWeighted.length}개</span>}
        {query && tab === 'top3'       && <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>{filteredTop3.length}명</span>}
      </div>

      {tab === 'popularity' && (
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ borderBottom: '1px solid var(--border)', color: 'var(--text-heading)' }}>
              <th style={thStyle}>#</th>
              <th style={thStyle}>티커</th>
              <th style={thStyle}>영문명</th>
              <th style={thStyle}>한글명</th>
              <th style={{ ...thStyle, textAlign: 'right' }}>매니저 수</th>
              <th style={thStyle}></th>
            </tr>
          </thead>
          <tbody>
            {filteredPopularity.map((row, i) => (
              <tr key={row.ticker} style={{ borderBottom: '1px solid var(--border)' }}>
                <td style={tdStyle}>{i + 1}</td>
                <td style={{ ...tdStyle, fontWeight: 600, color: 'var(--accent)' }}>{row.ticker}</td>
                <td style={{ ...tdStyle, color: 'var(--text-muted)' }}>{row.name}</td>
                <td style={tdStyle}>{row.name_kr || '-'}</td>
                <td style={{ ...tdStyle, textAlign: 'right' }}>{row.count}명</td>
                <td style={{ ...tdStyle, textAlign: 'right' }}>
                  <WatchlistBtn
                    ticker={row.ticker}
                    name={row.name_kr || row.name}
                    stockMap={stockMap}
                    onToggle={handleToggle}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {tab === 'top3' && (
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ borderBottom: '1px solid var(--border)', color: 'var(--text-heading)' }}>
              <th style={thStyle}>Manager</th>
              {[1, 2, 3].map(r => <th key={r} style={thStyle}>{r}위 (전체보유)</th>)}
            </tr>
          </thead>
          <tbody>
            {filteredTop3.map(m => (
              <tr key={m.manager_name} style={{ borderBottom: '1px solid var(--border)' }}>
                <td style={tdStyle}>{m.manager_name}</td>
                {[0, 1, 2].map(i => {
                  const h = m.top3[i]
                  return (
                    <td key={i} style={tdStyle}>
                      {h ? (
                        <>
                          <span style={{ color: 'var(--accent)', fontWeight: 600 }}>{h.ticker}</span>
                          {h.name_kr && <span style={{ color: 'var(--text-muted)', fontSize: 11 }}> {h.name_kr}</span>}
                          <span style={{ color: 'var(--text-muted)', fontSize: 11 }}> ({h.count}명)</span>
                        </>
                      ) : '-'}
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {tab === 'weighted' && (
        <div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 12 }}>
            {WEIGHT_LEGEND.map(({ rank, score }) => (
              <span key={rank} style={{ fontSize: 11, color: 'var(--text-muted)', background: 'var(--bg-surface)', padding: '2px 6px', borderRadius: 3 }}>
                {rank}위={score}
              </span>
            ))}
          </div>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--border)', color: 'var(--text-heading)' }}>
                <th style={thStyle}>#</th>
                <th style={thStyle}>티커</th>
                <th style={thStyle}>한글명</th>
                <th style={{ ...thStyle, textAlign: 'right' }}>가중치 합계</th>
                <th style={thStyle}></th>
              </tr>
            </thead>
            <tbody>
              {filteredWeighted.map((row, i) => (
                <tr key={row.ticker} style={{ borderBottom: '1px solid var(--border)' }}>
                  <td style={tdStyle}>{i + 1}</td>
                  <td style={{ ...tdStyle, fontWeight: 600, color: 'var(--accent)' }}>{row.ticker}</td>
                  <td style={tdStyle}>{row.name_kr || row.name || '-'}</td>
                  <td style={{ ...tdStyle, textAlign: 'right', fontWeight: 600 }}>{row.score.toFixed(3)}</td>
                  <td style={{ ...tdStyle, textAlign: 'right' }}>
                    <WatchlistBtn
                      ticker={row.ticker}
                      name={row.name_kr || row.name}
                      stockMap={stockMap}
                      onToggle={handleToggle}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

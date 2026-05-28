import { useState, useEffect, useCallback } from 'react'
import api from '../api'
import LoadingSpinner from '../components/LoadingSpinner'
import useIsMobile from '../hooks/useIsMobile'

const WEIGHT_LEGEND = [1,2,3,4,5,6,7,8,9,10].map(r => ({ rank: r, score: (1/r).toFixed(3) }))

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
        background: inWatchlist ? 'var(--surface-hover)' : 'var(--bg-elev-2)',
        color: inWatchlist ? 'var(--down)' : 'var(--up)',
      }}
    >
      {inWatchlist ? '★ 삭제' : '☆ 추가'}
    </button>
  )
}

export default function GuruStats() {
  const isMobile = useIsMobile()
  const [popularity, setPopularity] = useState([])
  const [top3, setTop3]             = useState([])
  const [weighted, setWeighted]     = useState([])
  const [stockMap, setStockMap]     = useState({})  // ticker -> 'holding'|'watchlist'
  const [loading, setLoading]       = useState(true)
  const [tab, setTab]               = useState('popularity')
  const [query, setQuery]           = useState('')

  const loadStockMap = useCallback(() => {
    api.get('/api/stocks').then(({ data }) => {
      const map = {}
      data.forEach(s => { map[s.ticker] = s.type })
      setStockMap(map)
    })
  }, [])

  useEffect(() => {
    Promise.all([
      api.get('/api/guru/stats/popularity'),
      api.get('/api/guru/stats/manager-top3'),
      api.get('/api/guru/stats/weighted'),
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
        await api.delete(`/api/watchlist/${ticker}`)
      } else {
        await api.post('/api/watchlist', { ticker, name: name || ticker })
      }
      loadStockMap()
    } catch (err) {
      alert(err.response?.data?.detail || '오류가 발생했습니다')
    }
  }

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

  if (loading) return <LoadingSpinner label="구루 통계 불러오는 중입니다." />
  if (!popularity.length) return (
    <p style={{ color: 'var(--text-3)', fontSize: 14 }}>데이터 없음 — 크롤링을 먼저 실행하세요.</p>
  )

  return (
    <div>
      <div className="tabs" style={{ marginBottom: 14 }}>
        {TABS.map(t => (
          <button key={t.key} className={tab === t.key ? 'is-active' : ''} onClick={() => setTab(t.key)}>
            {t.label}
          </button>
        ))}
      </div>

      <div style={{ marginBottom: 14, display: 'flex', alignItems: 'center', gap: 8 }}>
        <input
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="티커 / 종목명 / 매니저명 검색..."
          style={{ padding: '5px 10px', borderRadius: 4, border: '1px solid var(--border)', background: 'var(--bg-elev)', color: 'var(--text)', fontSize: 13, flex: 1, minWidth: 0 }}
        />
        {query && tab === 'popularity' && <span style={{ color: 'var(--text-3)', fontSize: 12 }}>{filteredPopularity.length}개</span>}
        {query && tab === 'weighted'   && <span style={{ color: 'var(--text-3)', fontSize: 12 }}>{filteredWeighted.length}개</span>}
        {query && tab === 'top3'       && <span style={{ color: 'var(--text-3)', fontSize: 12 }}>{filteredTop3.length}명</span>}
      </div>

      {tab === 'popularity' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {filteredPopularity.map((row, i) => (
            <div key={row.ticker} style={{
              display: 'flex', alignItems: 'center', gap: 12,
              background: 'var(--bg-elev)', border: '1px solid var(--border)',
              borderRadius: 12, padding: '12px 14px',
            }}>
              <span style={{ minWidth: 22, fontSize: 12, color: 'var(--text-3)', fontWeight: 600, textAlign: 'right' }}>{i + 1}</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 700, fontSize: 15, color: 'var(--accent)' }}>{row.ticker}</div>
                <div style={{ fontSize: 12, color: 'var(--text-3)', marginTop: 2 }}>{row.name_kr || row.name || '-'}</div>
              </div>
              <div style={{ fontWeight: 700, fontSize: 14, color: 'var(--text)', whiteSpace: 'nowrap' }}>{row.count}명</div>
              <WatchlistBtn ticker={row.ticker} name={row.name_kr || row.name} stockMap={stockMap} onToggle={handleToggle} />
            </div>
          ))}
        </div>
      )}

      {tab === 'top3' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {filteredTop3.map(m => (
            <div key={m.manager_name} style={{
              background: 'var(--bg-elev)', border: '1px solid var(--border)',
              borderRadius: 12, overflow: 'hidden',
            }}>
              <div style={{
                padding: '10px 14px', borderBottom: '1px solid var(--border)',
                fontWeight: 700, fontSize: 13, color: 'var(--text)',
              }}>
                {m.manager_name}
              </div>
              <div>
                {[0, 1, 2].map(i => {
                  const h = m.top3[i]
                  return (
                    <div key={i} style={{
                      display: 'flex', alignItems: 'center', gap: 10,
                      padding: '9px 14px',
                      borderBottom: i < 2 ? '1px solid var(--border)' : 'none',
                    }}>
                      <span style={{
                        minWidth: 24, fontSize: 11, fontWeight: 700,
                        color: i === 0 ? '#f6c90e' : i === 1 ? 'var(--text-3)' : '#cd7f32',
                      }}>{i + 1}위</span>
                      {h ? (
                        <>
                          <span style={{ fontWeight: 700, fontSize: 14, color: 'var(--accent)', minWidth: 52 }}>{h.ticker}</span>
                          <span style={{ fontSize: 12, color: 'var(--text-2)', flex: 1 }}>{h.name_kr || h.name || ''}</span>
                          <span style={{ fontSize: 11, color: 'var(--text-3)', whiteSpace: 'nowrap' }}>{h.count}명</span>
                        </>
                      ) : (
                        <span style={{ color: 'var(--text-faint)', fontSize: 12 }}>-</span>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>
          ))}
        </div>
      )}

      {tab === 'weighted' && (
        <div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 12 }}>
            {WEIGHT_LEGEND.map(({ rank, score }) => (
              <span key={rank} style={{ fontSize: 11, color: 'var(--text-3)', background: 'var(--bg-elev-2)', padding: '2px 6px', borderRadius: 3 }}>
                {rank}위={score}
              </span>
            ))}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {filteredWeighted.map((row, i) => (
              <div key={row.ticker} style={{
                display: 'flex', alignItems: 'center', gap: 12,
                background: 'var(--bg-elev)', border: '1px solid var(--border)',
                borderRadius: 12, padding: '12px 14px',
              }}>
                <span style={{ minWidth: 22, fontSize: 12, color: 'var(--text-3)', fontWeight: 600, textAlign: 'right' }}>{i + 1}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 700, fontSize: 15, color: 'var(--accent)' }}>{row.ticker}</div>
                  <div style={{ fontSize: 12, color: 'var(--text-3)', marginTop: 2 }}>{row.name_kr || row.name || '-'}</div>
                </div>
                <div style={{ fontWeight: 700, fontSize: 14, color: 'var(--text)', whiteSpace: 'nowrap' }}>{row.score.toFixed(3)}</div>
                <WatchlistBtn ticker={row.ticker} name={row.name_kr || row.name} stockMap={stockMap} onToggle={handleToggle} />
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

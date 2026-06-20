import { useState, useEffect, useCallback } from 'react'
import api from '../api'
import LoadingSpinner from '../components/LoadingSpinner'
import useIsMobile from '../hooks/useIsMobile'
import '../components/ui/Button.css'

const WEIGHT_LEGEND = [1,2,3,4,5,6,7,8,9,10].map(r => ({ rank: r, score: (1/r).toFixed(3) }))

const TABS = [
  { key: 'popularity', label: '인기순' },
  { key: 'top3',       label: '매니저별 탑3' },
  { key: 'weighted',   label: '가중치 통계' },
]

function WatchlistBtn({ ticker, name, stockMap, onToggle }) {
  const isMobile = useIsMobile()
  const [loading, setLoading] = useState(false)
  const [errMsg, setErrMsg] = useState('')
  const entry = stockMap[ticker]
  if (entry === 'holding') {
    return <span style={{ fontSize: isMobile ? 13 : 11, color: 'var(--text-3)', padding: '3px 8px' }}>보유중</span>
  }
  const inWatchlist = entry === 'watchlist'

  const handleClick = async () => {
    setLoading(true)
    setErrMsg('')
    try {
      await onToggle(ticker, name, inWatchlist)
    } catch (err) {
      setErrMsg(err?.response?.data?.detail || '오류')
    } finally {
      setLoading(false)
    }
  }

  return (
    <span style={{ display: 'inline-flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
      <button
        onClick={handleClick}
        disabled={loading}
        style={{
          fontSize: isMobile ? 13 : 11, padding: isMobile ? '10px 14px' : '3px 8px', borderRadius: 4, border: 'none',
          cursor: loading ? 'progress' : 'pointer',
          background: inWatchlist ? 'var(--surface-hover)' : 'var(--bg-elev-2)',
          color: inWatchlist ? 'var(--color-error)' : 'var(--color-success)',
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          minWidth: isMobile ? 56 : 48, minHeight: isMobile ? 44 : undefined, opacity: loading ? 0.7 : 1, transition: 'opacity .15s',
        }}
      >
        {loading
          ? <span className="btn__spinner" style={{ width: 10, height: 10, borderWidth: 1.5 }} aria-hidden />
          : (inWatchlist ? '★ 삭제' : '☆ 추가')
        }
      </button>
      {errMsg && <span style={{ fontSize: 10, color: 'var(--color-error)' }}>{errMsg}</span>}
    </span>
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

  const loadStockMap = useCallback(async () => {
    const { data } = await api.get('/api/stocks')
    const map = {}
    data.forEach(s => { map[s.ticker] = s.type })
    setStockMap(map)
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
    if (inWatchlist) {
      await api.delete(`/api/watchlist/${ticker}`)
    } else {
      await api.post('/api/watchlist', { ticker, name: name || ticker })
    }
    await loadStockMap()
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
        <div style={{ display: 'grid', gridTemplateColumns: isMobile ? 'minmax(0, 1fr)' : 'repeat(auto-fill, minmax(200px, 1fr))', gap: isMobile ? 10 : 8 }}>
          {filteredPopularity.map((row, i) => (
            <div key={row.ticker} style={{
              display: 'flex', alignItems: 'center', gap: isMobile ? 12 : 10,
              background: 'var(--bg-elev)', border: '1px solid var(--border)',
              borderRadius: 10, padding: isMobile ? '14px 14px' : '10px 12px',
            }}>
              <span style={{ fontSize: isMobile ? 14 : 11, color: 'var(--text-faint)', fontWeight: 600, minWidth: isMobile ? 24 : 18, flexShrink: 0 }}>{i + 1}</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 700, fontSize: isMobile ? 17 : 14, color: 'var(--accent)' }}>{row.ticker}</div>
                <div style={{ fontSize: isMobile ? 13 : 11, color: 'var(--text-3)', marginTop: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{row.name_kr || row.name || '-'}</div>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: isMobile ? 6 : 3, flexShrink: 0 }}>
                <span style={{ fontWeight: 700, fontSize: isMobile ? 15 : 13 }}>{row.count}명</span>
                <WatchlistBtn ticker={row.ticker} name={row.name_kr || row.name} stockMap={stockMap} onToggle={handleToggle} />
              </div>
            </div>
          ))}
        </div>
      )}

      {tab === 'top3' && (
        <div style={{ display: 'grid', gridTemplateColumns: isMobile ? 'minmax(0, 1fr)' : 'repeat(auto-fill, minmax(320px, 1fr))', gap: 10 }}>
          {filteredTop3.map(m => (
            <div key={m.manager_name} style={{
              background: 'var(--bg-elev)', border: '1px solid var(--border)',
              borderRadius: 12, overflow: 'hidden',
            }}>
              <div style={{
                padding: isMobile ? '12px 14px' : '8px 12px', borderBottom: '1px solid var(--border)',
                fontWeight: 700, fontSize: isMobile ? 15 : 12, color: 'var(--text)',
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              }}>
                {m.manager_name}
              </div>
              <div>
                {[0, 1, 2].map(i => {
                  const h = m.top3[i]
                  return (
                    <div key={i} style={{
                      display: 'flex', alignItems: 'center', gap: isMobile ? 10 : 8,
                      padding: isMobile ? '12px 14px' : '7px 12px',
                      borderBottom: i < 2 ? '1px solid var(--border)' : 'none',
                    }}>
                      <span style={{
                        minWidth: isMobile ? 28 : 22, fontSize: isMobile ? 13 : 11, fontWeight: 700,
                        color: i === 0 ? '#f6c90e' : i === 1 ? 'var(--text-3)' : '#cd7f32',
                      }}>{i + 1}위</span>
                      {h ? (
                        <>
                          <span style={{ fontWeight: 700, fontSize: isMobile ? 15 : 13, color: 'var(--accent)', minWidth: isMobile ? 56 : 48 }}>{h.ticker}</span>
                          <span style={{ fontSize: isMobile ? 13 : 11, color: 'var(--text-2)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{h.name_kr || h.name || ''}</span>
                          <span style={{ fontSize: isMobile ? 13 : 11, color: 'var(--text-3)', whiteSpace: 'nowrap' }}>{h.count}명</span>
                          <WatchlistBtn ticker={h.ticker} name={h.name_kr || h.name} stockMap={stockMap} onToggle={handleToggle} />
                        </>
                      ) : (
                        <span style={{ color: 'var(--text-faint)', fontSize: isMobile ? 14 : 12 }}>-</span>
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
          <p style={{ fontSize: 12, color: 'var(--text-3)', margin: '0 0 8px', lineHeight: 1.5 }}>
            매니저 보유 순위가 높을수록 가중치가 큽니다 (보유 순위 역수 기준).
          </p>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 12 }}>
            {WEIGHT_LEGEND.map(({ rank, score }) => (
              <span key={rank} style={{ fontSize: 11, color: 'var(--text-3)', background: 'var(--bg-elev-2)', padding: '2px 6px', borderRadius: 3 }}>
                {rank}위={score}
              </span>
            ))}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: isMobile ? 'minmax(0, 1fr)' : 'repeat(auto-fill, minmax(200px, 1fr))', gap: isMobile ? 10 : 8 }}>
            {filteredWeighted.map((row, i) => (
              <div key={row.ticker} style={{
                display: 'flex', alignItems: 'center', gap: isMobile ? 12 : 10,
                background: 'var(--bg-elev)', border: '1px solid var(--border)',
                borderRadius: 10, padding: isMobile ? '14px 14px' : '10px 12px',
              }}>
                <span style={{ fontSize: isMobile ? 14 : 11, color: 'var(--text-faint)', fontWeight: 600, minWidth: isMobile ? 24 : 18, flexShrink: 0 }}>{i + 1}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 700, fontSize: isMobile ? 17 : 14, color: 'var(--accent)' }}>{row.ticker}</div>
                  <div style={{ fontSize: isMobile ? 13 : 11, color: 'var(--text-3)', marginTop: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{row.name_kr || row.name || '-'}</div>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: isMobile ? 6 : 3, flexShrink: 0 }}>
                  <span style={{ fontWeight: 700, fontSize: isMobile ? 15 : 13 }}>{row.score.toFixed(3)}</span>
                  <WatchlistBtn ticker={row.ticker} name={row.name_kr || row.name} stockMap={stockMap} onToggle={handleToggle} />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

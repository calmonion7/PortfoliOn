import { useState, useEffect } from 'react'
import api from '../api'
import RecCard from '../components/recommendations/RecCard'
import LoadingSpinner from '../components/LoadingSpinner'
import { useToast } from '../components/Toast'

export default function Recommendations() {
  const { showToast } = useToast()
  const [items, setItems] = useState([])
  const [watchlist, setWatchlist] = useState([])
  const [asOf, setAsOf] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)

  // 관심종목 토글: watched=등록된 ticker(대문자) Set, pending=요청 중 Set(더블클릭 방지)
  const [watched, setWatched] = useState(() => new Set())
  const [pending, setPending] = useState(() => new Set())

  // 마운트 시 발굴 목록 + 관심종목을 병렬 fetch
  useEffect(() => {
    let cancelled = false
    setLoading(true)
    Promise.all([
      api.get('/api/recommendations', { params: { limit: 50 } }),
      api.get('/api/watchlist').catch(() => ({ data: [] })),
    ])
      .then(([rec, wl]) => {
        if (cancelled) return
        setItems(rec.data?.discovery || [])
        setWatchlist(rec.data?.watchlist || [])
        setAsOf(rec.data?.as_of || null)
        setWatched(new Set((wl.data || []).map(s => s.ticker.toUpperCase())))
        setError(false)
      })
      .catch(() => {
        if (cancelled) return
        setError(true)
        showToast('추천 종목을 불러오지 못했습니다.', 'error')
      })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [showToast])

  // 딥다이브 = 관심종목 추가. 추가 성공 후 watched에 넣어 버튼 비활성.
  const deepDive = (item) => {
    const t = item.ticker.toUpperCase()
    if (pending.has(t) || watched.has(t)) return
    setPending(prev => new Set(prev).add(t))
    const payload = {
      ticker: item.ticker,
      name: item.name || item.ticker,
      market: item.market,
      exchange: item.market === 'KR' ? 'KS' : '',
      security_type: 'EQUITY',
    }
    api.post('/api/watchlist', payload)
      .then(() => {
        setWatched(prev => new Set(prev).add(t))
        showToast(`${item.ticker} 관심종목에 추가 — 분석이 곧 생성됩니다.`)
      })
      .catch((err) => {
        showToast(err?.response?.data?.detail || '관심종목 추가에 실패했습니다.', 'error')
      })
      .finally(() => setPending(prev => { const n = new Set(prev); n.delete(t); return n }))
  }

  if (loading) return <LoadingSpinner label="추천 종목 불러오는 중입니다." style={{ padding: 40 }} />

  if (error) return (
    <div style={{ textAlign: 'center', color: '#ef9a9a', fontSize: 13, padding: 32 }}>추천 종목을 불러오지 못했습니다.</div>
  )

  if (items.length === 0 && watchlist.length === 0) return (
    <div style={{ textAlign: 'center', color: 'var(--text-3)', fontSize: 13, padding: 32 }}>추천 종목이 없습니다.</div>
  )

  // 카드 그리드 — Ranking.jsx 관례(auto-fill minmax 260px, gap 10)
  const gridStyle = { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 10 }

  return (
    <div>
      {asOf && (
        <div style={{ fontSize: 11, color: 'var(--text-3)', marginBottom: 12 }}>기준 {asOf}</div>
      )}

      {/* 발굴 섹션 — 딥다이브(관심추가) 버튼을 footer로 주입 */}
      {items.length > 0 && (
        <div style={{ marginBottom: 28 }}>
          <h3 style={{ color: 'var(--text)', marginBottom: 8 }}>발굴</h3>
          <div style={gridStyle}>
            {items.map((item, i) => {
              const t = item.ticker.toUpperCase()
              const isWatched = watched.has(t)
              const busy = pending.has(t)
              return (
                <RecCard
                  key={`${item.ticker}-${i}`}
                  item={item}
                  footer={
                    <button
                      className="btn btn-primary"
                      onClick={() => deepDive(item)}
                      disabled={isWatched || busy}
                      style={{ width: '100%', marginTop: 4 }}
                    >
                      {isWatched ? '관심종목 추가됨' : busy ? '추가 중…' : '딥다이브'}
                    </button>
                  }
                />
              )
            })}
          </div>
        </div>
      )}

      {/* 관심 재정렬 섹션 — 이미 관심종목이라 딥다이브 없음(footer 미주입) */}
      {watchlist.length > 0 && (
        <div>
          <h3 style={{ color: 'var(--text)', marginBottom: 2 }}>관심 재정렬</h3>
          <div style={{ fontSize: 11, color: 'var(--text-3)', marginBottom: 8 }}>내 관심종목 · 추천 점수순</div>
          <div style={gridStyle}>
            {watchlist.map((item, i) => (
              <RecCard key={`${item.ticker}-${i}`} item={item} />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

import { useState, useEffect, useCallback } from 'react'
import api from '../api'
import LoadingSpinner from '../components/LoadingSpinner'
import Input from '../components/ui/Input'
import { SketchEmpty } from '../components/sketches'
import { WatchlistBtn } from './GuruStats'
import '../components/ui/Button.css'

// 표시 줄 수(집계 범위가 아니다 — 집계는 항상 전 구루·전 종목). 'all'은 전량.
const SCOPES = [
  { key: 10,    label: '탑10' },
  { key: 20,    label: '탑20' },
  { key: 50,    label: '탑50' },
  { key: 'all', label: '전체' },
]

const fmtUsd = (v) => {
  if (!v || v <= 0) return '—'
  if (v >= 1e9) return `$${(v / 1e9).toFixed(1)}B`
  if (v >= 1e6) return `$${Math.round(v / 1e6)}M`
  return `$${Math.round(v / 1e3)}K`
}

export default function GuruAllocation() {
  const [data, setData]         = useState(null)
  const [stockMap, setStockMap] = useState({})   // ticker -> 'holding'|'watchlist'
  const [loading, setLoading]   = useState(true)
  const [scope, setScope]       = useState(20)
  const [query, setQuery]       = useState('')

  const loadStockMap = useCallback(async () => {
    const { data } = await api.get('/api/stocks')
    const map = {}
    data.forEach(s => { map[s.ticker] = s.type })
    setStockMap(map)
  }, [])

  useEffect(() => {
    api.get('/api/guru/stats/allocation')
      .then(r => setData(r.data))
      .finally(() => setLoading(false))
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

  if (loading) return <LoadingSpinner label="구루 자산 배분 불러오는 중입니다." />

  const all = data?.rows || []
  if (!all.length) return (
    <div className="guru-empty">
      <div className="sketch-draw"><SketchEmpty size={140} /></div>
      <p className="muted">데이터 없음 — 크롤링을 먼저 실행하세요.</p>
    </div>
  )

  const q = query.trim().toLowerCase()
  const matches = r => r.ticker.toLowerCase().includes(q)
    || (r.name_kr || '').toLowerCase().includes(q)
    || (r.name || '').toLowerCase().includes(q)
  // 검색은 스코프와 무관하게 **전체 집합**을 훑는다 — 꼬리 종목이 필에 가려 안 잡히면 안 된다.
  // all은 이미 투자금 내림차순이라 인덱스가 곧 순위 — 검색 결과에도 진짜 순위를 붙인다.
  const limit = (q || scope === 'all') ? all.length : scope
  const rows = []
  for (let i = 0; i < all.length && rows.length < limit; i++) {
    if (!q || matches(all[i])) rows.push({ r: all[i], rank: i + 1 })
  }

  return (
    <div>
      <p className="guru-alloc-caption">
        구루 {data.manager_count}명 · 총 {fmtUsd(data.total_value)} · {data.ticker_count.toLocaleString()}종목
        <span className="guru-alloc-note"> — 비율은 이 총액 대비</span>
      </p>

      <div className="guru-alloc-scopes">
        {SCOPES.map(s => (
          <button
            key={s.key}
            onClick={() => setScope(s.key)}
            className={scope === s.key ? 'is-active' : ''}
          >
            {s.label}
          </button>
        ))}
      </div>

      <div className="guru-toolbar">
        <Input
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="티커 / 종목명 검색..."
          className="guru-search--flex"
        />
        {query && <span className="guru-count">{rows.length}개</span>}
      </div>

      <div className="anim-stagger guru-stat-grid guru-alloc-grid">
        {rows.map(({ r, rank }) => (
          <div key={r.ticker} className="anim-fade-up guru-stat-row">
            <span className="guru-stat-rank">{rank}</span>
            <div className="guru-stat-main">
              <div className="guru-stat-ticker">{r.ticker}</div>
              {/* 잘리는 건 이름이어야 한다 — 숫자를 한 문자열에 섞으면 ellipsis가 문자열
                  *끝*을 먹어 비율·명수가 통째 사라진다(라이브 PC에서 50행 중 38행 발생). */}
              <div className="guru-stat-name">
                <span className="guru-alloc-nm">{r.name_kr || r.name || '-'}</span>
                <span className="guru-alloc-num">· {r.ratio.toFixed(2)}% · {r.holder_count}명</span>
              </div>
            </div>
            <div className="guru-stat-side">
              <span className="guru-stat-value">{fmtUsd(r.value)}</span>
              <WatchlistBtn
                ticker={r.ticker}
                name={r.name_kr || r.name}
                stockMap={stockMap}
                onToggle={handleToggle}
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

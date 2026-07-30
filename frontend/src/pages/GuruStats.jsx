import { useState, useEffect, useCallback } from 'react'
import api from '../api'
import LoadingSpinner from '../components/LoadingSpinner'
import Input from '../components/ui/Input'
import { SketchEmpty, SketchError } from '../components/sketches'
import { useToast } from '../components/Toast'
import '../components/ui/Button.css'

const WEIGHT_LEGEND = [1,2,3,4,5,6,7,8,9,10].map(r => ({ rank: r, score: (1/r).toFixed(3) }))

export function WatchlistBtn({ ticker, name, stockMap, onToggle }) {
  const [loading, setLoading] = useState(false)
  const [errMsg, setErrMsg] = useState('')
  const entry = stockMap[ticker]
  if (entry === 'holding') {
    return <span className="guru-wl-held">보유중</span>
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
    <span className="guru-wl">
      <button
        onClick={handleClick}
        disabled={loading}
        className="guru-wl-btn"
        style={{
          // 배경 채움은 CSS에서 제거했다(테두리형) — 채운 빨강 「★ 삭제」가 행마다 반복되며
          // 카드에서 가장 강한 요소가 돼 티커·값보다 부차 액션이 앞서 읽혔다.
          // 색 의미(추가=success·삭제=error)는 그대로 유지한다.
          cursor: loading ? 'progress' : 'pointer',
          color: inWatchlist ? 'var(--color-error)' : 'var(--color-success)',
          opacity: loading ? 0.7 : 1,
        }}
      >
        {loading
          ? <span className="btn__spinner guru-wl-spinner" aria-hidden />
          : (inWatchlist ? '★ 삭제' : '☆ 추가')
        }
      </button>
      {errMsg && <span className="guru-wl-err">{errMsg}</span>}
    </span>
  )
}

// 인기순(count/명)·가중치(score/소수3자리) 뷰가 공유하는 행 카드 — 지표값·단위만 props로 받는다(task#227 S3).
function StatRow({ index, row, value, unit, stockMap, onToggle }) {
  return (
    <div className="anim-fade-up guru-stat-row">
      <span className="guru-stat-rank">{index + 1}</span>
      <div className="guru-stat-main">
        {/* 순위·티커·지표값이 한 축(baseline) — 값을 우측 세로 stack에서 이 행으로 올렸다. */}
        <div className="guru-stat-head">
          <span className="guru-stat-ticker">{row.ticker}</span>
          <span className="guru-stat-value">{value}{unit}</span>
        </div>
        <div className="guru-stat-name">{row.name_kr || row.name || '-'}</div>
      </div>
      <WatchlistBtn ticker={row.ticker} name={row.name_kr || row.name} stockMap={stockMap} onToggle={onToggle} />
    </div>
  )
}

export default function GuruStats({ view }) {
  const { showToast } = useToast()
  const [popularity, setPopularity] = useState([])
  const [weighted, setWeighted]     = useState([])
  const [stockMap, setStockMap]     = useState({})  // ticker -> 'holding'|'watchlist'
  const [loading, setLoading]       = useState(true)
  const [error, setError]           = useState(null)  // 빈 상태와 구분 — 실패를 "크롤링을 먼저"로 위장하지 않는다
  const [query, setQuery]           = useState('')

  // 표시 뷰는 Guru가 넘기는 view로 고정(기본 'popularity')
  const tab = view ?? 'popularity'

  const loadStockMap = useCallback(async () => {
    const { data } = await api.get('/api/stocks')
    const map = {}
    data.forEach(s => { map[s.ticker] = s.type })
    setStockMap(map)
  }, [])

  useEffect(() => {
    Promise.all([
      api.get('/api/guru/stats/popularity'),
      api.get('/api/guru/stats/weighted'),
    ]).then(([p, w]) => {
      setPopularity(p.data)
      setWeighted(w.data)
    }).catch(e => {
      console.error('[GuruStats] 구루 통계 조회 실패:', e)
      setError('구루 통계를 불러오지 못했습니다.')
    }).finally(() => setLoading(false))
    // 배지용 보조 조회 — 실패해도 본문은 살린다(배지만 빈다).
    loadStockMap().catch(e => console.error('[GuruStats] 보유/관심 조회 실패:', e))
  }, [loadStockMap])

  const handleToggle = async (ticker, name, inWatchlist) => {
    try {
      if (inWatchlist) {
        await api.delete(`/api/watchlist/${ticker}`)
      } else {
        await api.post('/api/watchlist', { ticker, name: name || ticker })
      }
      await loadStockMap()
    } catch (e) {
      console.error('[GuruStats] 관심종목 변경 실패:', e)
      showToast(e?.response?.data?.detail || '관심종목 변경 실패', 'error')
    }
  }

  const q = query.trim().toLowerCase()
  const matches = r => r.ticker.toLowerCase().includes(q) || (r.name_kr || '').toLowerCase().includes(q) || (r.name || '').toLowerCase().includes(q)
  const filteredPopularity = q ? popularity.filter(matches) : popularity
  const filteredWeighted   = q ? weighted.filter(matches) : weighted
  const rows = tab === 'popularity' ? filteredPopularity : filteredWeighted

  if (loading) return <LoadingSpinner label="구루 통계 불러오는 중입니다." />
  // 에러가 빈 상태보다 먼저다 — 실패에 "크롤링을 먼저 실행하세요"를 띄우면 잘못된 행동을 지시한다.
  if (error) return (
    <div className="guru-empty">
      <div className="sketch-draw"><SketchError size={140} /></div>
      <p style={{ color: 'var(--color-error)' }}>{error}</p>
    </div>
  )
  if (!popularity.length) return (
    <div className="guru-empty">
      <div className="sketch-draw"><SketchEmpty size={140} /></div>
      <p className="muted">데이터 없음 — 크롤링을 먼저 실행하세요.</p>
    </div>
  )

  return (
    <div>
      <div className="guru-toolbar">
        <Input
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="티커 / 종목명 / 매니저명 검색..."
          className="guru-search--flex"
        />
        {query && <span className="guru-count">{rows.length}개</span>}
      </div>

      {tab === 'weighted' && (
        <>
          <p className="guru-legend-desc">
            매니저 보유 순위가 높을수록 가중치가 큽니다 (보유 순위 역수 기준).
          </p>
          <div className="guru-legend">
            {WEIGHT_LEGEND.map(({ rank, score }) => (
              <span key={rank} className="guru-legend-chip">{rank}위={score}</span>
            ))}
          </div>
        </>
      )}

      <div className="anim-stagger guru-stat-grid">
        {rows.map((row, i) => (
          <StatRow
            key={row.ticker}
            index={i}
            row={row}
            value={tab === 'popularity' ? row.count : row.score.toFixed(3)}
            unit={tab === 'popularity' ? '명' : ''}
            stockMap={stockMap}
            onToggle={handleToggle}
          />
        ))}
      </div>
    </div>
  )
}

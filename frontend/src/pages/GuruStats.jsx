import { useState, useEffect } from 'react'
import api from '../api'
import LoadingSpinner from '../components/LoadingSpinner'
import Input from '../components/ui/Input'
import { SketchEmpty, SketchError } from '../components/sketches'
import useTrackedStocks from '../hooks/useTrackedStocks'
import '../components/ui/Button.css'

const WEIGHT_LEGEND = [1,2,3,4,5,6,7,8,9,10].map(r => ({ rank: r, score: (1/r).toFixed(3) }))

// pending은 훅(`useTrackedStocks`)의 **티커 단위** in-flight Set이다. 로컬 loading은 *자기
// 버튼*만 잠그므로, 같은 티커가 한 화면에 두 번 이상 렌더되면 형제 버튼이 열린 채로 남고
// 그 클릭은 훅의 뮤텍스에 조용히 삼켜진다(B58) — pending까지 봐야 형제도 함께 잠긴다.
export function WatchlistBtn({ ticker, name, stockMap, onToggle, unknown = false, pending }) {
  const [loading, setLoading] = useState(false)
  // 분기 순서는 unknown → holding → watchlist → none이다. 모름을 먼저 걸러야 하는 이유:
  // stockMap이 빈 맵이면 그 아래 분기가 전부 "미추적"으로 떨어져 이미 관심에 있는 종목에
  // 「☆ 추가」를 제시하게 된다(누르면 제거가 아니라 중복 추가 — 의도와 반대).
  if (unknown) {
    return (
      <span className="guru-wl">
        <button className="guru-wl-btn" disabled
                title="보유·관심 상태를 불러오지 못했습니다"
                style={{ cursor: 'not-allowed', opacity: 0.45, color: 'var(--text-3)' }}>
          ☆ —
        </button>
      </span>
    )
  }
  const entry = stockMap[ticker]
  if (entry === 'holding') {
    return <span className="guru-wl-held">보유중</span>
  }
  const inWatchlist = entry === 'watchlist'
  const busy = loading || pending?.has(ticker) === true

  const handleClick = async () => {
    setLoading(true)
    // 실패는 훅이 토스트로 알린다(re-throw 없음) — 버튼은 로딩 복구만 책임진다.
    try {
      // WatchlistBtn 소비처(GuruStats·GuruAllocation·GuruDetail) 전부 US 13F 데이터다.
      // market:'US'는 백엔드 기본값과 같은 값이지만, 그 사실이 코드에 적혀 있어야
      // 다음 KR 소비처가 조용히 market='US'로 저장되는 재발을 막는다(ADR-0032 §결정 2, 지우지 말 것).
      await onToggle({ ticker, name: name || ticker, market: 'US', exchange: '', security_type: 'EQUITY' }, inWatchlist)
    } finally {
      setLoading(false)
    }
  }

  return (
    <span className="guru-wl">
      <button
        onClick={handleClick}
        disabled={busy}
        aria-busy={busy || undefined}
        className="guru-wl-btn"
        style={{
          // 배경 채움은 CSS에서 제거했다(테두리형) — 채운 빨강 「★ 삭제」가 행마다 반복되며
          // 카드에서 가장 강한 요소가 돼 티커·값보다 부차 액션이 앞서 읽혔다.
          // 색 의미(추가=success·삭제=error)는 그대로 유지한다.
          cursor: busy ? 'progress' : 'pointer',
          color: inWatchlist ? 'var(--color-error)' : 'var(--color-success)',
          opacity: busy ? 0.7 : 1,
        }}
      >
        {busy
          ? <span className="btn__spinner guru-wl-spinner" aria-hidden />
          : (inWatchlist ? '★ 삭제' : '☆ 추가')
        }
      </button>
    </span>
  )
}

// 인기순(count/명)·가중치(score/소수3자리) 뷰가 공유하는 행 카드 — 지표값·단위만 props로 받는다(task#227 S3).
function StatRow({ index, row, value, unit, stockMap, onToggle, unknown, pending }) {
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
      <WatchlistBtn ticker={row.ticker} name={row.name_kr || row.name} stockMap={stockMap} onToggle={onToggle} unknown={unknown} pending={pending} />
    </div>
  )
}

export default function GuruStats({ view }) {
  const { stockMap, unknown, pending, toggle } = useTrackedStocks()
  const [popularity, setPopularity] = useState([])
  const [weighted, setWeighted]     = useState([])
  const [loading, setLoading]       = useState(true)
  const [error, setError]           = useState(null)  // 빈 상태와 구분 — 실패를 "크롤링을 먼저"로 위장하지 않는다
  const [query, setQuery]           = useState('')

  // 표시 뷰는 Guru가 넘기는 view로 고정(기본 'popularity')
  const tab = view ?? 'popularity'

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
  }, [])

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
            onToggle={toggle}
            unknown={unknown}
            pending={pending}
          />
        ))}
      </div>
    </div>
  )
}

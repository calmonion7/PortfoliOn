import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import api from '../api'
import RecCard from '../components/recommendations/RecCard'
import Skeleton from '../components/ui/Skeleton'
import Badge from '../components/ui/Badge'
import { useToast } from '../components/Toast'

// 보유 액션 배지 색 — ⚠️ 가격 토큰(success=빨/danger=파, ADR-0015) 금지.
// RecCard의 FLAG_STYLE처럼 전용색을 inline으로 직접 박는다(가격 방향 아님).
const ACTION_STYLE = {
  추매: { background: 'var(--semantic-buy-soft)', color: 'var(--semantic-buy)', borderColor: 'var(--semantic-buy-soft)' }, // 매수 신호 — 시맨틱 buy
  익절: { background: 'var(--warn-soft)', color: 'var(--warn)', borderColor: 'var(--warn-soft)' },                          // 경계 — warn
  홀딩: { background: 'var(--bg-elev-2)', color: 'var(--text-3)', borderColor: 'var(--border)' },                          // 중립 회색
}

// 발굴 필터 칩 선택지
const MARKET_CHIPS = [
  { key: 'all',  label: '전체' },
  { key: 'KR',   label: '국내' },
  { key: 'US',   label: '해외' },
]

// ticker(대문자) → 보유 구루 수. /api/guru/managers top10 역인덱스.
// GuruHoldersSection(리포트 상세)·universe._fetch_guru_tickers와 동일 top10 소스라
// 리포트 드릴다운·배치 guru_new_buy 칩과 개수가 일관된다.
function buildGuruCounts(managers) {
  const counts = {}
  for (const m of (managers || [])) {
    for (const h of (m.top10 || [])) {
      const t = (h.ticker || '').toUpperCase()
      if (t) counts[t] = (counts[t] || 0) + 1
    }
  }
  return counts
}

// 관심 분석 대기 배지 색 — ⚠️ success/danger(가격 토큰) 금지. 전용 중립색 직접 명시.
const PENDING_BADGE_STYLE = {
  background: 'var(--bg-elev-2)',
  color: 'var(--text-3)',
  border: '1px solid var(--border)',
  borderRadius: 999,
  fontSize: 11,
  fontWeight: 500,
  padding: '2px 8px',
  display: 'inline-block',
  whiteSpace: 'nowrap',
}

// 긴 추천 리스트(관심 재정렬·발굴)를 초기 N개만 렌더하고 '더보기'로 점진 확장 —
// 전체를 한 번에 렌더해 모바일 페이지가 수만 px로 늘어나던 문제 해소(task#144, 표시만 손봄).
function ExpandableGrid({ items, gridStyle, initial = 6, step = 12, renderItem }) {
  const [count, setCount] = useState(initial)
  const shown = items.slice(0, count)
  const remaining = items.length - count
  return (
    <>
      <div style={gridStyle}>{shown.map(renderItem)}</div>
      {remaining > 0 && (
        <button
          className="btn"
          onClick={() => setCount(c => c + step)}
          style={{ width: '100%', marginTop: 12 }}
        >
          더보기 ({remaining}개 더)
        </button>
      )}
    </>
  )
}

export default function Recommendations() {
  const { showToast } = useToast()
  const [items, setItems] = useState([])
  const [watchlist, setWatchlist] = useState([])
  const [holdings, setHoldings] = useState([])
  const [asOf, setAsOf] = useState(null)
  const [loading, setLoading] = useState(true)
  const [discoveryLoading, setDiscoveryLoading] = useState(false) // 발굴 칩 전환 시 로컬 로딩
  const [error, setError] = useState(false)
  const [marketChip, setMarketChip] = useState('all') // 발굴 필터 칩 ('all'|'KR'|'US')
  const [guruCounts, setGuruCounts] = useState({}) // ticker(대문자)→보유 구루 수 (US 13F)

  // 관심종목 토글: watched=등록된 ticker(대문자) Set, pending=요청 중 Set(더블클릭 방지)
  const [watched, setWatched] = useState(() => new Set())
  const [pending, setPending] = useState(() => new Set())

  // 초기 로드: 발굴 목록 + 관심종목 병렬 fetch
  useEffect(() => {
    let cancelled = false
    setLoading(true)
    Promise.all([
      api.get('/api/recommendations', { params: { limit: 50 } }),
      api.get('/api/watchlist').catch(() => ({ data: [] })),
      // 구루 보유 개수 — US 13F, 시장 무관이라 마운트 1회만(칩 토글 refetch 미포함). 실패 graceful.
      api.get('/api/guru/managers').catch(() => ({ data: { managers: [] } })),
    ])
      .then(([rec, wl, guru]) => {
        if (cancelled) return
        setItems(rec.data?.discovery || [])
        setWatchlist(rec.data?.watchlist || [])
        setHoldings(rec.data?.holdings || [])
        setAsOf(rec.data?.as_of || null)
        setWatched(new Set((wl.data || []).map(s => s.ticker.toUpperCase())))
        setGuruCounts(buildGuruCounts(guru.data?.managers))
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

  // 발굴 칩 전환 시 서버 refetch (watchlist/holdings는 갱신 안 함)
  const handleChip = (key) => {
    if (key === marketChip) return
    setMarketChip(key)
    const params = { limit: 50 }
    if (key !== 'all') params.market = key
    setDiscoveryLoading(true)
    api.get('/api/recommendations', { params })
      .then(res => {
        setItems(res.data?.discovery || [])
      })
      .catch(() => {
        showToast('발굴 목록을 불러오지 못했습니다.', 'error')
      })
      .finally(() => setDiscoveryLoading(false))
  }

  // 딥다이브 = 관심종목 추가. 추가 성공 후 watched에 넣어 버튼 비활성.
  const deepDive = (item) => {
    const t = item.ticker.toUpperCase()
    if (pending.has(t) || watched.has(t)) return
    setPending(prev => new Set(prev).add(t))
    const payload = {
      ticker: item.ticker,
      name: item.name || item.ticker,
      market: item.market,
      exchange: item.exchange || (item.market === 'KR' ? 'KS' : ''),
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

  const guruCountFor = (t) => guruCounts[(t || '').toUpperCase()] || 0

  if (loading) return (
    <div>
      <h3 style={{ color: 'var(--text)', marginBottom: 8 }}>발굴</h3>
      <Skeleton variant="card" count={6} />
    </div>
  )

  if (error) return (
    <div style={{ textAlign: 'center', color: 'var(--color-error)', fontSize: 13, padding: 32 }}>추천 종목을 불러오지 못했습니다.</div>
  )

  if (items.length === 0 && watchlist.length === 0 && holdings.length === 0) return (
    <div style={{ textAlign: 'center', color: 'var(--text-3)', fontSize: 13, padding: 32 }}>추천 종목이 없습니다.</div>
  )

  // 카드 그리드 — Ranking.jsx 관례(auto-fill minmax 260px, gap 10)
  const gridStyle = { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 10 }

  return (
    <div>
      {asOf && (
        <div style={{ fontSize: 13, color: 'var(--text-2)', fontWeight: 600, marginBottom: 16 }}>데이터 기준일 {asOf}</div>
      )}

      {/* 보유 액션 섹션 — 최상단. 액션 배지 + 포지션 근거 한 줄을 footer로 주입 */}
      {holdings.length > 0 && (
        <div style={{ marginBottom: 28 }}>
          <h3 style={{ color: 'var(--text)', marginBottom: 2 }}>보유 액션</h3>
          <div style={{ fontSize: 11, color: 'var(--text-3)', marginBottom: 8 }}>내 보유종목 · 추매/익절/홀딩 신호</div>
          <div style={gridStyle}>
            {holdings.map((item, i) => {
              const pnl = item.pnl_pct
              const weight = item.weight_pct
              const posLine = (pnl == null && weight == null)
                ? '데이터 부족'
                : `평가손익 ${pnl == null ? '—' : `${pnl >= 0 ? '+' : ''}${pnl.toFixed(1)}%`} · 비중 ${weight == null ? '—' : `${weight.toFixed(1)}%`}`
              return (
                <RecCard
                  key={`${item.ticker}-${i}`}
                  item={item}
                  guruCount={guruCountFor(item.ticker)}
                  footer={
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4, flexWrap: 'wrap' }}>
                      <Badge variant="neutral" style={ACTION_STYLE[item.action] || ACTION_STYLE.홀딩}>
                        {item.action}
                      </Badge>
                      <span style={{ fontSize: 11, color: 'var(--text-3)' }}>{posLine}</span>
                    </div>
                  }
                />
              )
            })}
          </div>
        </div>
      )}

      {/* 관심 재정렬 섹션 — 분석 상태(enriched) 표시 */}
      {watchlist.length > 0 && (
        <div style={{ marginBottom: 28 }}>
          <h3 style={{ color: 'var(--text)', marginBottom: 2 }}>관심 재정렬</h3>
          <div style={{ fontSize: 11, color: 'var(--text-3)', marginBottom: 8 }}>내 관심종목 · 추천 점수순</div>
          <ExpandableGrid
            items={watchlist}
            gridStyle={gridStyle}
            renderItem={(item, i) => (
              <RecCard
                key={`${item.ticker}-${i}`}
                item={item}
                guruCount={guruCountFor(item.ticker)}
                footer={item.enriched === true
                  ? (
                    <Link
                      to="/"
                      state={{ tab: 'reports', ticker: item.ticker }}
                      style={{ display: 'block', width: '100%', marginTop: 4, textAlign: 'center', fontSize: 13, color: 'var(--accent)', textDecoration: 'none', fontWeight: 600 }}
                    >
                      분석 보기
                    </Link>
                  ) : (
                    <span style={PENDING_BADGE_STYLE}>분석 대기 중</span>
                  )
                }
              />
            )}
          />
        </div>
      )}

      {/* 발굴 섹션 — 필터 칩 + 딥다이브 버튼 */}
      {(items.length > 0 || marketChip !== 'all') && (
        <div>
          <h3 style={{ color: 'var(--text)', marginBottom: 2 }}>발굴</h3>
          {/* 시장 필터 칩 */}
          <div className="filter-chips" style={{ marginBottom: 10 }}>
            {MARKET_CHIPS.map(chip => (
              <button
                key={chip.key}
                className={marketChip === chip.key ? 'is-active' : ''}
                onClick={() => handleChip(chip.key)}
              >
                {chip.label}
              </button>
            ))}
          </div>
          {discoveryLoading
            ? <Skeleton variant="card" count={3} />
            : (
              <ExpandableGrid
                key={marketChip}
                items={items}
                gridStyle={gridStyle}
                renderItem={(item, i) => {
                  const t = item.ticker.toUpperCase()
                  const isWatched = watched.has(t)
                  const busy = pending.has(t)
                  return (
                    <RecCard
                      key={`${item.ticker}-${i}`}
                      item={item}
                      guruCount={guruCountFor(item.ticker)}
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
                }}
              />
            )
          }
        </div>
      )}
    </div>
  )
}

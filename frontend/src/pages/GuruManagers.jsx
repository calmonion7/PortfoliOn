import { useState, useEffect, useCallback, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import api from '../api'
import LoadingSpinner from '../components/LoadingSpinner'
import Input from '../components/ui/Input'
import useIsMobile from '../hooks/useIsMobile'
import { SketchEmpty } from '../components/sketches'

// 티커별 보유 매니저 수 역인덱스 — Recommendations.jsx의 buildGuruCounts와 동일 방식(백엔드 호출 없이 이미 받은 managers blob만 사용)
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

function formatValue(val) {
  if (!val) return '-'
  if (val >= 1e12) return `$${(val / 1e12).toFixed(1)}T`
  if (val >= 1e9)  return `$${(val / 1e9).toFixed(1)}B`
  if (val >= 1e6)  return `$${(val / 1e6).toFixed(1)}M`
  return `$${val.toLocaleString()}`
}

const SORT_OPTIONS = [
  { key: 'num_stocks',      label: '종목수',   dir: 1 },
  { key: 'portfolio_value', label: '포트폴리오 규모', dir: -1 },
  { key: 'name',            label: '이름순',   dir: -1 },
]

function initials(name) {
  return name.split(/[\s-]+/).map(w => w[0]).join('').slice(0, 2).toUpperCase()
}

export default function GuruManagers() {
  const isMobile = useIsMobile()
  const navigate = useNavigate()
  const [data, setData]         = useState({ last_updated: null, managers: [] })
  const [stockMap, setStockMap] = useState({})
  const [loading, setLoading]   = useState(true)
  const [sort, setSort]         = useState({ key: 'num_stocks', dir: 1 })
  const [query, setQuery]       = useState('')
  const [, setBadgeErr] = useState('')
  const guruCounts = useMemo(() => buildGuruCounts(data.managers), [data.managers])

  const loadStockMap = useCallback(() => {
    api.get('/api/stocks').then(({ data }) => {
      const map = {}
      data.forEach(s => { map[s.ticker] = s.type })
      setStockMap(map)
    })
  }, [])

  useEffect(() => {
    api.get('/api/guru/managers')
      .then(({ data }) => setData(data))
      .finally(() => setLoading(false))
    loadStockMap()
  }, [loadStockMap])

  const handleBadgeClick = async (h) => {
    const type = stockMap[h.ticker]
    if (type === 'holding') return
    setBadgeErr('')
    try {
      if (type === 'watchlist') {
        await api.delete(`/api/watchlist/${h.ticker}`)
      } else {
        await api.post('/api/watchlist', { ticker: h.ticker, name: h.name_kr || h.name || h.ticker })
      }
      loadStockMap()
    } catch (err) {
      setBadgeErr(err.response?.data?.detail || '관심종목 변경에 실패했습니다.')
    }
  }

  const badgeStyle = (ticker) => {
    const type = stockMap[ticker]
    if (type === 'holding')   return { background: 'var(--tag-hold-bg)',  color: 'var(--tag-hold-color)',  border: '1px solid var(--tag-hold-border)' }
    if (type === 'watchlist') return { background: 'var(--tag-watch-bg)', color: 'var(--tag-watch-color)', border: '1px solid var(--tag-watch-border)' }
    return { background: 'var(--tag-track-bg)', color: 'var(--tag-track-color)', border: '1px solid var(--tag-track-border)' }
  }

  const q = query.trim().toLowerCase()
  const filtered = q
    ? data.managers.filter(m =>
        m.name.toLowerCase().includes(q) ||
        (m.firm || '').toLowerCase().includes(q) ||
        (m.top10 || []).some(h => h.ticker.toLowerCase().includes(q) || (h.name_kr || '').toLowerCase().includes(q))
      )
    : data.managers

  const sorted = [...filtered].sort((a, b) => {
    const av = a[sort.key] ?? ''
    const bv = b[sort.key] ?? ''
    if (av < bv) return -sort.dir
    if (av > bv) return sort.dir
    return 0
  })

  if (loading) return <LoadingSpinner label="구루 운용역 불러오는 중입니다." />
  if (!data.managers.length) return (
    <div className="guru-empty">
      <div className="sketch-draw"><SketchEmpty size={140} /></div>
      <p className="muted">
        데이터 없음 — 설정 &gt; 구루 탭의 "즉시 크롤링"에서 데이터를 가져오세요.
      </p>
    </div>
  )

  // ── 모바일 카드 뷰 ────────────────────────────────────────
  if (isMobile) return (
    <div className="guru-mobile">
      {data.last_updated && (
        <p className="guru-updated--mobile">
          마지막 갱신: {data.last_updated.slice(0, 10)}
        </p>
      )}

      {/* 검색 */}
      <div className="guru-search-row--mobile">
        <input
          className="m-list-search"
          placeholder="매니저명 / 펌 / 티커 검색..."
          value={query}
          onChange={e => setQuery(e.target.value)}
        />
      </div>

      {/* 정렬 칩 */}
      <div className="filter-chips guru-sort-row--mobile">
        {SORT_OPTIONS.map(opt => (
          <button
            key={opt.key}
            className={sort.key === opt.key ? 'is-active' : ''}
            onClick={() => setSort(prev =>
              prev.key === opt.key ? { key: opt.key, dir: -prev.dir } : { key: opt.key, dir: opt.dir }
            )}
          >
            {opt.label}{sort.key === opt.key ? (sort.dir === 1 ? ' ↑' : ' ↓') : ''}
          </button>
        ))}
        {q && <span className="guru-count--mobile">{sorted.length}/{data.managers.length}명</span>}
      </div>

      {/* 카드 목록 — .guru-card/.guru-h/.guru-avatar/.guru-stats(pc.css) 재사용, 데스크탑 카드와 동일 문법 */}
      <div className="anim-stagger guru-list--mobile">
        {sorted.map((m, i) => (
          <div
            key={m.id}
            className="guru-card anim-fade-up"
            role="button"
            tabIndex={0}
            onClick={() => navigate(`/guru/${m.id}`)}
            onKeyDown={e => { if (e.key === 'Enter') navigate(`/guru/${m.id}`) }}
          >
            {/* 헤더 */}
            <div className="guru-h">
              <div className="guru-avatar">{initials(m.name)}</div>
              <div className="guru-h-info">
                <p className="guru-name serif">
                  {m.name.split(' - ')[0]}
                </p>
                <div className="guru-fund">
                  {m.firm || m.name}
                </div>
              </div>
              <div className="guru-rank">
                #{i + 1}
              </div>
            </div>

            {/* 통계 */}
            <div className="guru-stats">
              <div className="guru-stat">
                <div className="l">포트폴리오</div>
                <div className="v">{formatValue(m.portfolio_value)}</div>
              </div>
              <div className="guru-stat">
                <div className="l">종목수</div>
                <div className="v">{m.num_stocks ?? '-'}</div>
              </div>
            </div>

            {/* Top10 배지 — 각 배지가 비중%·보유 구루 수를 텍스트로 노출(구 '매니저별 탑3' 탭 흡수 + 툴팁 의존 제거, task#227) */}
            {(m.top10 || []).length > 0 && (
              <div className="guru-badges">
                {(m.top10 || []).map(h => {
                  const type = stockMap[h.ticker]
                  return (
                    <span
                      key={h.rank}
                      onClick={e => { e.stopPropagation(); handleBadgeClick(h) }}
                      title={`#${h.rank} ${h.name || h.ticker}${h.name_kr ? ` (${h.name_kr})` : ''} — ${h.weight_pct}%`}
                      className="guru-badge"
                      style={{
                        ...badgeStyle(h.ticker),
                        cursor: type === 'holding' ? 'default' : 'pointer',
                      }}
                    >
                      {h.ticker}
                      <span className="guru-badge-meta">
                        {h.weight_pct}% · {guruCounts[(h.ticker || '').toUpperCase()] ?? 1}명
                      </span>
                    </span>
                  )
                })}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )

  // ── 데스크탑 카드 뷰 ─────────────────────────────────────
  return (
    <div>
      {data.last_updated && (
        <p className="guru-updated">마지막 갱신: {data.last_updated.slice(0, 10)}</p>
      )}
      <div className="guru-toolbar">
        <Input
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="매니저명 / 펌 / 티커 검색..."
          className="guru-search--wide"
        />
        {query && (
          <span className="guru-count">{sorted.length} / {data.managers.length}명</span>
        )}
        <div className="guru-sort-group">
          {SORT_OPTIONS.map(opt => (
            <button
              key={opt.key}
              className={`filter-chip${sort.key === opt.key ? ' is-active' : ''}`}
              onClick={() => setSort(prev =>
                prev.key === opt.key ? { key: opt.key, dir: -prev.dir } : { key: opt.key, dir: opt.dir }
              )}
            >
              {opt.label}{sort.key === opt.key ? (sort.dir === 1 ? ' ↑' : ' ↓') : ''}
            </button>
          ))}
        </div>
      </div>

      <div className="anim-stagger guru-grid">
        {sorted.map((m, i) => (
          <div
            key={m.id}
            className="guru-card anim-fade-up"
            role="button"
            tabIndex={0}
            onClick={() => navigate(`/guru/${m.id}`)}
            onKeyDown={e => { if (e.key === 'Enter') navigate(`/guru/${m.id}`) }}
          >
            <div className="guru-h">
              <div className="guru-avatar">{initials(m.name)}</div>
              <div className="guru-h-info">
                <p className="guru-name serif">
                  {m.name.split(' - ')[0]}
                </p>
                <div className="guru-fund">
                  {m.firm || m.name}
                </div>
              </div>
              <div className="guru-rank">#{i + 1}</div>
            </div>

            <div className="guru-stats">
              <div className="guru-stat">
                <div className="l">포트폴리오</div>
                <div className="v">{formatValue(m.portfolio_value)}</div>
              </div>
              <div className="guru-stat">
                <div className="l">종목수</div>
                <div className="v">{m.num_stocks ?? '-'}</div>
              </div>
            </div>

            {(m.top10 || []).length > 0 && (
              <div className="guru-badges">
                {(m.top10 || []).map(h => {
                  const type = stockMap[h.ticker]
                  const tooltip = `#${h.rank} ${h.name || h.ticker}${h.name_kr ? ` (${h.name_kr})` : ''} — ${h.weight_pct}%`
                    + (type === 'holding' ? '\n[보유중]' : type === 'watchlist' ? '\n[관심 — 클릭하여 삭제]' : '\n[클릭하여 관심종목 추가]')
                  return (
                    <span
                      key={h.rank}
                      title={tooltip}
                      onClick={e => { e.stopPropagation(); handleBadgeClick(h) }}
                      className="guru-badge"
                      style={{
                        ...badgeStyle(h.ticker),
                        cursor: type === 'holding' ? 'default' : 'pointer',
                      }}
                    >
                      {h.ticker}
                      <span className="guru-badge-meta">
                        {h.weight_pct}% · {guruCounts[(h.ticker || '').toUpperCase()] ?? 1}명
                      </span>
                    </span>
                  )
                })}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

import { useState, useEffect, useCallback } from 'react'
import api from '../api'
import LoadingSpinner from '../components/LoadingSpinner'
import Input from '../components/ui/Input'
import useIsMobile from '../hooks/useIsMobile'

function formatValue(val) {
  if (!val) return '-'
  if (val >= 1e12) return `$${(val / 1e12).toFixed(1)}T`
  if (val >= 1e9)  return `$${(val / 1e9).toFixed(1)}B`
  if (val >= 1e6)  return `$${(val / 1e6).toFixed(1)}M`
  return `$${val.toLocaleString()}`
}

const tdStyle = { padding: '8px 12px', color: 'var(--text)' }

const COLUMNS = [
  { key: '#',     label: '#',               sortKey: null },
  { key: 'name',  label: 'Manager',         sortKey: 'name' },
  { key: 'firm',  label: 'Firm',            sortKey: 'firm' },
  { key: 'pval',  label: 'Portfolio Value', sortKey: 'portfolio_value' },
  { key: 'stocks',label: 'Stocks',          sortKey: 'num_stocks' },
  { key: 'top10', label: 'Top 10',          sortKey: null },
]

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
  const [data, setData]         = useState({ last_updated: null, managers: [] })
  const [stockMap, setStockMap] = useState({})
  const [loading, setLoading]   = useState(true)
  const [sort, setSort]         = useState({ key: 'num_stocks', dir: 1 })
  const [query, setQuery]       = useState('')
  const [badgeErr, setBadgeErr] = useState('')

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

  const handleSort = (col) => {
    if (!col.sortKey) return
    setSort(prev =>
      prev.key === col.sortKey
        ? { key: col.sortKey, dir: -prev.dir }
        : { key: col.sortKey, dir: col.sortKey === 'num_stocks' ? 1 : -1 }
    )
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
    <p style={{ color: 'var(--text-3)', fontSize: 14 }}>
      데이터 없음 — "크롤링 설정" 탭에서 데이터를 가져오세요.
    </p>
  )

  // ── 모바일 카드 뷰 ────────────────────────────────────────
  if (isMobile) return (
    <div style={{ padding: '0 0 80px' }}>
      {data.last_updated && (
        <p style={{ color: 'var(--text-faint)', fontSize: 11, padding: '0 20px 8px' }}>
          마지막 갱신: {data.last_updated.slice(0, 10)}
        </p>
      )}

      {/* 검색 */}
      <div style={{ padding: '0 20px 10px' }}>
        <input
          className="m-list-search"
          placeholder="매니저명 / 펌 / 티커 검색..."
          value={query}
          onChange={e => setQuery(e.target.value)}
        />
      </div>

      {/* 정렬 칩 */}
      <div className="filter-chips" style={{ padding: '0 20px 12px', overflowX: 'auto', flexWrap: 'nowrap' }}>
        {SORT_OPTIONS.map(opt => (
          <button
            key={opt.key}
            className={sort.key === opt.key ? 'is-active' : ''}
            style={{ whiteSpace: 'nowrap' }}
            onClick={() => setSort(prev =>
              prev.key === opt.key ? { key: opt.key, dir: -prev.dir } : { key: opt.key, dir: opt.dir }
            )}
          >
            {opt.label}{sort.key === opt.key ? (sort.dir === 1 ? ' ↑' : ' ↓') : ''}
          </button>
        ))}
        {q && <span style={{ color: 'var(--text-3)', fontSize: 12, alignSelf: 'center', marginLeft: 4 }}>{sorted.length}/{data.managers.length}명</span>}
      </div>

      {/* 카드 목록 */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: '0 20px' }}>
        {sorted.map((m, i) => (
          <div key={m.id} style={{
            background: 'var(--bg-elev)', border: '1px solid var(--border)',
            borderRadius: 14, padding: '14px 16px',
          }}>
            {/* 헤더 */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 10 }}>
              <div style={{
                width: 40, height: 40, borderRadius: 12,
                background: 'var(--accent-soft)', color: 'var(--text-2)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontWeight: 700, fontSize: 13, flexShrink: 0,
              }}>
                {initials(m.name)}
              </div>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontWeight: 600, fontSize: 14, letterSpacing: '-0.01em', marginBottom: 2 }}>
                  {m.name.split(' - ')[0]}
                </div>
                <div style={{ fontSize: 11.5, color: 'var(--text-3)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {m.firm || m.name}
                </div>
              </div>
              <div style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--text-faint)', flexShrink: 0 }}>
                #{i + 1}
              </div>
            </div>

            {/* 통계 */}
            <div style={{ display: 'flex', gap: 16, marginBottom: 12 }}>
              <div>
                <div style={{ fontSize: 11, color: 'var(--text-3)', marginBottom: 2 }}>포트폴리오</div>
                <div style={{ fontSize: 14, fontWeight: 600 }}>{formatValue(m.portfolio_value)}</div>
              </div>
              <div>
                <div style={{ fontSize: 11, color: 'var(--text-3)', marginBottom: 2 }}>종목수</div>
                <div style={{ fontSize: 14, fontWeight: 600 }}>{m.num_stocks ?? '-'}</div>
              </div>
            </div>

            {/* Top10 배지 */}
            {(m.top10 || []).length > 0 && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
                {(m.top10 || []).map(h => {
                  const type = stockMap[h.ticker]
                  return (
                    <span
                      key={h.rank}
                      onClick={() => handleBadgeClick(h)}
                      title={`#${h.rank} ${h.name || h.ticker}${h.name_kr ? ` (${h.name_kr})` : ''} — ${h.weight_pct}%`}
                      style={{
                        ...badgeStyle(h.ticker),
                        borderRadius: 6, padding: '3px 8px',
                        fontSize: 12, fontWeight: 600,
                        cursor: type === 'holding' ? 'default' : 'pointer',
                      }}
                    >
                      {h.ticker}
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
        <p style={{ color: 'var(--text-3)', fontSize: 12, marginBottom: 8 }}>마지막 갱신: {data.last_updated.slice(0, 10)}</p>
      )}
      <div style={{ marginBottom: 14, display: 'flex', alignItems: 'center', gap: 8 }}>
        <Input
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="매니저명 / 펌 / 티커 검색..."
          style={{ width: 260 }}
        />
        {query && (
          <span style={{ color: 'var(--text-3)', fontSize: 12 }}>{sorted.length} / {data.managers.length}명</span>
        )}
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
          {SORT_OPTIONS.map(opt => (
            <button
              key={opt.key}
              onClick={() => setSort(prev =>
                prev.key === opt.key ? { key: opt.key, dir: -prev.dir } : { key: opt.key, dir: opt.dir }
              )}
              style={{
                padding: '4px 10px', borderRadius: 6, fontSize: 12, fontWeight: 500,
                border: '1px solid var(--border)', cursor: 'pointer',
                background: sort.key === opt.key ? 'var(--accent-soft)' : 'var(--bg-elev)',
                color: sort.key === opt.key ? 'var(--accent)' : 'var(--text-3)',
              }}
            >
              {opt.label}{sort.key === opt.key ? (sort.dir === 1 ? ' ↑' : ' ↓') : ''}
            </button>
          ))}
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 12 }}>
        {sorted.map((m, i) => (
          <div key={m.id} style={{
            background: 'var(--bg-elev)', border: '1px solid var(--border)',
            borderRadius: 14, padding: '16px 18px',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
              <div style={{
                width: 42, height: 42, borderRadius: 12,
                background: 'var(--accent-soft)', color: 'var(--text-2)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontWeight: 700, fontSize: 13, flexShrink: 0,
              }}>
                {initials(m.name)}
              </div>
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ fontWeight: 600, fontSize: 14, letterSpacing: '-0.01em', marginBottom: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {m.name.split(' - ')[0]}
                </div>
                <div style={{ fontSize: 12, color: 'var(--text-3)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {m.firm || m.name}
                </div>
              </div>
              <div style={{ fontSize: 11, color: 'var(--text-faint)', flexShrink: 0 }}>#{i + 1}</div>
            </div>

            <div style={{ display: 'flex', gap: 20, marginBottom: 12 }}>
              <div>
                <div style={{ fontSize: 11, color: 'var(--text-3)', marginBottom: 2 }}>포트폴리오</div>
                <div style={{ fontSize: 14, fontWeight: 600 }}>{formatValue(m.portfolio_value)}</div>
              </div>
              <div>
                <div style={{ fontSize: 11, color: 'var(--text-3)', marginBottom: 2 }}>종목수</div>
                <div style={{ fontSize: 14, fontWeight: 600 }}>{m.num_stocks ?? '-'}</div>
              </div>
            </div>

            {(m.top10 || []).length > 0 && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
                {(m.top10 || []).map(h => {
                  const type = stockMap[h.ticker]
                  const tooltip = `#${h.rank} ${h.name || h.ticker}${h.name_kr ? ` (${h.name_kr})` : ''} — ${h.weight_pct}%`
                    + (type === 'holding' ? '\n[보유중]' : type === 'watchlist' ? '\n[관심 — 클릭하여 삭제]' : '\n[클릭하여 관심종목 추가]')
                  return (
                    <span
                      key={h.rank}
                      title={tooltip}
                      onClick={() => handleBadgeClick(h)}
                      style={{
                        ...badgeStyle(h.ticker),
                        borderRadius: 6, padding: '3px 8px',
                        fontSize: 11, fontWeight: 600,
                        cursor: type === 'holding' ? 'default' : 'pointer',
                      }}
                    >
                      {h.ticker}
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

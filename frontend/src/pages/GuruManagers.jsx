import { useState, useEffect, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import api from '../api'
import useTrackedStocks from '../hooks/useTrackedStocks'
import LoadingSpinner from '../components/LoadingSpinner'
import Input from '../components/ui/Input'
import useIsMobile from '../hooks/useIsMobile'
import { SketchEmpty } from '../components/sketches'
import { splitManagerName } from '../utils/guruName'
import { fmtUsdCompact } from '../utils'

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

// 기본 정렬 = 첫 항목(포트폴리오 규모 내림차순) — 규모 큰 펀드가 위, 카드 #N 배지도 규모 순위가 된다(task#228)
const SORT_OPTIONS = [
  { key: 'portfolio_value', label: '포트폴리오 규모', dir: -1 },
  { key: 'num_stocks',      label: '종목수',   dir: -1 },  // 많은 것부터 (task#229 — 오름차순은 미검토 값이었다)
  { key: 'name',            label: '이름순',   dir: 1 },   // A→Z (task#229 — 내림차순=Z→A는 관례 위반)
]

function initials(name) {
  return name.split(/[\s-]+/).map(w => w[0]).join('').slice(0, 2).toUpperCase()
}

export default function GuruManagers() {
  const isMobile = useIsMobile()
  const navigate = useNavigate()
  const [data, setData]         = useState({ last_updated: null, managers: [] })
  const [loading, setLoading]   = useState(true)
  const { stockMap, unknown, toggle } = useTrackedStocks()
  const [sort, setSort]         = useState({ key: SORT_OPTIONS[0].key, dir: SORT_OPTIONS[0].dir })
  const [query, setQuery]       = useState('')
  const guruCounts = useMemo(() => buildGuruCounts(data.managers), [data.managers])

  useEffect(() => {
    api.get('/api/guru/managers')
      .then(({ data }) => setData(data))
      .finally(() => setLoading(false))
  }, [])

  const handleBadgeClick = (h) => {
    // 모름이면 아무 동작도 하지 않는다 — 빈 맵을 "미추적"으로 읽으면 이미 관심에 있는
    // 종목에 추가 요청을 보내게 된다(BH: B10 가족).
    if (unknown) return
    const type = stockMap[h.ticker]
    if (type === 'holding') return
    // 구루 보유는 전부 US 13F다. market:'US'는 백엔드 기본값과 같은 값이지만, 그 사실이
    // 코드에 적혀 있어야 다음 KR 소비처가 조용히 market='US'로 저장되는 재발을 막는다
    // (ADR-0032 §결정 2, 지우지 말 것).
    const ticker = h.ticker
    const name = h.name_kr || h.name || ticker
    return toggle({ ticker, name, market: 'US', exchange: '', security_type: 'EQUITY' }, type === 'watchlist')
  }

  const badgeStyle = (ticker) => {
    // 모름을 미추적 색으로 두면 "모름"이 "미추적"으로 보인다 — 흐려서 상태 없음을 드러낸다.
    if (unknown) return { background: 'var(--tag-track-bg)', color: 'var(--text-3)',
                          border: '1px dashed var(--border)', opacity: 0.5 }
    const type = stockMap[ticker]
    if (type === 'holding')   return { background: 'var(--tag-hold-bg)',  color: 'var(--tag-hold-color)',  border: '1px solid var(--tag-hold-border)' }
    if (type === 'watchlist') return { background: 'var(--tag-watch-bg)', color: 'var(--tag-watch-color)', border: '1px solid var(--tag-watch-border)' }
    return { background: 'var(--tag-track-bg)', color: 'var(--tag-track-color)', border: '1px solid var(--tag-track-border)' }
  }

  const q = query.trim().toLowerCase()
  const filtered = q
    ? data.managers.filter(m =>
        m.name.toLowerCase().includes(q) ||
        (m.top10 || []).some(h => h.ticker.toLowerCase().includes(q) || (h.name_kr || '').toLowerCase().includes(q))
      )
    : data.managers

  // 문자열 키는 로케일 비교 — 코드유닛 비교(av < bv)는 대문자를 소문자보다 앞세워
  // 'AKO Capital'을 'Abrams Bison Investments' 앞에 둬 이름순처럼 보이지 않았다(task#229)
  const sorted = [...filtered].sort((a, b) => {
    const av = a[sort.key] ?? ''
    const bv = b[sort.key] ?? ''
    const cmp = (typeof av === 'string' && typeof bv === 'string')
      ? av.localeCompare(bv)
      : (av < bv ? -1 : av > bv ? 1 : 0)
    return Math.sign(cmp) * sort.dir
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
          placeholder="운용역 / 펀드 / 티커 검색..."
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
        {sorted.map((m, i) => {
          const { person, fund } = splitManagerName(m.name)
          return (
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
                  {person || fund}
                </p>
                {/* 펀드 부제는 운용역이 따로 있을 때만 — 없으면 제목과 같은 문자열이 2줄로 반복된다(task#236) */}
                {person && <div className="guru-fund">{fund}</div>}
              </div>
              <div className="guru-rank">
                #{i + 1}
              </div>
            </div>

            {/* 통계 */}
            <div className="guru-stats">
              <div className="guru-stat">
                <div className="l">포트폴리오</div>
                <div className="v">{fmtUsdCompact(m.portfolio_value)}</div>
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
                      aria-disabled={unknown || undefined}
                      style={{
                        ...badgeStyle(h.ticker),
                        cursor: (unknown || type === 'holding') ? 'default' : 'pointer',
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
          )
        })}
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
          placeholder="운용역 / 펀드 / 티커 검색..."
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
        {sorted.map((m, i) => {
          const { person, fund } = splitManagerName(m.name)
          return (
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
                  {person || fund}
                </p>
                {/* 펀드 부제는 운용역이 따로 있을 때만 — 없으면 제목과 같은 문자열이 2줄로 반복된다(task#236) */}
                {person && <div className="guru-fund">{fund}</div>}
              </div>
              <div className="guru-rank">#{i + 1}</div>
            </div>

            <div className="guru-stats">
              <div className="guru-stat">
                <div className="l">포트폴리오</div>
                <div className="v">{fmtUsdCompact(m.portfolio_value)}</div>
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
                      aria-disabled={unknown || undefined}
                      style={{
                        ...badgeStyle(h.ticker),
                        cursor: (unknown || type === 'holding') ? 'default' : 'pointer',
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
          )
        })}
      </div>
    </div>
  )
}

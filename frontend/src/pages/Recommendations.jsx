import { useState, useEffect } from 'react'
import api from '../api'
import Card from '../components/ui/Card'
import Badge, { MarketBadge } from '../components/ui/Badge'
import LoadingSpinner from '../components/LoadingSpinner'
import { useToast } from '../components/Toast'

// 근거 플래그 칩 색 — ⚠️ 가격 토큰(success=빨/danger=파, ADR-0015) 금지.
// SupplyBadge식으로 neutral Badge에 kind별 전용색을 명시 지정한다.
// kind enum은 백엔드 derive_flags 출력(value/momentum/smart_money/missing).
const FLAG_STYLE = {
  value:       { background: 'rgba(79, 195, 247, 0.14)', color: '#4fc3f7', borderColor: 'rgba(79, 195, 247, 0.30)' },   // 밸류 — 블루
  momentum:    { background: 'rgba(245, 124, 0, 0.16)',  color: '#f57c00', borderColor: 'rgba(245, 124, 0, 0.32)' },    // 모멘텀 — 주황
  smart_money: { background: 'rgba(76, 175, 80, 0.14)',  color: '#4caf50', borderColor: 'rgba(76, 175, 80, 0.30)' },    // 스마트머니 — 초록
  missing:     { background: 'var(--bg-elev-2)',         color: 'var(--text-3)', borderColor: 'var(--border)' },        // 데이터 부족 — 회색 muted
}

const fmtScore = (s) => (s == null ? null : Number(s).toFixed(1))

export default function Recommendations() {
  const { showToast } = useToast()
  const [items, setItems] = useState([])
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

  if (items.length === 0) return (
    <div style={{ textAlign: 'center', color: 'var(--text-3)', fontSize: 13, padding: 32 }}>추천 종목이 없습니다.</div>
  )

  return (
    <div>
      {asOf && (
        <div style={{ fontSize: 11, color: 'var(--text-3)', marginBottom: 12 }}>기준 {asOf}</div>
      )}

      {/* 카드 그리드 — Ranking.jsx 관례(auto-fill minmax 260px, gap 10) */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 10 }}>
        {items.map((item, i) => {
          const t = item.ticker.toUpperCase()
          const isWatched = watched.has(t)
          const busy = pending.has(t)
          const score = fmtScore(item.score)
          return (
            <Card key={`${item.ticker}-${i}`} padding="sm" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {/* 헤더: 종목명/티커 + 시장 배지 */}
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ display: 'block', color: 'var(--text)', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.name || item.ticker}</span>
                  <span style={{ display: 'block', fontSize: 10, color: 'var(--text-3)' }}>{item.ticker}</span>
                </div>
                <MarketBadge market={item.market} />
              </div>

              {/* 추천 점수 */}
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
                {score != null ? (
                  <>
                    <span style={{ color: 'var(--accent)', fontWeight: 700, fontSize: 20, fontVariantNumeric: 'tabular-nums' }}>{score}</span>
                    <span style={{ fontSize: 11, color: 'var(--text-3)' }}>점</span>
                  </>
                ) : (
                  <span style={{ fontSize: 12, color: 'var(--text-3)' }}>점수 대기</span>
                )}
              </div>

              {/* 근거 플래그 칩 */}
              {item.flags && item.flags.length > 0 && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
                  {item.flags.map((flag, j) => (
                    <Badge key={j} variant="neutral" style={FLAG_STYLE[flag.kind] || FLAG_STYLE.missing}>
                      {flag.label}
                    </Badge>
                  ))}
                </div>
              )}

              {/* 딥다이브(관심추가) — 이미 추적 중이면 비활성 */}
              <button
                className="btn btn-primary"
                onClick={() => deepDive(item)}
                disabled={isWatched || busy}
                style={{ width: '100%', marginTop: 4 }}
              >
                {isWatched ? '관심종목 추가됨' : busy ? '추가 중…' : '딥다이브'}
              </button>
            </Card>
          )
        })}
      </div>
    </div>
  )
}

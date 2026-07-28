import { useState, useEffect } from 'react'
import { useParams, Link } from 'react-router-dom'
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from 'recharts'
import api from '../api'
import LoadingSpinner from '../components/LoadingSpinner'
import { SketchEmpty } from '../components/sketches'
import useIsMobile from '../hooks/useIsMobile'
import { WatchlistBtn } from './GuruStats'

// 구루 매니저 상세 (task#226 S4) — 상위 10종목 도넛 + 전 종목 목록.
// holdings(전 종목)는 크롤 후에만 존재 — 없으면 top10 + "기타 N종목 x%"로 graceful 폴백(도넛도 동일 폴백 공유).

const DONUT_COLORS = ['var(--data-1)', 'var(--data-2)', 'var(--data-3)', 'var(--data-4)', 'var(--data-5)']
const DEFAULT_ROWS = 20

function formatValue(val) {
  if (!val) return '-'
  if (val >= 1e12) return `$${(val / 1e12).toFixed(1)}T`
  if (val >= 1e9)  return `$${(val / 1e9).toFixed(1)}B`
  if (val >= 1e6)  return `$${(val / 1e6).toFixed(1)}M`
  return `$${val.toLocaleString()}`
}

export default function GuruDetail() {
  const { id } = useParams()
  const isMobile = useIsMobile()
  const [manager, setManager] = useState(null)
  const [error, setError]     = useState(null)
  const [loading, setLoading] = useState(true)
  const [stockMap, setStockMap] = useState({})
  const [expanded, setExpanded] = useState(false)

  const loadStockMap = () => {
    api.get('/api/stocks').then(({ data }) => {
      const map = {}
      data.forEach(s => { map[s.ticker] = s.type })
      setStockMap(map)
    })
  }

  useEffect(() => {
    setLoading(true)
    setError(null)
    setExpanded(false)
    api.get(`/api/guru/managers/${id}`)
      .then(({ data }) => setManager(data))
      .catch((e) => {
        console.error('[GuruDetail] 매니저 조회 실패:', e)
        setError(e.response?.status === 404 ? '매니저를 찾을 수 없습니다.' : '매니저 정보를 불러오지 못했습니다.')
      })
      .finally(() => setLoading(false))
    loadStockMap()
  }, [id])

  const handleToggle = async (ticker, name, inWatchlist) => {
    if (inWatchlist) {
      await api.delete(`/api/watchlist/${ticker}`)
    } else {
      await api.post('/api/watchlist', { ticker, name: name || ticker })
    }
    loadStockMap()
  }

  if (loading) return <LoadingSpinner label="구루 매니저 정보 불러오는 중입니다." />
  if (error) return (
    <div style={{ textAlign: 'center', padding: '48px 16px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
      <div className="sketch-draw" style={{ color: 'var(--text-3)' }}><SketchEmpty size={140} /></div>
      <p className="muted" style={{ fontSize: 14, margin: 0 }}>{error}</p>
      <Link to="/guru" style={{ color: 'var(--accent)', fontSize: 13 }}>← 구루 매니저 목록으로</Link>
    </div>
  )

  const top10 = manager.top10 || []
  const holdings = manager.holdings || null   // null = 크롤 이전(폴백)
  const top10Sum = top10.reduce((s, h) => s + (h.weight_pct || 0), 0)
  const otherCount = Math.max(0, (manager.num_stocks || 0) - top10.length)
  const otherPct = Math.max(0, 100 - top10Sum)

  const donutData = [
    ...top10.map(h => ({ name: h.ticker, value: h.weight_pct || 0 })),
    ...(otherCount > 0 ? [{ name: `기타 ${otherCount}종목`, value: otherPct, isOther: true }] : []),
  ]

  const listRows = holdings || top10
  const visibleRows = expanded ? listRows : listRows.slice(0, DEFAULT_ROWS)

  const body = (
    <>
      {/* eco: .kpi-row 기본은 4열(pc.css) — KPI 3개뿐이라 PC만 3열로 오버라이드.
          인라인은 미디어쿼리를 이기므로 모바일에선 걸지 않는다(App.css의 2열 규칙 유지 — 안 그러면 라벨이 2줄로 접힘) */}
      <div className="kpi-row" style={isMobile ? undefined : { gridTemplateColumns: 'repeat(3, 1fr)' }}>
        <div className="kpi">
          <div className="label">포트폴리오 규모</div>
          <div className="val">{formatValue(manager.portfolio_value)}</div>
        </div>
        <div className="kpi">
          <div className="label">보유 종목수</div>
          <div className="val">{manager.num_stocks ?? '-'}</div>
        </div>
        <div className="kpi">
          <div className="label">상위 10종목 비중</div>
          <div className="val">{top10Sum.toFixed(1)}%</div>
        </div>
      </div>

      {donutData.length > 0 && (
        <div style={{ display: 'flex', gap: 32, alignItems: 'center', flexWrap: 'wrap', marginBottom: 32 }}>
          <ResponsiveContainer width={240} height={240} style={{ flexShrink: 0 }}>
            <PieChart>
              <Pie data={donutData} dataKey="value" innerRadius={70} outerRadius={110} paddingAngle={2}>
                {donutData.map((d, i) => (
                  <Cell key={d.name} fill={d.isOther ? 'var(--neutral)' : DONUT_COLORS[i % DONUT_COLORS.length]} />
                ))}
              </Pie>
              <Tooltip
                formatter={(v, n) => [`${Number(v).toFixed(1)}%`, n]}
                contentStyle={{ background: 'var(--bg-elev)', border: '1px solid var(--border)', fontSize: 12 }}
              />
            </PieChart>
          </ResponsiveContainer>
          <table style={{ borderCollapse: 'collapse', fontSize: 13 }}>
            <tbody>
              {top10.map((h, i) => (
                <tr key={h.rank ?? h.ticker}>
                  <td style={{ paddingRight: 16, paddingTop: 4, color: 'var(--text)' }}>
                    <span style={{
                      width: 10, height: 10, borderRadius: 2,
                      background: DONUT_COLORS[i % DONUT_COLORS.length],
                      display: 'inline-block', marginRight: 6, verticalAlign: 'middle',
                    }} />
                    {h.ticker}
                    <span style={{ color: 'var(--text-3)', marginLeft: 6 }}>{h.name_kr || h.name || ''}</span>
                  </td>
                  <td className="mono tnum" style={{ textAlign: 'right', paddingTop: 4, color: 'var(--text)' }}>
                    {(h.weight_pct ?? 0).toFixed(1)}%
                  </td>
                </tr>
              ))}
              {otherCount > 0 && (
                <tr>
                  <td style={{ paddingRight: 16, paddingTop: 4, color: 'var(--text-3)' }}>
                    <span style={{
                      width: 10, height: 10, borderRadius: 2, background: 'var(--neutral)',
                      display: 'inline-block', marginRight: 6, verticalAlign: 'middle',
                    }} />
                    기타 {otherCount}종목
                  </td>
                  <td className="mono tnum" style={{ textAlign: 'right', paddingTop: 4, color: 'var(--text-3)' }}>
                    {otherPct.toFixed(1)}%
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      <p className="serif" style={{ fontSize: 16, fontWeight: 700, margin: '0 0 10px' }}>보유 종목</p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {visibleRows.map((h, i) => (
          <div key={h.rank ?? h.ticker} data-testid="holding-row" style={{
            display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px',
            border: '1px solid var(--border)', borderRadius: 6,
          }}>
            <span style={{ fontSize: 11, color: 'var(--text-faint)', fontWeight: 600, minWidth: 20 }}>{h.rank ?? i + 1}</span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 700, fontSize: 13, color: 'var(--accent)' }}>{h.ticker}</div>
              {(h.name_kr || h.name) && (
                <div style={{ fontSize: 11, color: 'var(--text-3)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {h.name_kr || h.name}
                </div>
              )}
            </div>
            <span className="mono tnum" style={{ fontSize: 13, fontWeight: 600 }}>{(h.weight_pct ?? 0).toFixed(1)}%</span>
            <WatchlistBtn ticker={h.ticker} name={h.name_kr || h.name} stockMap={stockMap} onToggle={handleToggle} />
          </div>
        ))}
      </div>

      {!holdings && otherCount > 0 && (
        <p className="muted" style={{ fontSize: 12, marginTop: 10 }}>기타 {otherCount}종목 · {otherPct.toFixed(1)}%</p>
      )}

      {holdings && holdings.length > DEFAULT_ROWS && (
        <button className="filter-chip" style={{ marginTop: 12 }} onClick={() => setExpanded(e => !e)}>
          {expanded ? '접기' : `전체 ${holdings.length}종목 보기`}
        </button>
      )}
    </>
  )

  if (isMobile) return (
    <>
      <header className="appbar">
        <h1>{manager.name}</h1>
      </header>
      <div className="m-page">
        <Link to="/guru" style={{ fontSize: 12, color: 'var(--text-3)' }}>← 구루 매니저</Link>
        {manager.firm && <p className="muted" style={{ fontSize: 13, margin: '4px 0 14px' }}>{manager.firm}</p>}
        {body}
      </div>
    </>
  )

  return (
    <div className="page">
      <div className="page-head" style={{ flexDirection: 'column', alignItems: 'flex-start', gap: 4 }}>
        <Link to="/guru" style={{ fontSize: 12, color: 'var(--text-3)' }}>← 구루 매니저</Link>
        <h1 className="page-title serif">{manager.name}</h1>
        {manager.firm && <p className="muted" style={{ fontSize: 13, margin: 0 }}>{manager.firm}</p>}
      </div>
      {body}
    </div>
  )
}

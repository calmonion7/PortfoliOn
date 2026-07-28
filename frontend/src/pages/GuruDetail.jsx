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
const PAD_ANGLE = 2
const LABEL_CHAR_W = 6.2   // 10px 볼드 라틴 문자 1자의 대략 폭

// 조각 위 라벨은 "그 조각이 라벨을 담을 만큼 클 때만" 그린다 — 호 길이를 직접 재서 판정한다(task#235).
// 고정 임계값(8% 등)은 도넛 크기를 바꾸는 순간 틀려서 라벨이 조각 밖으로 삐져나온다.
export function fitsSliceLabel({ percent, innerRadius, outerRadius, ticker, paddingAngle = PAD_ANGLE }) {
  const span = Math.max(0, (percent || 0) * 360 - paddingAngle)
  const midR = ((innerRadius || 0) + (outerRadius || 0)) / 2
  const arc = 2 * Math.PI * midR * (span / 360)
  const labelW = Math.max((ticker || '').length * LABEL_CHAR_W, 30) + 8   // 2줄이므로 티커·"00.0%" 중 넓은 쪽
  return arc >= labelW && (outerRadius || 0) - (innerRadius || 0) >= 26   // 2줄이 들어갈 밴드 두께
}

// 라벨 색은 var(--bg) — 라이트는 크림이 어두운 데이터색 위에, 다크는 잉크가 밝은 데이터색 위에
// 얹혀 양 테마 자동 대응(대비 5.23~8.27:1).
function renderSliceLabel(p) {
  const { cx, cy, midAngle, innerRadius, outerRadius, percent } = p
  const name = p.name ?? p.payload?.name ?? ''
  const value = p.value ?? p.payload?.value ?? 0
  if (!fitsSliceLabel({ percent, innerRadius, outerRadius, ticker: name })) return null
  const rad = -midAngle * Math.PI / 180
  const r = (innerRadius + outerRadius) / 2
  const x = cx + r * Math.cos(rad)
  const y = cy + r * Math.sin(rad)
  return (
    <text x={x} y={y} fill="var(--bg)" textAnchor="middle" dominantBaseline="central">
      <tspan x={x} dy="-0.35em" fontSize={10} fontWeight={700}>{name}</tspan>
      <tspan x={x} dy="1.2em" fontSize={9} fontWeight={400}>{Number(value).toFixed(1)}%</tspan>
    </text>
  )
}

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

  // holdings에는 name_kr이 없다(꼬리 종목 한글명 조회는 Non-goal) — 상위 10종목은 top10에 이미
  // 있는 한글명을 얹어 범례(한글)와 목록(영문) 불일치를 없앤다. 11위 이하는 영문명 그대로.
  const krByTicker = Object.fromEntries(top10.filter(h => h.name_kr).map(h => [h.ticker, h.name_kr]))
  const listRows = (holdings || top10).map(h => (
    h.name_kr || !krByTicker[h.ticker] ? h : { ...h, name_kr: krByTicker[h.ticker] }
  ))
  const visibleRows = expanded ? listRows : listRows.slice(0, DEFAULT_ROWS)

  const body = (
    <>
      {/* eco: .kpi-row 기본은 4열(pc.css) — KPI 2개뿐이라 PC만 2열로 오버라이드.
          인라인은 미디어쿼리를 이기므로 모바일에선 걸지 않는다(App.css의 2열 규칙 유지 — 안 그러면 라벨이 2줄로 접힘).
          「상위 N종목 비중」은 도넛 중앙으로 이관 — 3장이면 모바일 2열에서 3번째가 홀로 2행이 됐다(task#235) */}
      <div className="kpi-row" style={isMobile ? undefined : { gridTemplateColumns: 'repeat(2, 1fr)' }}>
        <div className="kpi">
          <div className="label">포트폴리오 규모</div>
          <div className="val">{formatValue(manager.portfolio_value)}</div>
        </div>
        <div className="kpi">
          <div className="label">보유 종목수</div>
          <div className="val">{manager.num_stocks ?? '-'}</div>
        </div>
      </div>

      {/* 별도 범례표 없이 도넛 자체로 읽는다 — 큰 조각엔 조각 위 라벨, 비중 합계는 중앙 hole.
          작은 조각은 라벨을 생략하지만 바로 아래 「보유 종목」 목록이 전 종목의 티커·한글명·비중을
          이미 보여주므로 정보 손실이 없다(구 범례표는 그 목록과 중복이었다, task#235).
          모바일/PC 분기 없이 폭 100%·최대 360px로 반응 — 반지름을 %로 줘 컨테이너에 맞춘다. */}
      {donutData.length > 0 && (
        <div style={{ position: 'relative', width: '100%', maxWidth: 360, marginBottom: 32 }}>
          <ResponsiveContainer width="100%" height={320}>
            <PieChart>
              <Pie
                data={donutData} dataKey="value" innerRadius="54%" outerRadius="84%"
                paddingAngle={PAD_ANGLE} labelLine={false} label={renderSliceLabel} isAnimationActive={false}
              >
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
          {/* 중앙 요약 = 구 「상위 10종목 비중」 KPI. SVG <text>가 아니라 HTML 오버레이 —
              jsdom은 recharts를 렌더하지 않으므로 이래야 단위테스트로 관측된다.
              top10이 비면(기타 100%) 표기할 상위 종목이 없어 생략. 문구는 실제 개수로 — 10개 미만 매니저가 있다 */}
          {top10.length > 0 && (
            <div style={{
              position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column',
              alignItems: 'center', justifyContent: 'center', gap: 2, pointerEvents: 'none',
            }}>
              <span style={{ fontSize: 11, color: 'var(--text-3)' }}>상위 {top10.length}종목</span>
              <span className="mono tnum" style={{ fontSize: 22, fontWeight: 700 }}>{top10Sum.toFixed(1)}%</span>
            </div>
          )}
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
        {/* firm은 바로 아래 줄에 따로 표시되므로 이름 앞부분만 — 목록 카드와 같은 표기.
            전체 이름은 2줄로 접혀 스크롤 시 헤더 아래 잔여를 남겼다(task#229) */}
        <h1>{manager.name.split(' - ')[0]}</h1>
      </header>
      <div className="m-page">
        <Link to="/guru" style={{ fontSize: 12, color: 'var(--text-3)' }}>← 구루 매니저</Link>
        {manager.firm && <p className="muted" style={{ fontSize: 13, margin: '4px 0 14px' }}>{manager.firm}</p>}
        {body}
      </div>
      {/* 목록 복귀 — 좌하단 플로팅 pill(task#228). fixed이므로 조상에 transform 금지(task#195) */}
      <Link to="/guru" className="list-pill list-pill--left">← 목록</Link>
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
      {/* 목록 복귀 — 좌하단 플로팅 pill(task#228). fixed이므로 조상에 transform 금지(task#195) */}
      <Link to="/guru" className="list-pill list-pill--left">← 목록</Link>
    </div>
  )
}

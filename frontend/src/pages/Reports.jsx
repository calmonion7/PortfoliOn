import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import axios from 'axios'

import { LineChart, Line, BarChart, Bar, Cell, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine, LabelList } from 'recharts'

const TAB_STYLE = (active) => ({
  padding: '6px 14px',
  cursor: 'pointer',
  border: 'none',
  borderBottom: active ? '2px solid var(--accent)' : '2px solid transparent',
  background: 'transparent',
  color: active ? 'var(--accent)' : 'var(--text-muted)',
  fontWeight: active ? 600 : 400,
  fontSize: 13,
})

const TH = { padding: '6px 10px', textAlign: 'right', borderBottom: '1px solid var(--border)', whiteSpace: 'nowrap', fontSize: 11, color: 'var(--text-muted)', position: 'sticky', top: 0, zIndex: 2, background: 'var(--bg-surface)' }
const TD = { padding: '5px 10px', textAlign: 'right', borderBottom: '1px solid var(--border)', fontSize: 12 }

const fmt = (val, market) => {
  if (val == null) return 'N/A'
  if (market === 'KR') return `₩${Number(val).toLocaleString('ko-KR', { maximumFractionDigits: 0 })}`
  return `$${Number(val).toFixed(2)}`
}
const fmtN = (val) => val != null ? val : 'N/A'
const rsiColor = (rsi) => {
  if (rsi == null) return 'var(--text-muted)'
  const hue = Math.round(120 - (rsi / 100) * 120)
  return `hsl(${hue}, 60%, 60%)`
}

const fmtGap = (target, price) => {
  if (target == null || !price) return null
  const pct = (target - price) / price * 100
  return { text: `${pct >= 0 ? '+' : ''}${pct.toFixed(1)}%`, positive: pct >= 0 }
}

function TargetTooltip({ s }) {
  const [visible, setVisible] = useState(false)
  const ref = useRef(null)
  const [pos, setPos] = useState({ top: 0, left: 0 })

  const total = (s?.buy ?? 0) + (s?.hold ?? 0) + (s?.sell ?? 0)
  const pct = (n) => total > 0 ? ` (${Math.round(n / total * 100)}%)` : ''
  const gap = s?.target_mean != null && s?.price != null
    ? ((s.target_mean - s.price) / s.price * 100)
    : null

  const handleMouseEnter = (e) => {
    const rect = e.currentTarget.getBoundingClientRect()
    setPos({ top: rect.bottom + 4, left: rect.left })
    setVisible(true)
  }

  return (
    <div ref={ref} style={{ display: 'inline-block', position: 'relative' }}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={() => setVisible(false)}
    >
      {s ? fmt(s.target_mean, s.market) : 'N/A'}
      {gap != null && <div style={{ color: gap >= 0 ? '#81c784' : '#ef9a9a', fontSize: 10 }}>{gap >= 0 ? '+' : ''}{gap.toFixed(1)}%</div>}
      {visible && s?.target_mean != null && (
        <div style={{
          position: 'fixed',
          top: pos.top,
          left: pos.left,
          zIndex: 9999,
          background: 'var(--bg-card)',
          border: '1px solid var(--border)',
          borderRadius: 6,
          padding: '10px 14px',
          minWidth: 200,
          fontSize: 12,
          color: 'var(--text)',
          boxShadow: '0 4px 16px rgba(0,0,0,0.6)',
          pointerEvents: 'none',
          lineHeight: 1.8,
        }}>
          <div style={{ color: 'var(--accent)', fontWeight: 700, marginBottom: 6, fontSize: 11 }}>목표가 근거</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '2px 10px' }}>
            <span style={{ color: 'var(--text-muted)' }}>평균</span>
            <span style={{ color: 'var(--text)', fontWeight: 600 }}>{fmt(s.target_mean, s.market)}{gap != null && <span style={{ color: gap >= 0 ? '#81c784' : '#ef9a9a', marginLeft: 4 }}>{gap >= 0 ? '+' : ''}{gap.toFixed(1)}%</span>}</span>
            <span style={{ color: 'var(--text-muted)' }}>최고</span>
            <span style={{ color: '#81c784' }}>{fmt(s.target_high, s.market)}</span>
            <span style={{ color: 'var(--text-muted)' }}>최저</span>
            <span style={{ color: '#ef9a9a' }}>{fmt(s.target_low, s.market)}</span>
            <span style={{ color: 'var(--text-muted)' }}>애널리스트</span>
            <span>{total > 0 ? `${total}명` : 'N/A'}</span>
            <span style={{ color: 'var(--text-muted)' }}>Buy</span>
            <span style={{ color: '#81c784' }}>{s.buy ?? 0}{pct(s.buy ?? 0)}</span>
            <span style={{ color: 'var(--text-muted)' }}>Hold</span>
            <span>{s.hold ?? 0}{pct(s.hold ?? 0)}</span>
            <span style={{ color: 'var(--text-muted)' }}>Sell</span>
            <span style={{ color: '#ef9a9a' }}>{s.sell ?? 0}{pct(s.sell ?? 0)}</span>
            {s.finviz_recom != null && <>
              <span style={{ color: 'var(--text-muted)' }}>Finviz</span>
              <span>{s.finviz_recom} <span style={{ color: 'var(--text-muted)', fontSize: 10 }}>(1=강매수)</span></span>
            </>}
          </div>
        </div>
      )}
    </div>
  )
}

const GapCell = ({ target, price, baseColor, highlight, market }) => {
  const gap = fmtGap(target, price)
  return (
    <td style={{ ...TD, color: baseColor, background: highlight ? 'var(--bg-hover)' : undefined, border: highlight ? '2px solid var(--accent)' : undefined, fontWeight: highlight ? 700 : undefined }}>
      {target != null ? <>{fmt(target, market)}{gap && <span style={{ color: gap.positive ? '#81c784' : '#ef9a9a' }}>({gap.text})</span>}</> : 'N/A'}
    </td>
  )
}

function PriceLevelChart({ rsiData, price, vp, target, title, market }) {
  if (!price && !vp?.poc) return null
  const levels = [
    ...(vp?.hvn || []).map((h, i) => ({ value: h, label: `HVN${i + 1}`, color: '#81c784', size: 'sm' })),
    vp?.poc != null && { value: vp.poc, label: 'POC', color: '#80cbc4', size: 'md' },
    target != null && { value: target, label: '평균목표가', color: '#ffcc80', size: 'md' },
    rsiData?.target_20 != null && { value: rsiData.target_20, label: 'RSI20', color: '#81c784', size: 'sm' },
    rsiData?.target_25 != null && { value: rsiData.target_25, label: 'RSI25', color: '#81c784', size: 'sm' },
    rsiData?.target_30 != null && { value: rsiData.target_30, label: 'RSI30', color: '#81c784', size: 'sm' },
    rsiData?.target_70 != null && { value: rsiData.target_70, label: 'RSI70', color: '#ef9a9a', size: 'sm' },
    rsiData?.target_75 != null && { value: rsiData.target_75, label: 'RSI75', color: '#ef9a9a', size: 'sm' },
    rsiData?.target_80 != null && { value: rsiData.target_80, label: 'RSI80', color: '#ef9a9a', size: 'sm' },
    price != null && { value: price, label: `현재가${rsiData?.rsi != null ? ` (RSI ${rsiData.rsi.toFixed(1)})` : ''}`, color: '#ffffff', size: 'lg' },
  ].filter(Boolean)
  if (levels.length === 0) return null
  const vals = levels.map(l => l.value)
  const span = Math.max(...vals) - Math.min(...vals)
  const pad = span > 0 ? span * 0.15 : Math.max(...vals) * 0.02
  const lo = Math.min(...vals) - pad
  const hi = Math.max(...vals) + pad
  const pct = v => ((v - lo) / (hi - lo)) * 100
  const sorted = [...levels].sort((a, b) => a.value - b.value)
  sorted.forEach((l, i) => { l.above = i % 2 === 0 })
  const BAR_TOP = 46
  return (
    <div style={{ marginTop: 8 }}>
      {title && <div style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 4 }}>{title}</div>}
      <div style={{ position: 'relative', height: 100 }}>
        <div style={{ position: 'absolute', top: BAR_TOP, left: 0, right: 0, height: 8, borderRadius: 4, overflow: 'hidden' }}>
          <div style={{ position: 'absolute', inset: 0, background: 'var(--chart-grid)' }} />
          {price != null && <>
            <div style={{ position: 'absolute', inset: 0, right: `${100 - pct(price)}%`, background: 'rgba(129,199,132,0.3)' }} />
            <div style={{ position: 'absolute', inset: 0, left: `${pct(price)}%`, background: 'rgba(239,154,154,0.3)' }} />
          </>}
        </div>
        {levels.map((l, i) => {
          const isLg = l.size === 'lg', isMd = l.size === 'md'
          const tickH = isLg ? 16 : isMd ? 11 : 9
          return (
            <div key={i} style={{ position: 'absolute', left: `${pct(l.value)}%`, top: BAR_TOP + 4 - tickH / 2, transform: 'translateX(-50%)' }}>
              <div style={{ width: isLg ? 3 : 2, height: tickH, background: l.color, margin: '0 auto', borderRadius: 1 }} />
              <div style={{
                position: 'absolute', left: '50%', transform: 'translateX(-50%)',
                ...(l.above ? { bottom: '100%', marginBottom: 3 } : { top: '100%', marginTop: 3 }),
                textAlign: 'center', whiteSpace: 'nowrap',
              }}>
                <div style={{ fontSize: isLg ? 11 : 9, color: l.color, fontWeight: isLg ? 700 : 400, lineHeight: 1.4 }}>{l.label}</div>
                <div style={{ fontSize: 9, color: l.color, opacity: 0.85 }}>{fmt(l.value, market)}</div>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function RsiTable({ dailyRsi, weeklyRsi, monthlyRsi, price, vp, target, market }) {
  if (!dailyRsi) return null
  const rows = [
    { label: '일봉', d: dailyRsi },
    { label: '주봉', d: weeklyRsi },
    { label: '월봉', d: monthlyRsi },
  ]
  const keys = ['target_20', 'target_25', 'target_30', 'target_70', 'target_75', 'target_80']
  let closestKey = null, minDiff = Infinity
  if (price && dailyRsi) {
    keys.forEach(k => {
      if (dailyRsi[k] == null) return
      const diff = Math.abs(dailyRsi[k] - price)
      if (diff < minDiff) { minDiff = diff; closestKey = k }
    })
  }
  return (
    <div style={{ marginBottom: 16, overflowX: 'auto', background: 'var(--bg-card)', borderRadius: 6, padding: '10px 12px' }}>
      <div style={{ color: 'var(--accent)', fontWeight: 700, fontSize: 12, marginBottom: 8 }}>🎯 RSI 예상 타점</div>
      <table style={{ borderCollapse: 'collapse', fontSize: 12, color: 'var(--text)' }}>
        <thead>
          <tr style={{ background: 'var(--bg-surface)' }}>
            <th style={{ ...TH, textAlign: 'left', color: 'var(--text-muted)' }}>시간대</th>
            <th style={{ ...TH, color: '#81c784' }}>RSI20</th>
            <th style={{ ...TH, color: '#81c784' }}>RSI25</th>
            <th style={{ ...TH, color: '#81c784' }}>RSI30</th>
            <th style={{ ...TH, color: 'var(--text-muted)' }}>현재RSI</th>
            <th style={{ ...TH, color: '#ef9a9a' }}>RSI70</th>
            <th style={{ ...TH, color: '#ef9a9a' }}>RSI75</th>
            <th style={{ ...TH, color: '#ef9a9a' }}>RSI80</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ label, d }) => d?.rsi != null && (
            <tr key={label}>
              <td style={{ ...TD, textAlign: 'left', color: 'var(--text-muted)', fontWeight: 600 }}>{label}</td>
              <GapCell target={d.target_20} price={price} baseColor="#81c784" highlight={closestKey === 'target_20'} market={market} />
              <GapCell target={d.target_25} price={price} baseColor="#81c784" highlight={closestKey === 'target_25'} market={market} />
              <GapCell target={d.target_30} price={price} baseColor="#81c784" highlight={closestKey === 'target_30'} market={market} />
              <td style={{ ...TD, color: rsiColor(d.rsi), fontWeight: 600 }}>{fmtN(d.rsi)}</td>
              <GapCell target={d.target_70} price={price} baseColor="#ef9a9a" highlight={closestKey === 'target_70'} market={market} />
              <GapCell target={d.target_75} price={price} baseColor="#ef9a9a" highlight={closestKey === 'target_75'} market={market} />
              <GapCell target={d.target_80} price={price} baseColor="#ef9a9a" highlight={closestKey === 'target_80'} market={market} />
            </tr>
          ))}
        </tbody>
      </table>
      {(vp || target) && (
        <div style={{ marginTop: 16, display: 'flex', flexDirection: 'column', gap: 20 }}>
          {rows.map(({ label, d }) => d?.rsi != null && (
            <div key={label}>
              <div style={{ fontSize: 11, color: 'var(--accent)', fontWeight: 600, marginBottom: 2 }}>{label}</div>
              <PriceLevelChart rsiData={d} price={price} vp={vp} target={target} market={market} />
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

const MetricCard = ({ label, value, sub, valueColor }) => (
  <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 5, padding: '5px 8px' }}>
    <div style={{ color: 'var(--text-muted)', fontSize: 10, marginBottom: 2 }}>{label}</div>
    <div style={{ fontWeight: 700, fontSize: 12, color: valueColor ?? 'var(--text)' }}>{value}</div>
    {sub && <div style={{ color: 'var(--text-muted)', fontSize: 9, marginTop: 1 }}>{sub}</div>}
  </div>
)

const SectionTitle = ({ children }) => (
  <div style={{ color: 'var(--accent)', fontWeight: 700, fontSize: 12, letterSpacing: '0.3px', marginBottom: 10 }}>
    {children}
  </div>
)

function ConsensusChart({ ticker, market }) {
  const [data, setData] = useState([])
  const [collecting, setCollecting] = useState(false)
  const [backfilling, setBackfilling] = useState(false)
  const [error, setError] = useState(null)

  const fetchData = useCallback(() => {
    if (!ticker) return
    axios.get(`/api/consensus/${ticker}`)
      .then(({ data }) => setData(data))
      .catch(() => setError('데이터 조회 실패'))
  }, [ticker])

  useEffect(() => { fetchData() }, [fetchData])

  const collect = async () => {
    setCollecting(true)
    setError(null)
    try {
      await axios.post(`/api/consensus/${ticker}`)
      fetchData()
    } catch (e) {
      setError(e.response?.data?.detail || '수집 실패')
    } finally {
      setCollecting(false)
    }
  }

  const backfill = async () => {
    setBackfilling(true)
    setError(null)
    try {
      const { data: result } = await axios.post(`/api/consensus/${ticker}/backfill`)
      if (result.added > 0) fetchData()
    } catch (e) {
      setError(e.response?.data?.detail || '백필 실패')
    } finally {
      setBackfilling(false)
    }
  }

  const ascData = useMemo(() => [...data].reverse(), [data])

  const opinionData = useMemo(() => {
    if (ascData.length <= 2) return ascData
    const allSame = ascData.every(d => d.buy === ascData[0].buy && d.hold === ascData[0].hold && d.sell === ascData[0].sell)
    return allSame ? [ascData[0], ascData[ascData.length - 1]] : ascData
  }, [ascData])

  const axisStyle = { fontSize: 10, fill: 'var(--text-muted)' }
  const chartMargin = { top: 22, right: 16, left: 0, bottom: 0 }

  const targetDot = (props) => {
    const { cx, cy, index, value } = props
    if (value == null) return <g key={index} />
    const prev = ascData.slice(0, index).reverse().find(d => d.target_mean != null)
    const delta = prev != null ? value - prev.target_mean : null
    const pct = delta != null ? (delta / prev.target_mean * 100) : null
    const up = delta >= 0
    const color = delta === null ? '#ffcc80' : up ? '#81c784' : '#ef9a9a'
    const label = delta != null
      ? `${up ? '↑' : '↓'} ${fmt(Math.abs(delta), market)} (${Math.abs(pct).toFixed(1)}%)`
      : null
    return (
      <g key={index}>
        <circle cx={cx} cy={cy} r={3} fill="#ffcc80" />
        {label && (
          <text x={cx} y={up ? cy - 8 : cy + 14} textAnchor="middle" fontSize={8} fill={color}>{label}</text>
        )}
      </g>
    )
  }

  const makeDot = (color, dataKey) => (props) => {
    const { cx, cy, index, value } = props
    if (value == null) return <g key={index} />
    const prev = opinionData[index - 1]
    const delta = prev != null ? value - prev[dataKey] : null
    const up = delta > 0
    const labelColor = delta == null || delta === 0 ? color : up ? '#81c784' : '#ef9a9a'
    const label = delta != null && delta !== 0
      ? `${up ? '↑' : '↓'} ${up ? '+' : ''}${delta} (${Math.abs((delta / prev[dataKey]) * 100).toFixed(0)}%)`
      : null
    return (
      <g key={index}>
        <circle cx={cx} cy={cy} r={3} fill={color} />
        {label && (
          <text x={cx} y={up ? cy - 8 : cy + 14} textAnchor="middle" fontSize={8} fill={labelColor}>{label}</text>
        )}
      </g>
    )
  }

  const targetTooltip = ({ active, payload, label }) => {
    if (!active || !payload?.length) return null
    return (
      <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 6, padding: '8px 12px', fontSize: 11 }}>
        <div style={{ color: 'var(--accent)', fontWeight: 700, marginBottom: 4 }}>{label}</div>
        <div style={{ color: '#ffcc80' }}>평균목표가: {fmt(payload[0].value, market)}</div>
      </div>
    )
  }

  const opinionTooltip = ({ active, payload, label }) => {
    if (!active || !payload?.length) return null
    const total = payload.reduce((s, p) => s + (p.value ?? 0), 0)
    return (
      <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 6, padding: '8px 12px', fontSize: 11 }}>
        <div style={{ color: 'var(--accent)', fontWeight: 700, marginBottom: 4 }}>{label}</div>
        {payload.map(p => (
          <div key={p.dataKey} style={{ color: p.fill, marginBottom: 2 }}>
            {p.name}: {p.value ?? 0}{total > 0 ? ` (${Math.round((p.value ?? 0) / total * 100)}%)` : ''}
          </div>
        ))}
      </div>
    )
  }

  return (
    <div style={{ background: 'var(--bg-card)', borderRadius: 6, padding: '8px 10px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <div style={{ color: 'var(--accent)', fontWeight: 700, fontSize: 12, letterSpacing: '0.3px' }}>📈 컨센서스 추이</div>
        <div style={{ display: 'flex', gap: 6 }}>
          <button
            onClick={backfill}
            disabled={backfilling}
            style={{
              background: 'transparent', border: '1px solid var(--border)',
              color: backfilling ? 'var(--accent)' : 'var(--text-muted)',
              borderRadius: 3, padding: '2px 8px', fontSize: 11,
              cursor: backfilling ? 'default' : 'pointer',
            }}
          >
            {backfilling ? '백필 중...' : '백필'}
          </button>
          <button
            onClick={collect}
            disabled={collecting}
            style={{
              background: 'transparent', border: '1px solid var(--border)',
              color: collecting ? 'var(--accent)' : 'var(--text-muted)',
              borderRadius: 3, padding: '2px 8px', fontSize: 11,
              cursor: collecting ? 'default' : 'pointer',
            }}
          >
            {collecting ? '수집 중...' : '수집'}
          </button>
        </div>
      </div>
      {error && <div style={{ color: '#ef9a9a', fontSize: 11, marginBottom: 6 }}>{error}</div>}
      {ascData.length === 0 ? (
        <div style={{ color: 'var(--text-muted)', fontSize: 12, textAlign: 'center', padding: '16px 0' }}>
          아직 수집된 데이터가 없습니다. 수집 버튼을 눌러주세요.
        </div>
      ) : (
        <>
          <div style={{ marginBottom: 4 }}>
            <div style={{ fontSize: 10, color: '#ffcc80', marginBottom: 2 }}>평균목표가</div>
            <ResponsiveContainer width="100%" height={120}>
              <LineChart data={ascData} margin={chartMargin}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--chart-grid)" />
                <XAxis dataKey="date" tick={axisStyle} axisLine={false} tickLine={false} />
                <YAxis tickFormatter={(v) => fmt(v, market)} tick={axisStyle} axisLine={false} tickLine={false} width={60} />
                <Tooltip content={targetTooltip} />
                <Line type="monotone" dataKey="target_mean" name="평균목표가" stroke="#ffcc80" strokeWidth={2} dot={targetDot} activeDot={{ r: 5 }} connectNulls />
              </LineChart>
            </ResponsiveContainer>
          </div>
          <div style={{ marginTop: 8 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
              <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>애널리스트 의견</div>
              {opinionData.length < ascData.length && (
                <span style={{ fontSize: 9, color: 'var(--text-muted)', background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 3, padding: '0 5px', lineHeight: '16px' }}>변동 없음</span>
              )}
            </div>
            <ResponsiveContainer width="100%" height={120}>
              <LineChart data={opinionData} margin={chartMargin}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--chart-grid)" />
                <XAxis dataKey="date" tick={axisStyle} axisLine={false} tickLine={false} />
                <YAxis tick={axisStyle} axisLine={false} tickLine={false} width={20} />
                <Tooltip content={opinionTooltip} />
                <Line type="monotone" dataKey="buy" name="매수" stroke="#43a047" strokeWidth={2} dot={makeDot('#43a047', 'buy')} activeDot={{ r: 5 }} connectNulls />
                <Line type="monotone" dataKey="hold" name="중립" stroke="#616161" strokeWidth={2} dot={makeDot('#616161', 'hold')} activeDot={{ r: 5 }} connectNulls />
                <Line type="monotone" dataKey="sell" name="매도" stroke="#ef9a9a" strokeWidth={2} dot={makeDot('#ef9a9a', 'sell')} activeDot={{ r: 5 }} connectNulls />
              </LineChart>
            </ResponsiveContainer>
          </div>
          <div style={{ display: 'flex', gap: 12, fontSize: 10, color: 'var(--text-muted)', marginTop: 4 }}>
            {[['#43a047', '매수'], ['#616161', '중립'], ['#b71c1c', '매도']].map(([color, label]) => (
              <span key={label} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <span style={{ width: 8, height: 8, background: color, display: 'inline-block', borderRadius: 2 }} />
                {label}
              </span>
            ))}
          </div>
        </>
      )}
    </div>
  )
}

function DetailSummaryTab({ summary, ticker }) {
  if (!summary) return null
  const { buy = 0, hold = 0, sell = 0 } = summary
  const total = buy + hold + sell
  const pct = (n) => total > 0 ? `${Math.round(n / total * 100)}%` : '—'
  const gap = summary.target_mean != null && summary.price != null
    ? ((summary.target_mean - summary.price) / summary.price * 100)
    : null

  return (
    <div>
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>

      {/* 1행: 증권사 컨센서스 */}
      <div style={{ background: 'var(--bg-card)', borderRadius: 6, padding: '8px 10px' }}>
        <SectionTitle>🏦 증권사 컨센서스</SectionTitle>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          {/* 평균목표가 */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
            <span style={{ color: 'var(--text-muted)', fontSize: 9 }}>🎯 평균목표가</span>
            <span style={{ fontWeight: 700, fontSize: 13, color: 'var(--text)' }}>{fmt(summary.target_mean, summary.market)}</span>
          </div>
          {/* 상승여력 */}
          {gap != null && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
              <span style={{ color: 'var(--text-muted)', fontSize: 9 }}>상승여력</span>
              <span style={{ fontSize: 12, fontWeight: 600, color: gap >= 0 ? '#81c784' : '#ef9a9a' }}>
                {gap >= 0 ? '+' : ''}{gap.toFixed(1)}%
              </span>
            </div>
          )}
          <span style={{ color: 'var(--border)', fontSize: 10 }}>|</span>
          {/* 최고/최저 목표가 */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
            <span style={{ color: 'var(--text-muted)', fontSize: 9 }}>최고목표가</span>
            <span style={{ color: '#81c784', fontSize: 12, fontWeight: 600 }}>{fmt(summary.target_high, summary.market)}</span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
            <span style={{ color: 'var(--text-muted)', fontSize: 9 }}>최저목표가</span>
            <span style={{ color: '#ef9a9a', fontSize: 12, fontWeight: 600 }}>{fmt(summary.target_low, summary.market)}</span>
          </div>
          {summary.finviz_recom != null && (
            <>
              <span style={{ color: 'var(--border)', fontSize: 10 }}>|</span>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                <span style={{ color: 'var(--text-muted)', fontSize: 9 }}>Finviz 추천</span>
                <span style={{ fontSize: 12, fontWeight: 600, color: summary.finviz_recom <= 2 ? '#81c784' : 'var(--text)' }}>
                  {summary.finviz_recom.toFixed(1)} <span style={{ fontSize: 9, color: 'var(--text-muted)' }}>/ 5</span>
                </span>
              </div>
            </>
          )}
          {total > 0 && (
            <>
              <span style={{ color: 'var(--border)', fontSize: 10 }}>|</span>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                <span style={{ color: 'var(--text-muted)', fontSize: 9 }}>애널리스트 의견</span>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ color: '#81c784', fontSize: 11 }}>매수 {buy}</span>
                  <span style={{ color: 'var(--text-muted)', fontSize: 11 }}>중립 {hold}</span>
                  <span style={{ color: '#ef9a9a', fontSize: 11 }}>매도 {sell}</span>
                  <div style={{ display: 'flex', height: 4, borderRadius: 2, overflow: 'hidden', width: 50, flexShrink: 0 }}>
                    <div style={{ width: `${Math.round(buy / total * 100)}%`, background: '#43a047' }} />
                    <div style={{ width: `${Math.round(hold / total * 100)}%`, background: '#424242' }} />
                    <div style={{ width: `${Math.round(sell / total * 100)}%`, background: '#b71c1c' }} />
                  </div>
                </div>
              </div>
            </>
          )}
        </div>
      </div>

      {/* 컨센서스 추이 */}
      <ConsensusChart ticker={ticker} market={summary.market} />

      {/* 2행: 매물대·RSI 현황 */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div style={{ background: 'var(--bg-card)', borderRadius: 6, padding: 14 }}>
          <SectionTitle>📉 매물대 &amp; RSI 현황</SectionTitle>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 4, marginTop: 4 }}>
            {[
              { color: '#ffffff', label: '현재가', desc: '현재 주가' },
              { color: '#ffcc80', label: '평균목표가', desc: '애널리스트 평균 목표주가' },
              { color: '#80cbc4', label: 'POC', desc: '거래량 최대 가격대' },
              { color: '#81c784', label: 'HVN', desc: '고거래량 가격대(지지·저항)' },
              { color: '#81c784', label: 'RSI20~30', desc: '일봉 RSI 과매도 가격' },
              { color: '#ef9a9a', label: 'RSI70~80', desc: '일봉 RSI 과매수 가격' },
            ].map(({ color, label, desc }) => (
              <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 4 }} title={desc}>
                <div style={{ width: 8, height: 8, borderRadius: 2, background: color, flexShrink: 0 }} />
                <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>{label}</span>
                <span style={{ fontSize: 9, color: 'var(--text-muted)' }}>({desc})</span>
              </div>
            ))}
          </div>
          <PriceLevelChart
            rsiData={summary.daily_rsi}
            price={summary.price}
            vp={summary.volume_profile}
            target={summary.target_mean}
            market={summary.market}
          />
        </div>
      </div>
    </div>
    <FinancialsChart financials={summary.financials} financialsAnnual={summary.financials_annual} market={summary.market} />
    </div>
  )
}


function FinancialsChart({ financials, financialsAnnual, market }) {
  const [hoveredLegend, setHoveredLegend] = useState(null)
  if (!financials?.length) return null

  const isKR = market === 'KR'

  // 차트 Y축용 (짧은 표현)
  const fmtVal = (v) => {
    if (v == null) return '—'
    if (isKR) {
      const abs = Math.abs(v)
      if (abs >= 1e12) return `${(v / 1e12).toFixed(0)}조`
      if (abs >= 1e8)  return `${Math.round(v / 1e8)}억`
      return Math.round(v).toLocaleString()
    }
    const abs = Math.abs(v)
    if (abs >= 1e12) return `${(v / 1e12).toFixed(1)}T`
    if (abs >= 1e9)  return `${(v / 1e9).toFixed(1)}B`
    if (abs >= 1e6)  return `${(v / 1e6).toFixed(0)}M`
    return `${(v / 1e3).toFixed(0)}K`
  }

  // 툴팁/테이블용 (상세 표현)
  const fmtValFull = (v) => {
    if (v == null) return '—'
    if (isKR) {
      const abs = Math.abs(v)
      if (abs >= 1e12) return `${(v / 1e12).toFixed(2)}조원`
      return `${Math.round(v / 1e8).toLocaleString()}억원`
    }
    return fmtVal(v)
  }

  // EPS/BPS 포맷
  const fmtShare = (v) => {
    if (v == null) return '—'
    if (isKR) return `${Math.round(v).toLocaleString()}원`
    const abs = Math.abs(v)
    if (abs >= 10000) return `${(v / 1000).toFixed(0)}K`
    if (abs >= 100)   return v.toFixed(0)
    return v.toFixed(2)
  }

  // EPS/BPS 차트 축용 (짧게)
  const fmtShareAxis = (v) => {
    if (v == null) return '—'
    if (isKR) {
      const abs = Math.abs(v)
      if (abs >= 10000) return `${Math.round(v / 1000)}K`
      return Math.round(v).toLocaleString()
    }
    return fmtShare(v)
  }

  const calcChg = (curr, prev) => {
    if (curr == null || prev == null) return { abs: null, pct: null }
    const abs = curr - prev
    const pct = prev !== 0 ? Math.round((abs / Math.abs(prev)) * 1000) / 10 : null
    return { abs, pct }
  }

  const toChartData = (list) => {
    const reversed = [...list].reverse()
    return reversed.map((f, i) => {
      const p = i > 0 ? reversed[i - 1] : null
      const rev = calcChg(f.revenue, p?.revenue)
      const op  = calcChg(f.operating_income, p?.operating_income)
      const eps = calcChg(f.eps, p?.eps)
      const bps = calcChg(f.bps, p?.bps)
      return {
        period: f.is_consensus ? `${f.period}(E)` : f.period,
        revenue:   f.revenue,
        op_income: f.operating_income,
        eps: f.eps ?? null,
        bps: f.bps ?? null,
        per: f.per ?? null,
        pbr: f.pbr ?? null,
        is_consensus: f.is_consensus,
        margin: f.revenue && f.operating_income != null
          ? Math.round(f.operating_income / f.revenue * 100) : null,
        rev_chg_abs: rev.abs,  rev_chg_pct: rev.pct,
        op_chg_abs:  op.abs,   op_chg_pct:  op.pct,
        eps_chg_abs: eps.abs,  eps_chg_pct: eps.pct,
        bps_chg_abs: bps.abs,  bps_chg_pct: bps.pct,
      }
    })
  }

  const quarterData = toChartData(financials)
  const annualData  = financialsAnnual?.length ? toChartData(financialsAnnual) : []

  const DESCS = {
    EPS: '주당순이익 — 순이익 ÷ 발행주식수',
    BPS: '주당순자산 — 순자산 ÷ 발행주식수',
    PER: '주가수익비율 — 주가 ÷ EPS (낮을수록 저평가)',
    PBR: '주가순자산비율 — 주가 ÷ BPS (낮을수록 저평가)',
  }

  const Legend = ({ items }) => (
    <div style={{ display: 'flex', gap: 12, fontSize: 10, color: 'var(--text-muted)', marginBottom: 4 }}>
      {items.map(({ color, label }) => {
        const desc = DESCS[label]
        return (
          <span
            key={label}
            style={{ display: 'flex', alignItems: 'center', gap: 4, position: 'relative', cursor: desc ? 'help' : 'default' }}
            onMouseEnter={() => desc && setHoveredLegend(label)}
            onMouseLeave={() => setHoveredLegend(null)}
          >
            <span style={{ width: 16, height: 2, background: color, display: 'inline-block', borderRadius: 1 }} />
            {label}
            {hoveredLegend === label && (
              <div style={{
                position: 'absolute', bottom: 'calc(100% + 6px)', left: 0,
                background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 4,
                padding: '5px 9px', fontSize: 10, color: 'var(--text-muted)', whiteSpace: 'nowrap',
                zIndex: 50, pointerEvents: 'none', boxShadow: '0 2px 8px rgba(0,0,0,0.5)',
              }}>
                {desc}
              </div>
            )}
          </span>
        )
      })}
    </div>
  )

  const axisStyle = { fontSize: 10, fill: 'var(--text-muted)' }
  const chartMargin = { top: 4, right: 8, left: 0, bottom: 0 }
  const lineCfg = { type: 'monotone', strokeWidth: 2, dot: { r: 3 }, activeDot: { r: 5 }, connectNulls: true }

  const CHG_KEYS = {
    revenue:   { abs: 'rev_chg_abs', pct: 'rev_chg_pct' },
    op_income: { abs: 'op_chg_abs',  pct: 'op_chg_pct'  },
    eps:       { abs: 'eps_chg_abs', pct: 'eps_chg_pct' },
    bps:       { abs: 'bps_chg_abs', pct: 'bps_chg_pct' },
  }

  const ChgBadge = ({ abs, pct, fmtFn }) => {
    if (abs == null) return null
    const pos = abs >= 0
    const arrow = pos ? '▲' : '▼'
    const color = pos ? '#81c784' : '#ef9a9a'
    return (
      <span style={{ color, marginLeft: 6, fontSize: 10 }}>
        {arrow} {fmtFn(Math.abs(abs))} ({pos ? '+' : ''}{pct}%)
      </span>
    )
  }

  const makeTooltip = (isBig) => ({ active, payload, label }) => {
    if (!active || !payload?.length) return null
    const row = payload[0]?.payload
    return (
      <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 6, padding: '8px 12px', fontSize: 11 }}>
        <div style={{ color: 'var(--accent)', fontWeight: 700, marginBottom: 4 }}>{label}</div>
        {payload.map(p => {
          const ck = CHG_KEYS[p.dataKey]
          return (
            <div key={p.dataKey} style={{ color: p.stroke, marginBottom: 2 }}>
              {p.name}: {p.value != null ? (isBig ? fmtValFull(p.value) : p.value.toFixed(1)) : '—'}
              {ck && <ChgBadge abs={row?.[ck.abs]} pct={row?.[ck.pct]} fmtFn={isBig ? fmtValFull : (v) => v.toFixed(1)} />}
            </div>
          )
        })}
      </div>
    )
  }

  const makeShareTooltip = () => ({ active, payload, label }) => {
    if (!active || !payload?.length) return null
    const row = payload[0]?.payload
    return (
      <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 6, padding: '8px 12px', fontSize: 11 }}>
        <div style={{ color: 'var(--accent)', fontWeight: 700, marginBottom: 4 }}>{label}</div>
        {payload.map(p => {
          const ck = CHG_KEYS[p.dataKey]
          return (
            <div key={p.dataKey} style={{ color: p.stroke, marginBottom: 2 }}>
              {p.name}: {p.value != null ? fmtShare(p.value) : '—'}
              {ck && <ChgBadge abs={row?.[ck.abs]} pct={row?.[ck.pct]} fmtFn={fmtShare} />}
            </div>
          )
        })}
      </div>
    )
  }

  // 차트 라벨: % 변화율 (데이터 포인트 위에 표시)
  // LabelList는 dataKey에 해당하는 값을 value로 전달
  const PctLabel = () => ({ x, y, value, index }) => {
    if (index === 0 || value == null) return null
    const pos = value >= 0
    return (
      <text x={x} y={y - 10} textAnchor="middle" fontSize={8} fill={pos ? '#81c784' : '#ef9a9a'}>
        {pos ? '+' : ''}{value.toFixed(1)}%
      </text>
    )
  }

  const TH = ({ children, color }) => (
    <th style={{ color: color || 'var(--text-muted)', textAlign: 'right', padding: '2px 6px', fontWeight: 400 }}>{children}</th>
  )
  const TD = ({ children, color }) => (
    <td style={{ color: color || 'var(--text-muted)', textAlign: 'right', padding: '1px 6px' }}>{children}</td>
  )

  const Section = ({ data, title }) => {
    const hasEpsBps = data.some(d => d.eps != null || d.bps != null)
    const hasPerPbr = data.some(d => d.per != null || d.pbr != null)
    return (
      <div style={{ background: 'var(--bg-card)', borderRadius: 6, padding: 14, marginTop: 12 }}>
        <SectionTitle>{title}</SectionTitle>

        {/* 매출 / 영업이익 */}
        <div style={{ marginTop: 8 }}>
          <Legend items={[{ color: '#4fc3f7', label: '매출' }, { color: '#81c784', label: '영업이익' }]} />
          <ResponsiveContainer width="100%" height={165}>
            <LineChart data={data} margin={{ ...chartMargin, top: 18 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--chart-grid)" />
              <XAxis dataKey="period" tick={axisStyle} axisLine={false} tickLine={false} />
              <YAxis tickFormatter={fmtVal} tick={axisStyle} axisLine={false} tickLine={false} width={36} />
              <Tooltip content={makeTooltip(true)} />
              <ReferenceLine y={0} stroke="var(--border)" />
              <Line {...lineCfg} dataKey="revenue"   name="매출"    stroke="#4fc3f7">
                <LabelList dataKey="rev_chg_pct" content={PctLabel()} />
              </Line>
              <Line {...lineCfg} dataKey="op_income" name="영업이익" stroke="#81c784">
                <LabelList dataKey="op_chg_pct" content={PctLabel()} />
              </Line>
            </LineChart>
          </ResponsiveContainer>
        </div>

        {/* EPS / BPS + PER / PBR (2열) */}
        {(hasEpsBps || hasPerPbr) && (
          <div style={{ display: 'flex', gap: 16, marginTop: 12 }}>
            {hasEpsBps && (
              <div style={{ flex: 1, minWidth: 0 }}>
                <Legend items={[{ color: '#80cbc4', label: 'EPS' }, { color: '#f48fb1', label: 'BPS' }]} />
                <ResponsiveContainer width="100%" height={120}>
                  <LineChart data={data} margin={chartMargin}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--chart-grid)" />
                    <XAxis dataKey="period" tick={axisStyle} axisLine={false} tickLine={false} />
                    <YAxis tickFormatter={fmtShareAxis} tick={axisStyle} axisLine={false} tickLine={false} width={36} />
                    <Tooltip content={makeShareTooltip()} />
                    <Line {...lineCfg} dataKey="eps" name="EPS" stroke="#80cbc4" />
                    <Line {...lineCfg} dataKey="bps" name="BPS" stroke="#f48fb1" />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            )}
            {hasPerPbr && (
              <div style={{ flex: 1, minWidth: 0 }}>
                <Legend items={[{ color: '#ffcc80', label: 'PER' }, { color: '#ce93d8', label: 'PBR' }]} />
                <ResponsiveContainer width="100%" height={120}>
                  <LineChart data={data} margin={chartMargin}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--chart-grid)" />
                    <XAxis dataKey="period" tick={axisStyle} axisLine={false} tickLine={false} />
                    <YAxis tick={axisStyle} axisLine={false} tickLine={false} width={36} />
                    <Tooltip content={makeTooltip(false)} />
                    <Line {...lineCfg} dataKey="per" name="PER" stroke="#ffcc80" />
                    <Line {...lineCfg} dataKey="pbr" name="PBR" stroke="#ce93d8" />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            )}
          </div>
        )}

        {/* 테이블 */}
        <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: 10, fontSize: 10 }}>
          <thead>
            <tr>
              <TH>기간</TH>
              <TH color="#4fc3f7">매출</TH>
              <TH color="#4fc3f7">매출 증감</TH>
              <TH color="#81c784">영업이익</TH>
              <TH color="#81c784">영업이익 증감</TH>
              <TH>영업이익률</TH>
              {hasEpsBps && <TH color="#80cbc4">EPS</TH>}
              {hasEpsBps && <TH color="#f48fb1">BPS</TH>}
              {hasPerPbr && <TH color="#ffcc80">PER</TH>}
              {hasPerPbr && <TH color="#ce93d8">PBR</TH>}
            </tr>
          </thead>
          <tbody>
            {data.map(d => {
              const revPos = d.rev_chg_abs == null ? null : d.rev_chg_abs >= 0
              const opPos  = d.op_chg_abs  == null ? null : d.op_chg_abs  >= 0
              return (
                <tr key={d.period} style={d.is_consensus ? { opacity: 0.75, fontStyle: 'italic' } : {}}>
                  <TD color={d.is_consensus ? '#ffcc80' : 'var(--text-muted)'}>{d.period}</TD>
                  <TD color="#4fc3f7">{fmtValFull(d.revenue)}</TD>
                  <td style={{ textAlign: 'right', padding: '1px 6px', color: revPos === true ? '#81c784' : revPos === false ? '#ef9a9a' : 'var(--text-muted)' }}>
                    {d.rev_chg_abs != null
                      ? <>{revPos ? '▲' : '▼'} {fmtValFull(Math.abs(d.rev_chg_abs))}<br /><span style={{ fontSize: 9 }}>({d.rev_chg_pct >= 0 ? '+' : ''}{d.rev_chg_pct}%)</span></>
                      : '—'}
                  </td>
                  <TD color={d.op_income != null && d.op_income >= 0 ? '#81c784' : '#ef9a9a'}>{fmtValFull(d.op_income)}</TD>
                  <td style={{ textAlign: 'right', padding: '1px 6px', color: opPos === true ? '#81c784' : opPos === false ? '#ef9a9a' : 'var(--text-muted)' }}>
                    {d.op_chg_abs != null
                      ? <>{opPos ? '▲' : '▼'} {fmtValFull(Math.abs(d.op_chg_abs))}<br /><span style={{ fontSize: 9 }}>({d.op_chg_pct >= 0 ? '+' : ''}{d.op_chg_pct}%)</span></>
                      : '—'}
                  </td>
                  <TD>{d.margin != null ? `${d.margin}%` : '—'}</TD>
                  {hasEpsBps && <TD color="#80cbc4">{fmtShare(d.eps)}</TD>}
                  {hasEpsBps && <TD color="#f48fb1">{fmtShare(d.bps)}</TD>}
                  {hasPerPbr && <TD color="#ffcc80">{d.per ?? '—'}</TD>}
                  {hasPerPbr && <TD color="#ce93d8">{d.pbr ?? '—'}</TD>}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    )
  }

  return (
    <>
      {annualData.length > 0 && <Section data={annualData} title="📈 연간 실적 추이 (4년)" />}
      <Section data={quarterData} title="📊 분기 실적 추이" />
    </>
  )
}

function ReportSectionText({ title, text }) {
  if (!text) return null
  return (
    <div style={{ marginBottom: 20 }}>
      <div style={{ fontWeight: 600, fontSize: 13, color: 'var(--accent)', marginBottom: 8 }}>{title}</div>
      <p style={{ fontSize: 13, color: 'var(--text)', lineHeight: 1.8, margin: 0, whiteSpace: 'pre-wrap' }}>{text}</p>
    </div>
  )
}

function ReportSectionCompetitors({ competitors, market }) {
  if (!competitors?.length) return null
  const fmtMC = (mc) => {
    if (mc == null) return 'N/A'
    if (mc >= 1e12) return `${(mc / 1e12).toFixed(1)}T`
    if (mc >= 1e9) return `${(mc / 1e9).toFixed(1)}B`
    return `${(mc / 1e6).toFixed(0)}M`
  }
  return (
    <div style={{ marginBottom: 20 }}>
      <div style={{ fontWeight: 600, fontSize: 13, color: 'var(--accent)', marginBottom: 8 }}>1️⃣ 사업영역 & 시장순위</div>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
          <thead>
            <tr>
              {['종목', '티커', '현재가', '시가총액', 'YTD'].map(h => (
                <th key={h} style={{ ...TH }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {competitors.map((c, i) => (
              <tr key={i}>
                <td style={{ ...TD, textAlign: 'left' }}>{c.name || c.ticker}</td>
                <td style={TD}>{c.ticker}</td>
                <td style={TD}>{fmt(c.price, market)}</td>
                <td style={TD}>{c.market_cap ? (market === 'KR' ? `₩${fmtMC(c.market_cap)}` : `$${fmtMC(c.market_cap)}`) : 'N/A'}</td>
                <td style={{ ...TD, color: c.ytd_return >= 0 ? '#81c784' : '#ef9a9a' }}>
                  {c.ytd_return != null ? `${c.ytd_return >= 0 ? '+' : ''}${c.ytd_return.toFixed(1)}%` : 'N/A'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function ReportSectionNews({ disclosures, news }) {
  return (
    <div style={{ marginBottom: 20 }}>
      <div style={{ fontWeight: 600, fontSize: 13, color: 'var(--accent)', marginBottom: 8 }}>5️⃣ 최근 공시 & 뉴스</div>
      {disclosures && (
        <p style={{ fontSize: 13, color: 'var(--text)', lineHeight: 1.8, margin: '0 0 10px' }}>{disclosures}</p>
      )}
      {news?.length > 0 ? (
        <ul style={{ margin: 0, padding: '0 0 0 16px', fontSize: 12, lineHeight: 1.8 }}>
          {news.map((item, i) => (
            <li key={i}>
              <a href={item.link} target="_blank" rel="noreferrer"
                 style={{ color: 'var(--accent)', textDecoration: 'none' }}>{item.title}</a>
              <span style={{ color: 'var(--text-muted)', marginLeft: 6 }}>
                — {item.publisher} ({item.published_at})
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p style={{ color: 'var(--text-muted)', fontSize: 12 }}>_(뉴스 없음)_</p>
      )}
    </div>
  )
}

export default function Reports() {
  const [reportList, setReportList] = useState({})
  const [selected, setSelected] = useState({ ticker: null, date: null })
  const [detail, setDetail] = useState({ summary: null })
  const [loading, setLoading] = useState(false)
  const [generating, setGenerating] = useState(null)
  const [genProgress, setGenProgress] = useState({ done: 0, total: 0 })
  const pollRef = useRef(null)
  const [consensusBatch, setConsensusBatch] = useState({ running: false, done: 0, total: 0, current: '' })
  const consensusPollRef = useRef(null)
  const [activeTab, setActiveTab] = useState('holdings')
  const [watchlistSub, setWatchlistSub] = useState('low')
  const [view, setView] = useState('list')
  const [detailRefreshKey, setDetailRefreshKey] = useState(0)
  const [activeDetailTab, setActiveDetailTab] = useState('summary')
  const [expandedTickers, setExpandedTickers] = useState(new Set())
  const [marketFilter, setMarketFilter] = useState('ALL')
  const [guruMap, setGuruMap] = useState({})  // ticker -> count

  useEffect(() => {
    axios.get('/api/guru/stats/popularity')
      .then(({ data }) => {
        const map = {}
        data.forEach(r => { if (r.count > 0) map[r.ticker] = r.count })
        setGuruMap(map)
      })
      .catch(() => {})
  }, [])

  const toggleTicker = (ticker) => {
    setExpandedTickers(prev => {
      const next = new Set(prev)
      if (next.has(ticker)) next.delete(ticker)
      else next.add(ticker)
      return next
    })
  }

  const fetchList = useCallback(() => {
    axios.get('/api/report/list').then(({ data }) => setReportList(data))
  }, [])

  useEffect(() => { fetchList() }, [])

  useEffect(() => {
    if (!selected.ticker || !selected.date) return
    setLoading(true)
    axios.get(`/api/report/${selected.ticker}/${selected.date}`)
      .then(({ data }) => setDetail({ summary: data.summary }))
      .finally(() => setLoading(false))
  }, [selected, detailRefreshKey])

  const openDetail = (ticker, date) => {
    setSelected({ ticker, date })
    setView('detail')
    setActiveDetailTab('summary')
  }

  const generateOne = async (ticker) => {
    setGenerating(ticker)
    setGenProgress({ done: 0, total: 0 })
    clearInterval(pollRef.current)
    try {
      await axios.post(`/api/report/generate/${ticker}`)
      pollRef.current = setInterval(async () => {
        try {
          const { data } = await axios.get('/api/report/progress')
          setGenProgress({ done: data.done, total: data.total })
          if (!data.running && data.total > 0 && data.done >= data.total) {
            clearInterval(pollRef.current)
            fetchList()
            setGenerating(null)
            if (view === 'detail' && selected.ticker === ticker) {
              setDetailRefreshKey(k => k + 1)
            }
          }
        } catch {}
      }, 1500)
    } catch {
      setGenerating(null)
    }
  }

  useEffect(() => () => clearInterval(pollRef.current), [])

  const runConsensusBatch = async () => {
    setConsensusBatch({ running: true, done: 0, total: 0, current: '' })
    clearInterval(consensusPollRef.current)
    try {
      await axios.post('/api/consensus/batch')
      consensusPollRef.current = setInterval(async () => {
        try {
          const { data } = await axios.get('/api/consensus/batch/progress')
          setConsensusBatch({ running: data.running, done: data.done, total: data.total, current: data.current })
          if (!data.running && data.total > 0 && data.done >= data.total) {
            clearInterval(consensusPollRef.current)
          }
        } catch {}
      }, 1500)
    } catch {
      setConsensusBatch(p => ({ ...p, running: false }))
    }
  }

  useEffect(() => () => clearInterval(consensusPollRef.current), [])

  const holdingsCount = Object.values(reportList).filter(v => v.category === 'holdings').length
  const watchlistAll = Object.entries(reportList).filter(([, v]) => v.category === 'watchlist')
  const watchlistLowCount = watchlistAll.filter(([, v]) => (v.summary?.daily_rsi?.rsi ?? 999) <= 45).length
  const watchlistHighCount = watchlistAll.filter(([, v]) => (v.summary?.daily_rsi?.rsi ?? -1) > 45).length
  const watchlistCount = watchlistAll.length

  const currentTabBaseEntries = Object.entries(reportList).filter(([, v]) =>
    activeTab === 'holdings' ? v.category === 'holdings' : v.category === 'watchlist'
  )
  const mCountKR = currentTabBaseEntries.filter(([, v]) => (v.summary?.market || v.market) === 'KR').length
  const mCountUS = currentTabBaseEntries.filter(([, v]) => (v.summary?.market || v.market) === 'US').length
  const mCountAll = currentTabBaseEntries.length

  const tabEntries = Object.entries(reportList)
    .filter(([, v]) => {
      if (activeTab === 'holdings') return v.category === 'holdings'
      if (activeTab === 'watchlist') {
        if (v.category !== 'watchlist') return false
        const rsi = v.summary?.daily_rsi?.rsi ?? null
        return watchlistSub === 'low' ? (rsi === null || rsi <= 45) : (rsi !== null && rsi > 45)
      }
      return false
    })
    .filter(([, v]) => {
      if (marketFilter === 'ALL') return true
      const m = v.summary?.market || v.market
      return m === marketFilter
    })
    .sort(([, a], [, b]) => {
      const gapOf = (s) => {
        const t = s.summary?.target_mean, p = s.summary?.price
        return t != null && p ? (t - p) / p * 100 : null
      }
      if (activeTab === 'holdings') {
        // 1차 평균목표가 비율 낮은순, 2차 RSI 일봉 높은순
        const gapA = gapOf(a), gapB = gapOf(b)
        if (gapA !== gapB) {
          if (gapA === null) return 1
          if (gapB === null) return -1
          return gapA - gapB
        }
        const rsiA = a.summary?.daily_rsi?.rsi ?? null
        const rsiB = b.summary?.daily_rsi?.rsi ?? null
        if (rsiA === null && rsiB === null) return 0
        if (rsiA === null) return 1
        if (rsiB === null) return -1
        return rsiB - rsiA
      }
      // 관심종목: 1차 평균목표가 비율 높은순, 2차 RSI 일봉 낮은순
      const gapA = gapOf(a), gapB = gapOf(b)
      if (gapA !== gapB) {
        if (gapA === null) return 1
        if (gapB === null) return -1
        return gapB - gapA
      }
      const rsiA = a.summary?.daily_rsi?.rsi ?? null
      const rsiB = b.summary?.daily_rsi?.rsi ?? null
      if (rsiA === null && rsiB === null) return 0
      if (rsiA === null) return 1
      if (rsiB === null) return -1
      return rsiA - rsiB
    })

  const renderTickerItem = (ticker, info) => {
    const isExpanded = expandedTickers.has(ticker)
    return (
      <div key={ticker} style={{ marginBottom: 4 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: isExpanded ? 4 : 0 }}>
          <div
            style={{ display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer', flex: 1, minWidth: 0 }}
            onClick={() => toggleTicker(ticker)}
          >
            <span style={{ color: 'var(--text-muted)', fontSize: 9, flexShrink: 0 }}>{isExpanded ? '▼' : '▶'}</span>
            <div style={{ minWidth: 0 }}>
              <span style={{ color: 'var(--accent)', fontWeight: 600, fontSize: 13 }}>{ticker}</span>
              {info.summary?.name && (
                <div style={{ color: 'var(--text-muted)', fontSize: 10, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{info.summary.name}</div>
              )}
              {guruMap[ticker] && (
                <div style={{ color: '#ffb74d', fontSize: 10 }}>구루 {guruMap[ticker]}명</div>
              )}
            </div>
          </div>
          <button
            onClick={() => generateOne(ticker)}
            disabled={!!generating}
            style={{ background: 'transparent', border: '1px solid var(--border)', color: generating === ticker ? 'var(--accent)' : 'var(--text-muted)', borderRadius: 3, padding: '1px 6px', fontSize: 11, cursor: generating ? 'default' : 'pointer', flexShrink: 0 }}
          >
            {generating === ticker ? `${genProgress.done}/${genProgress.total || '?'}` : '생성'}
          </button>
        </div>
        {generating === ticker && genProgress.total > 0 && (
          <div style={{ marginBottom: 4 }}>
            <div style={{ background: 'var(--bg-hover)', borderRadius: 2, height: 3, overflow: 'hidden' }}>
              <div style={{ width: `${Math.round(genProgress.done / genProgress.total * 100)}%`, height: '100%', background: 'var(--accent)', transition: 'width 0.4s ease' }} />
            </div>
          </div>
        )}
        {isExpanded && info.dates.map(date => (
          <div
            key={date}
            onClick={() => openDetail(ticker, date)}
            style={{ padding: '3px 8px', cursor: 'pointer', borderRadius: 4, fontSize: 12, background: selected.ticker === ticker && selected.date === date && view === 'detail' ? 'var(--accent)' : 'transparent', color: selected.ticker === ticker && selected.date === date && view === 'detail' ? 'white' : 'var(--text-muted)' }}
          >
            {date}
          </div>
        ))}
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', gap: 24, height: 'calc(100vh - 120px)' }}>
      {/* 좌측 사이드바 */}
      <div style={{ width: 210, overflowY: 'auto', borderRight: '1px solid var(--border)', paddingRight: 16, flexShrink: 0 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
          <h3 style={{ color: 'var(--text-heading)', margin: 0 }}>리포트 목록</h3>
          <button
            onClick={runConsensusBatch}
            disabled={consensusBatch.running}
            title="전체 종목 수집 → 백필"
            style={{
              background: 'transparent', border: '1px solid var(--border)',
              color: consensusBatch.running ? 'var(--accent)' : 'var(--text-muted)',
              borderRadius: 3, padding: '2px 7px', fontSize: 10,
              cursor: consensusBatch.running ? 'default' : 'pointer', whiteSpace: 'nowrap',
            }}
          >
            {consensusBatch.running
              ? `${consensusBatch.current || '...'} (${consensusBatch.done}/${consensusBatch.total})`
              : '전체 수집/백필'}
          </button>
        </div>
        {consensusBatch.running && consensusBatch.total > 0 && (
          <div style={{ marginBottom: 8 }}>
            <div style={{ background: 'var(--bg-hover)', borderRadius: 2, height: 3, overflow: 'hidden' }}>
              <div style={{ width: `${Math.round(consensusBatch.done / consensusBatch.total * 100)}%`, height: '100%', background: 'var(--accent)', transition: 'width 0.4s ease' }} />
            </div>
          </div>
        )}
        <div style={{ display: 'flex', borderBottom: '1px solid var(--border)', marginBottom: activeTab === 'watchlist' ? 0 : 12 }}>
          <button style={TAB_STYLE(activeTab === 'holdings')} onClick={() => setActiveTab('holdings')}>보유 ({holdingsCount})</button>
          <button style={TAB_STYLE(activeTab === 'watchlist')} onClick={() => setActiveTab('watchlist')}>관심 ({watchlistCount})</button>
        </div>
        {activeTab === 'watchlist' && (
          <div style={{ display: 'flex', borderBottom: '1px solid var(--border)', marginBottom: 8, marginTop: 4 }}>
            <button
              style={{ ...TAB_STYLE(watchlistSub === 'low'), fontSize: 11, padding: '4px 10px', color: watchlistSub === 'low' ? '#81c784' : 'var(--text-muted)', borderBottom: watchlistSub === 'low' ? '2px solid #81c784' : '2px solid transparent' }}
              onClick={() => setWatchlistSub('low')}
            >RSI≤45 ({watchlistLowCount})</button>
            <button
              style={{ ...TAB_STYLE(watchlistSub === 'high'), fontSize: 11, padding: '4px 10px', color: watchlistSub === 'high' ? '#ef9a9a' : 'var(--text-muted)', borderBottom: watchlistSub === 'high' ? '2px solid #ef9a9a' : '2px solid transparent' }}
              onClick={() => setWatchlistSub('high')}
            >RSI&gt;45 ({watchlistHighCount})</button>
          </div>
        )}
        <div style={{ display: 'flex', gap: 4, marginBottom: 10 }}>
          {[['ALL', '전체', mCountAll], ['KR', '🇰🇷 국내', mCountKR], ['US', '🇺🇸 해외', mCountUS]].map(([val, label, cnt]) => (
            <button
              key={val}
              onClick={() => setMarketFilter(val)}
              style={{
                flex: 1, padding: '3px 0', fontSize: 10,
                background: marketFilter === val ? 'var(--bg-hover)' : 'transparent',
                border: `1px solid ${marketFilter === val ? 'var(--accent)' : 'var(--border)'}`,
                color: marketFilter === val ? 'var(--accent)' : 'var(--text-muted)',
                borderRadius: 3, cursor: 'pointer', lineHeight: 1.6,
              }}
            >
              {label}<br />
              <span style={{ fontSize: 9, opacity: 0.8 }}>({cnt})</span>
            </button>
          ))}
        </div>
        {tabEntries.length === 0 && <p style={{ color: 'var(--text-muted)', fontSize: 12 }}>리포트 없음</p>}
        {tabEntries.map(([t, info]) => renderTickerItem(t, info))}
      </div>

      {/* 우측 패널 */}
      <div style={{ flex: 1, overflowY: 'auto', overflowX: view === 'list' ? 'auto' : 'hidden' }}>
        {view === 'list' ? (
          /* 목록화면 */
          tabEntries.length === 0 ? (
            <div style={{ textAlign: 'center', marginTop: 80, color: 'var(--text-muted)' }}>
              <p>리포트가 없습니다.</p>
              <p style={{ marginTop: 8, fontSize: 13 }}>설정 페이지에서 "지금 생성" 버튼을 눌러 첫 리포트를 만드세요.</p>
            </div>
          ) : (
            <table style={{ borderCollapse: 'collapse', color: 'var(--text)', width: '100%' }}>
              <thead>
                <tr style={{ background: 'var(--bg-surface)' }}>
                  <th style={{ ...TH, textAlign: 'left', left: 0, zIndex: 3 }}>종목명 (티커)</th>
                  <th style={{ ...TH, textAlign: 'left' }}>시장</th>
                  <th style={{ ...TH, textAlign: 'left' }}>섹터</th>
                  <th style={TH}>현재가</th>
                  <th style={{ ...TH, color: '#ffb74d' }}>20일고점대비</th>
                  <th style={TH}>POC</th>
                  <th style={TH}>평균목표가<br/><span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>vs 현재가</span></th>
                  <th style={{ ...TH, color: '#81c784' }}>Buy</th>
                  <th style={TH}>Hold</th>
                  <th style={{ ...TH, color: '#ef9a9a' }}>Sell</th>
                  <th style={TH}>PER<br/><span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>Fwd</span></th>
                  <th style={TH}>PBR</th>
                  <th style={TH}>Finviz</th>
                  <th style={{ ...TH, borderLeft: '1px solid var(--border)' }}>RSI<br/><span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>일/주/월</span></th>
                  <th style={{ ...TH, color: '#81c784' }}>RSI20<br/><span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>일/주/월</span></th>
                  <th style={{ ...TH, color: '#81c784' }}>RSI25<br/><span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>일/주/월</span></th>
                  <th style={{ ...TH, color: '#81c784' }}>RSI30<br/><span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>일/주/월</span></th>
                  <th style={{ ...TH, color: '#ef9a9a' }}>RSI70<br/><span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>일/주/월</span></th>
                  <th style={{ ...TH, color: '#ef9a9a' }}>RSI75<br/><span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>일/주/월</span></th>
                  <th style={{ ...TH, color: '#ef9a9a' }}>RSI80<br/><span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>일/주/월</span></th>
                </tr>
              </thead>
              <tbody>
                {tabEntries.map(([ticker, info]) => {
                  const s = info.summary
                  const dr = s?.daily_rsi
                  const wr = s?.weekly_rsi
                  const mr = s?.monthly_rsi
                  const rsiKeys = ['target_20', 'target_25', 'target_30', 'target_70', 'target_75', 'target_80']
                  let closestKey = null; let minDiff = Infinity
                  if (s?.price && dr) {
                    rsiKeys.forEach(k => {
                      if (dr[k] == null) return
                      const diff = Math.abs(dr[k] - s.price)
                      if (diff < minDiff) { minDiff = diff; closestKey = k }
                    })
                  }
                  const hasReport = info.dates.length > 0
                  const market = s?.market || info.market
                  return (
                    <tr
                      key={ticker}
                      onClick={() => hasReport ? openDetail(ticker, info.dates[0]) : generateOne(ticker)}
                      style={{ cursor: 'pointer', borderBottom: '1px solid var(--border)', opacity: hasReport ? 1 : 0.6 }}
                      onMouseEnter={e => { e.currentTarget.style.background = 'var(--bg-hover)'; e.currentTarget.querySelector('td').style.background = 'var(--bg-hover)' }}
                      onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.querySelector('td').style.background = 'var(--bg)' }}
                    >
                      <td style={{ ...TD, textAlign: 'left', color: 'var(--accent)', fontWeight: 600, position: 'sticky', left: 0, zIndex: 1, background: 'var(--bg)' }}>
                        <div>{s?.name || ticker}</div>
                        <div style={{ color: 'var(--text-muted)', fontWeight: 400, fontSize: 11 }}>{ticker}</div>
                        {guruMap[ticker] && <div style={{ color: '#ffb74d', fontSize: 10 }}>구루 {guruMap[ticker]}명</div>}
                        {!hasReport && <div style={{ color: 'var(--text-muted)', fontSize: 10 }}>리포트 없음 — 클릭하여 생성</div>}
                      </td>
                      <td style={{ ...TD, textAlign: 'left' }}>
                        {market === 'KR'
                          ? <span style={{ fontSize: 10, padding: '1px 5px', borderRadius: 3, background: '#1a3a2a', color: '#81c784', border: '1px solid #2e6b4a', whiteSpace: 'nowrap' }}>🇰🇷 KR</span>
                          : <span style={{ fontSize: 10, padding: '1px 5px', borderRadius: 3, background: 'var(--bg-surface)', color: '#4fc3f7', border: '1px solid var(--border)', whiteSpace: 'nowrap' }}>🇺🇸 US</span>
                        }
                      </td>
                      <td style={{ ...TD, textAlign: 'left', color: 'var(--text-muted)', fontSize: 11 }}>
                        <div>{s?.sector || '—'}</div>
                        {s?.industry ? <div style={{ color: 'var(--text-muted)', fontSize: 10 }}>{s.industry}</div> : null}
                      </td>
                      <td style={TD}>{s ? fmt(s.price, s.market) : 'N/A'}</td>
                      <td style={TD}>
                        {s?.drop_from_high_20d != null ? (
                          <span style={{ color: s.drop_from_high_20d >= 0 ? '#81c784' : '#ef9a9a', fontWeight: 600 }}>
                            {s.drop_from_high_20d < -10 && <span title="20일 고점 대비 -10% 초과 하락">⚠ </span>}
                            {s.drop_from_high_20d >= 0 ? '+' : ''}{s.drop_from_high_20d.toFixed(1)}%
                          </span>
                        ) : '—'}
                      </td>
                      <td style={TD}>{fmt(s?.volume_profile?.poc, s?.market)}</td>
                      <td style={TD}>
                        <TargetTooltip s={s} />
                      </td>
                      {(() => {
                        const buy = s?.buy ?? 0, hold = s?.hold ?? 0, sell = s?.sell ?? 0
                        const total = buy + hold + sell
                        const pct = (n) => total > 0 ? `(${Math.round(n / total * 100)}%)` : ''
                        const lowAnalysts = s && total > 0 && total <= 10
                        return (<>
                          <td style={{ ...TD, color: '#81c784' }}>
                            {s ? `${buy}${pct(buy)}` : 'N/A'}
                            {lowAnalysts && (
                              <div title={`애널리스트 ${total}명 — 의견 수가 적어 신뢰도가 낮을 수 있습니다`} style={{ color: '#ffb74d', fontSize: 9, marginTop: 1, cursor: 'help' }}>⚠ 총 {total}명</div>
                            )}
                          </td>
                          <td style={TD}>{s ? `${hold}${pct(hold)}` : 'N/A'}</td>
                          <td style={{ ...TD, color: '#ef9a9a' }}>{s ? `${sell}${pct(sell)}` : 'N/A'}</td>
                        </>)
                      })()}
                      <td style={TD}>
                        {s?.per != null ? s.per.toFixed(1) : '—'}
                        {s?.forward_per != null && <div style={{ color: 'var(--text-muted)', fontSize: 10 }}>{s.forward_per.toFixed(1)}</div>}
                      </td>
                      <td style={TD}>{s?.pbr != null ? s.pbr.toFixed(2) : '—'}</td>
                      <td style={TD}>{s ? fmtN(s.finviz_recom) : 'N/A'}</td>
                      <td style={{ ...TD, borderLeft: '1px solid var(--border)' }}>
                        <div style={{ color: rsiColor(dr?.rsi), fontWeight: 600 }}>{dr?.rsi != null ? fmtN(dr.rsi) : 'N/A'}</div>
                        <div style={{ color: rsiColor(wr?.rsi), fontSize: 10 }}>{wr?.rsi != null ? fmtN(wr.rsi) : 'N/A'}</div>
                        <div style={{ color: rsiColor(mr?.rsi), fontSize: 10 }}>{mr?.rsi != null ? fmtN(mr.rsi) : 'N/A'}</div>
                      </td>
                      {[
                        { key: 'target_20', dr: dr?.target_20, wr: wr?.target_20, mr: mr?.target_20, base: '#81c784', sub: '#4a8a5a' },
                        { key: 'target_25', dr: dr?.target_25, wr: wr?.target_25, mr: mr?.target_25, base: '#81c784', sub: '#4a8a5a' },
                        { key: 'target_30', dr: dr?.target_30, wr: wr?.target_30, mr: mr?.target_30, base: '#81c784', sub: '#4a8a5a' },
                        { key: 'target_70', dr: dr?.target_70, wr: wr?.target_70, mr: mr?.target_70, base: '#ef9a9a', sub: '#8a4a4a' },
                        { key: 'target_75', dr: dr?.target_75, wr: wr?.target_75, mr: mr?.target_75, base: '#ef9a9a', sub: '#8a4a4a' },
                        { key: 'target_80', dr: dr?.target_80, wr: wr?.target_80, mr: mr?.target_80, base: '#ef9a9a', sub: '#8a4a4a' },
                      ].map(({ key, dr: dv, wr: wv, mr: mv, base, sub }) => {
                        const gapEl = (t, sz) => {
                          if (t == null || !s?.price) return null
                          const p = (t - s.price) / s.price * 100
                          const txt = `(${p >= 0 ? '+' : ''}${p.toFixed(1)}%)`
                          return <span style={{ fontSize: sz ?? 12, color: p >= 0 ? '#81c784' : '#ef9a9a' }}>{txt}</span>
                        }
                        const isClosest = closestKey === key
                        return (
                          <td key={key} style={{ ...TD, color: base, background: isClosest ? 'var(--bg-hover)' : undefined, border: isClosest ? '2px solid var(--accent)' : undefined, fontWeight: isClosest ? 700 : undefined }}>
                            {dv != null ? <div>{fmt(dv, s?.market)}{gapEl(dv)}</div> : <div style={{ color: 'var(--text-muted)' }}>N/A</div>}
                            <div style={{ fontSize: 10, color: wv != null ? sub : 'var(--text-muted)' }}>{wv != null ? <>{fmt(wv, s?.market)}{gapEl(wv, 9)}</> : 'N/A'}</div>
                            <div style={{ fontSize: 10, color: mv != null ? sub : 'var(--text-muted)' }}>{mv != null ? <>{fmt(mv, s?.market)}{gapEl(mv, 9)}</> : 'N/A'}</div>
                          </td>
                        )
                      })}
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )
        ) : (
          /* 상세화면 */
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 16 }}>
              <button
                onClick={() => setView('list')}
                style={{ background: 'transparent', border: '1px solid var(--border)', color: 'var(--text-muted)', borderRadius: 4, padding: '4px 12px', fontSize: 12, cursor: 'pointer', flexShrink: 0 }}
              >
                ← 목록으로
              </button>
              <div style={{ flex: 1 }}>
                <span style={{ color: 'var(--text-heading)', fontWeight: 700, fontSize: 16 }}>
                  {detail.summary?.name || selected.ticker}
                </span>
                <span style={{ color: 'var(--text-muted)', fontSize: 14, marginLeft: 8 }}>({selected.ticker})</span>
                {detail.summary?.market === 'KR'
                  ? <span style={{ fontSize: 10, marginLeft: 8, padding: '1px 5px', borderRadius: 3, background: '#1a3a2a', color: '#81c784', border: '1px solid #2e6b4a' }}>🇰🇷 KR</span>
                  : <span style={{ fontSize: 10, marginLeft: 8, padding: '1px 5px', borderRadius: 3, background: 'var(--bg-surface)', color: '#4fc3f7', border: '1px solid var(--border)' }}>🇺🇸 US</span>
                }
                {guruMap[selected.ticker] && (
                  <span style={{ color: '#ffb74d', fontSize: 11, marginLeft: 8, background: '#2a1a00', padding: '2px 7px', borderRadius: 3 }}>
                    구루 {guruMap[selected.ticker]}명
                  </span>
                )}
                <span style={{ color: 'var(--text-muted)', fontSize: 13, marginLeft: 12 }}>{selected.date}</span>
                {detail.summary?.price != null && (
                  <span style={{ color: 'var(--text)', fontSize: 14, marginLeft: 12, fontWeight: 600 }}>{fmt(detail.summary.price, detail.summary.market)}</span>
                )}
                {detail.summary?.sector && (
                  <span style={{ color: 'var(--accent)', fontSize: 11, marginLeft: 12, background: 'var(--bg-surface)', padding: '2px 7px', borderRadius: 3 }}>
                    {detail.summary.sector}{detail.summary.industry ? ` / ${detail.summary.industry}` : ''}
                  </span>
                )}
                {detail.summary?.drop_from_high_20d != null && (
                  <span style={{
                    fontSize: 11, marginLeft: 8, padding: '2px 7px', borderRadius: 3,
                    background: detail.summary.drop_from_high_20d >= 0 ? '#1a3a1a' : '#2a1000',
                    color: detail.summary.drop_from_high_20d >= 0 ? '#81c784' : '#ffb74d',
                  }}>
                    {detail.summary.drop_from_high_20d < -10 && <span title="20일 고점 대비 -10% 초과 하락">⚠ </span>}
                    20일고점 {detail.summary.drop_from_high_20d >= 0 ? '+' : ''}{detail.summary.drop_from_high_20d.toFixed(1)}%
                  </span>
                )}
                {detail.summary?.per != null && (
                  <span style={{ color: 'var(--text-muted)', fontSize: 11, marginLeft: 8, background: 'var(--bg-surface)', padding: '2px 7px', borderRadius: 3 }}>
                    PER {detail.summary.per.toFixed(1)}
                    {detail.summary.forward_per != null && <span style={{ color: 'var(--text-muted)', marginLeft: 4 }}>/ Fwd {detail.summary.forward_per.toFixed(1)}</span>}
                  </span>
                )}
                {detail.summary?.pbr != null && (
                  <span style={{ color: 'var(--text-muted)', fontSize: 11, marginLeft: 4, background: 'var(--bg-surface)', padding: '2px 7px', borderRadius: 3 }}>
                    PBR {detail.summary.pbr.toFixed(2)}
                  </span>
                )}
              </div>
              <button
                onClick={() => generateOne(selected.ticker)}
                disabled={!!generating}
                style={{
                  background: 'transparent',
                  border: '1px solid var(--border)',
                  color: generating === selected.ticker ? 'var(--accent)' : 'var(--text-muted)',
                  borderRadius: 4,
                  padding: '4px 12px',
                  fontSize: 12,
                  cursor: generating ? 'default' : 'pointer',
                  flexShrink: 0,
                }}
              >
                {generating === selected.ticker
                  ? `${genProgress.done}/${genProgress.total || '?'}`
                  : '생성'}
              </button>
            </div>
            {/* 탭 바 */}
            <div style={{ display: 'flex', borderBottom: '1px solid var(--border)', marginBottom: 16, marginTop: 4 }}>
              {[
                { key: 'summary', label: '📊 요약' },
                { key: 'technical', label: '📈 기술적 분석' },
                { key: 'report', label: '📄 리포트' },
              ].map(({ key, label }) => (
                <button
                  key={key}
                  onClick={() => setActiveDetailTab(key)}
                  style={{
                    background: 'transparent',
                    border: 'none',
                    borderBottom: activeDetailTab === key ? '2px solid var(--accent)' : '2px solid transparent',
                    color: activeDetailTab === key ? 'var(--accent)' : 'var(--text-muted)',
                    padding: '6px 16px',
                    fontSize: 12,
                    cursor: 'pointer',
                    marginBottom: -1,
                    fontWeight: activeDetailTab === key ? 600 : 400,
                  }}
                >
                  {label}
                </button>
              ))}
            </div>

            {loading && <p style={{ color: 'var(--text-muted)' }}>로딩 중...</p>}
            {!loading && activeDetailTab === 'summary' && (
              detail.summary
                ? <DetailSummaryTab summary={detail.summary} ticker={selected.ticker} />
                : <p style={{ color: 'var(--text-muted)', fontSize: 13 }}>요약 데이터가 없습니다.</p>
            )}
            {!loading && activeDetailTab === 'technical' && (
              detail.summary?.daily_rsi
                ? (
                  <>
                    <RsiTable
                      dailyRsi={detail.summary.daily_rsi}
                      weeklyRsi={detail.summary.weekly_rsi}
                      monthlyRsi={detail.summary.monthly_rsi}
                      price={detail.summary.price}
                      vp={detail.summary.volume_profile}
                      target={detail.summary.target_mean}
                      market={detail.summary.market}
                    />
                  </>
                )
                : <p style={{ color: 'var(--text-muted)', fontSize: 13 }}>기술적 분석 데이터가 없습니다.</p>
            )}
            {!loading && activeDetailTab === 'report' && (
              detail.summary
                ? (
                  <div style={{ padding: '0 4px' }}>
                    <ReportSectionCompetitors
                      competitors={detail.summary.competitors_data}
                      market={detail.summary.market}
                    />
                    <ReportSectionText title="2️⃣ 리스크" text={detail.summary.risks} />
                    <ReportSectionText title="3️⃣ 경제적 해자" text={detail.summary.moat} />
                    <ReportSectionText title="4️⃣ 장기 성장 계획" text={detail.summary.growth_plan} />
                    <ReportSectionNews
                      disclosures={detail.summary.recent_disclosures}
                      news={detail.summary.news}
                    />
                  </div>
                )
                : <p style={{ color: 'var(--text-muted)', fontSize: 13 }}>리포트 데이터가 없습니다.</p>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

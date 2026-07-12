import { ComposedChart, LineChart, Line, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts'

// ── 순수 헬퍼 (vitest 대상) ──────────────────────────────────────

/** metrics를 unit 문자열로 그룹핑 (등장 순서 유지). 반환: [{unit, indexes:[metricIdx]}] */
export function groupMetricsByUnit(metrics) {
  const groups = []
  ;(metrics || []).forEach((m, i) => {
    const unit = m?.unit || ''
    let g = groups.find(x => x.unit === unit)
    if (!g) { g = { unit, indexes: [] }; groups.push(g) }
    g.indexes.push(i)
  })
  return groups
}

/** metrics에 값이 있는 distinct period 수 */
export function distinctPeriods(metrics) {
  const s = new Set()
  ;(metrics || []).forEach(m => (m.series || []).forEach(p => p?.period && p.value != null && s.add(p.period)))
  return s.size
}

/**
 * 차트/표 분할: 차트는 이중축 한계로 unit 그룹 2개까지만 → 앞 2개 그룹은 차트, 나머지 그룹은 표.
 * 차트 대상의 distinct period가 <2면 차트 불가라 전부 표로 폴백.
 * 반환: { chartMetrics, tableMetrics } (원본 순서 보존)
 */
export function splitMetricsForRender(metrics) {
  const groups = groupMetricsByUnit(metrics)
  const chartMetrics = groups.slice(0, 2).flatMap(g => g.indexes).map(i => metrics[i])
  const tableMetrics = groups.slice(2).flatMap(g => g.indexes).map(i => metrics[i])
  if (distinctPeriods(chartMetrics) < 2) return { chartMetrics: [], tableMetrics: metrics || [] }
  return { chartMetrics, tableMetrics }
}

/** recharts rows: [{period, m0: v, m1: v, ...}] — period 정렬 합집합, 결측은 키 생략(gap) */
export function buildChartData(metrics) {
  const periods = new Set()
  ;(metrics || []).forEach(m => (m.series || []).forEach(p => p?.period && periods.add(p.period)))
  return Array.from(periods).sort().map(period => {
    const row = { period }
    ;(metrics || []).forEach((m, i) => {
      const pt = (m.series || []).find(p => p?.period === period)
      if (pt && pt.value != null) row[`m${i}`] = pt.value
    })
    return row
  })
}

// ── 차트 ─────────────────────────────────────────────────────────

const COLORS = ['var(--data-1)', 'var(--data-2)', 'var(--data-3)', 'var(--data-4)', 'var(--data-5)']
const _fmt = v => (typeof v === 'number' ? new Intl.NumberFormat('ko-KR', { notation: 'compact', maximumFractionDigits: 1 }).format(v) : v)

function _tooltip(metrics) {
  return function KeyResourceTooltip({ active, payload, label }) {
    if (!active || !payload?.length) return null
    return (
      <div style={{ background: 'var(--bg-elev)', border: '1px solid var(--border)', borderRadius: 6, padding: '8px 12px', fontSize: 11 }}>
        <div style={{ color: 'var(--accent)', fontWeight: 700, marginBottom: 4 }}>{label}</div>
        {payload.map(e => {
          const m = metrics[Number(String(e.dataKey).slice(1))] || {}
          return (
            <div key={e.dataKey} style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'var(--text)' }}>
              <span style={{ width: 8, height: 8, borderRadius: 2, background: e.color, display: 'inline-block' }} />
              {m.label}: <span className="mono tnum">{Number(e.value).toLocaleString()}</span>{m.unit ? ` ${m.unit}` : ''}
            </div>
          )
        })}
      </div>
    )
  }
}

/** 핵심자원 metrics 차트 — 단위그룹 1개=단일축 Line, 2개=그룹1 Bar(좌)+그룹2 Line(우). 판정은 isChartable로 선행. */
export default function KeyResourceChart({ metrics }) {
  const groups = groupMetricsByUnit(metrics)
  const data = buildChartData(metrics)
  const axisStyle = { fontSize: 10, fill: 'var(--text-3)' }
  const dual = groups.length === 2
  const barIdx = dual ? new Set(groups[0].indexes) : new Set()
  const Wrap = dual ? ComposedChart : LineChart

  return (
    <div style={{ marginBottom: 12 }}>
      <ResponsiveContainer width="100%" height={220}>
        <Wrap data={data} margin={{ top: 8, right: 4, left: 4, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
          <XAxis dataKey="period" tick={axisStyle} axisLine={{ stroke: 'var(--border)' }} tickLine={false} />
          <YAxis yAxisId="left" tick={axisStyle} tickFormatter={_fmt} axisLine={false} tickLine={false} width={44} />
          {dual && <YAxis yAxisId="right" orientation="right" tick={axisStyle} tickFormatter={_fmt} axisLine={false} tickLine={false} width={44} />}
          <Tooltip content={_tooltip(metrics)} />
          {metrics.length >= 2 && <Legend wrapperStyle={{ fontSize: 10 }} formatter={(v, e) => {
            const m = metrics[Number(String(e.dataKey).slice(1))] || {}
            return `${m.label}${m.unit ? ` (${m.unit})` : ''}`
          }} />}
          {metrics.map((m, i) => barIdx.has(i) ? (
            <Bar key={i} yAxisId="left" dataKey={`m${i}`} fill={COLORS[i % COLORS.length]} radius={[4, 4, 0, 0]} maxBarSize={28} />
          ) : (
            <Line key={i} yAxisId={dual ? 'right' : 'left'} dataKey={`m${i}`} stroke={COLORS[i % COLORS.length]} strokeWidth={2} dot={{ r: 3 }} connectNulls />
          ))}
        </Wrap>
      </ResponsiveContainer>
    </div>
  )
}

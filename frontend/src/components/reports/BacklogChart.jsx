import {
  ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, ReferenceLine
} from 'recharts'
import { SectionTitle } from './reportUtils.jsx'

const SECTOR_ORDER = ['항공', '방산', '해양', 'IT서비스', '항공우주']
const SECTOR_COLORS = ['var(--data-2)', 'var(--data-5)', 'var(--data-3)', 'var(--data-4)', 'var(--data-1)', 'var(--corr-pos)', 'var(--corr-neg)']

const fmtAmt = (v) => {
  if (v == null) return '—'
  if (Math.abs(v) >= 10000) return `${(v / 10000).toFixed(1)}조`
  return `${Math.round(v).toLocaleString()}억`
}

const axisStyle = { fontSize: 10, fill: 'var(--text-3)' }

// "한화에어로스페이스㈜및 해외 종속회사" → "한화에어로스페이스㈜"
const shortEntity = (e) =>
  (e || '').replace(/\s*(및\s*)?(해외\s*)?(종속회사|생산법인).*$/, '').replace(/\s+/g, ' ').trim() || e

const sumSegs = (segs) => (segs || []).reduce((s, x) => s + (x.amount || 0), 0)

const rowTotal = (d) =>
  d.amount != null ? d.amount : (Array.isArray(d.segments) && d.segments.length ? sumSegs(d.segments) : null)

export default function BacklogChart({ data }) {
  if (!data?.length) return null

  const segmented = data.some(d => Array.isArray(d.segments) && d.segments.length)

  // 총합 + QoQ (총합 기준)
  const withQoq = data.map((d, i) => {
    const total = rowTotal(d)
    const prevTotal = i > 0 ? rowTotal(data[i - 1]) : null
    let qoq = null
    if (prevTotal != null && total != null && prevTotal !== 0) {
      qoq = Math.round((total - prevTotal) / Math.abs(prevTotal) * 1000) / 10
    }
    return { row: d, total, qoq }
  })

  // ── 단일 막대 (segments 없는 종목: 기존 동작 유지) ──
  if (!segmented) {
    const chartData = withQoq.map(({ row, total, qoq }) => ({
      quarter: row.quarter, amount: total, qoq, source: row.source,
    }))
    const sources = [...new Set(data.map(d => d.source).filter(Boolean))]
    const SourceBadge = ({ source }) => {
      if (source === 'llm') return <span style={badgeStyle('var(--color-info)')}>AI 추출</span>
      if (source === 'manual') return <span style={badgeStyle('var(--data-4)')}>수동</span>
      return null
    }
    const SingleTooltip = ({ active, payload, label }) => {
      if (!active || !payload?.length) return null
      const row = payload[0]?.payload
      const warn = row.qoq != null && Math.abs(row.qoq) > 200
      return (
        <div style={tooltipBox}>
          <div style={{ color: 'var(--accent)', fontWeight: 700, marginBottom: 4 }}>{label}{warn && ' ⚠️'}</div>
          {row.amount != null && <div style={{ color: 'var(--data-2)', marginBottom: 2 }}>수주잔고: {fmtAmt(row.amount)}원</div>}
          {row.qoq != null && <div style={{ color: row.qoq >= 0 ? 'var(--up)' : 'var(--down)' }}>QoQ: {row.qoq >= 0 ? '+' : ''}{row.qoq}%{warn && <span style={{ marginLeft: 4, color: 'var(--warn)' }}>이상값</span>}</div>}
          {row.source && <div style={{ marginTop: 4, fontSize: 10, color: 'var(--text-3)' }}>출처: {row.source === 'llm' ? 'AI 추출' : row.source === 'manual' ? '수동' : 'DART'}</div>}
        </div>
      )
    }
    return (
      <div style={cardStyle}>
        <SectionTitle right={<div style={{ display: 'flex', gap: 4 }}>
          {sources.includes('llm') && <SourceBadge source="llm" />}
          {sources.includes('manual') && <SourceBadge source="manual" />}
        </div>}>📦 수주잔고 추이</SectionTitle>
        <div style={{ display: 'flex', gap: 12, fontSize: 10, color: 'var(--text-3)', marginBottom: 4 }}>
          <Legend color="var(--data-2)" label="수주잔고" />
          <Legend color="var(--data-3)" label="QoQ 변동률" line />
        </div>
        <ResponsiveContainer width="100%" height={180}>
          <ComposedChart data={chartData} margin={{ top: 8, right: 36, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--chart-grid)" />
            <XAxis dataKey="quarter" tick={axisStyle} axisLine={false} tickLine={false} />
            <YAxis yAxisId="left" tickFormatter={fmtAmt} tick={axisStyle} axisLine={false} tickLine={false} width={40} />
            <YAxis yAxisId="right" orientation="right" tickFormatter={v => `${v}%`} tick={axisStyle} axisLine={false} tickLine={false} width={36} />
            <Tooltip content={<SingleTooltip />} />
            <ReferenceLine yAxisId="right" y={0} stroke="var(--border)" />
            <Bar yAxisId="left" dataKey="amount" name="수주잔고" fill="var(--data-2)" opacity={0.8} radius={[2, 2, 0, 0]} />
            <Line yAxisId="right" type="monotone" dataKey="qoq" name="QoQ%" stroke="var(--data-3)" strokeWidth={2} dot={{ r: 3 }} activeDot={{ r: 5 }} connectNulls />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    )
  }

  // ── 사업부문별 누적 막대 (segments 보유 종목) ──
  const sectorSet = new Set()
  data.forEach(d => (d.segments || []).forEach(s => sectorSet.add(s.sector || '기타')))
  const sectors = [...sectorSet].sort((a, b) => {
    const ia = SECTOR_ORDER.indexOf(a), ib = SECTOR_ORDER.indexOf(b)
    if (ia === -1 && ib === -1) return a.localeCompare(b)
    if (ia === -1) return 1
    if (ib === -1) return -1
    return ia - ib
  })
  const colorOf = (sec) => SECTOR_COLORS[sectors.indexOf(sec) % SECTOR_COLORS.length]

  const chartData = withQoq.map(({ row, total, qoq }) => {
    const p = { quarter: row.quarter, qoq, total, _segments: row.segments || [] }
    sectors.forEach(s => { p[s] = 0 })
    ;(row.segments || []).forEach(s => { p[s.sector || '기타'] += (s.amount || 0) })
    return p
  })

  // 부문별 법인 내역(툴팁): {sector, total, entities:[{entity, amount}]}
  const groupByEntity = (segs) => {
    const m = {}
    ;(segs || []).forEach(s => {
      const sec = s.sector || '기타'
      m[sec] = m[sec] || { sector: sec, total: 0, entities: [] }
      m[sec].total += (s.amount || 0)
      m[sec].entities.push({ entity: s.entity, amount: s.amount })
    })
    return sectors.filter(s => m[s]).map(s => m[s])
  }

  const SegTooltip = ({ active, payload, label }) => {
    if (!active || !payload?.length) return null
    const row = payload[0]?.payload
    const warn = row.qoq != null && Math.abs(row.qoq) > 200
    return (
      <div style={tooltipBox}>
        <div style={{ color: 'var(--accent)', fontWeight: 700, marginBottom: 4 }}>{label}{warn && ' ⚠️'}</div>
        <div style={{ color: 'var(--text)', marginBottom: 4 }}>합계: {fmtAmt(row.total)}원</div>
        {groupByEntity(row._segments).map(g => (
          <div key={g.sector} style={{ marginBottom: 2 }}>
            <div style={{ color: colorOf(g.sector) }}>■ {g.sector}: {fmtAmt(g.total)}</div>
            {g.entities.map((e, i) => (
              <div key={i} style={{ fontSize: 10, color: 'var(--text-3)', marginLeft: 12 }}>
                {shortEntity(e.entity)} · {fmtAmt(e.amount)}
              </div>
            ))}
          </div>
        ))}
        {row.qoq != null && <div style={{ marginTop: 2, color: row.qoq >= 0 ? 'var(--up)' : 'var(--down)' }}>QoQ: {row.qoq >= 0 ? '+' : ''}{row.qoq}%{warn && <span style={{ marginLeft: 4, color: 'var(--warn)' }}>이상값</span>}</div>}
      </div>
    )
  }

  return (
    <div style={cardStyle}>
      <SectionTitle right={<span style={badgeStyle('var(--color-info)')}>AI 추출</span>}>📦 수주잔고 추이 (사업부문별)</SectionTitle>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', fontSize: 10, color: 'var(--text-3)', marginBottom: 4 }}>
        {sectors.map(s => <Legend key={s} color={colorOf(s)} label={s} />)}
        <Legend color="var(--data-3)" label="QoQ" line />
      </div>
      <ResponsiveContainer width="100%" height={200}>
        <ComposedChart data={chartData} margin={{ top: 8, right: 36, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--chart-grid)" />
          <XAxis dataKey="quarter" tick={axisStyle} axisLine={false} tickLine={false} />
          <YAxis yAxisId="left" tickFormatter={fmtAmt} tick={axisStyle} axisLine={false} tickLine={false} width={40} />
          <YAxis yAxisId="right" orientation="right" tickFormatter={v => `${v}%`} tick={axisStyle} axisLine={false} tickLine={false} width={36} />
          <Tooltip content={<SegTooltip />} />
          <ReferenceLine yAxisId="right" y={0} stroke="var(--border)" />
          {sectors.map((s, i) => (
            <Bar key={s} yAxisId="left" dataKey={s} stackId="a" fill={colorOf(s)} opacity={0.85}
              radius={i === sectors.length - 1 ? [2, 2, 0, 0] : [0, 0, 0, 0]} />
          ))}
          <Line yAxisId="right" type="monotone" dataKey="qoq" name="QoQ%" stroke="var(--data-3)" strokeWidth={2} dot={{ r: 3 }} activeDot={{ r: 5 }} connectNulls />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  )
}

const cardStyle = { background: 'var(--bg-elev)', borderRadius: 6, padding: 14, marginTop: 12 }
const tooltipBox = { background: 'var(--bg-elev)', border: '1px solid var(--border)', borderRadius: 6, padding: '8px 12px', fontSize: 11 }
const badgeStyle = (color) => ({ fontSize: 9, padding: '1px 5px', borderRadius: 3, background: `color-mix(in srgb, ${color} 14%, transparent)`, color, border: `1px solid ${color}` })

function Legend({ color, label, line }) {
  return (
    <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
      <span style={{ width: line ? 16 : 10, height: line ? 2 : 10, background: color, display: 'inline-block', borderRadius: line ? 1 : 2 }} />
      {label}
    </span>
  )
}

import {
  ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, ReferenceLine
} from 'recharts'
import { SectionTitle } from './reportUtils.jsx'

export default function BacklogChart({ data }) {
  if (!data?.length) return null

  // QoQ 변동률 계산
  const chartData = data.map((d, i) => {
    const prev = i > 0 ? data[i - 1] : null
    let qoq = null
    if (prev?.amount != null && d.amount != null && prev.amount !== 0) {
      qoq = Math.round((d.amount - prev.amount) / Math.abs(prev.amount) * 1000) / 10
    }
    return { ...d, qoq }
  })

  const fmtAmt = (v) => {
    if (v == null) return '—'
    if (Math.abs(v) >= 10000) return `${(v / 10000).toFixed(1)}조`
    return `${Math.round(v).toLocaleString()}억`
  }

  const axisStyle = { fontSize: 10, fill: 'var(--text-3)' }

  const CustomTooltip = ({ active, payload, label }) => {
    if (!active || !payload?.length) return null
    const row = payload[0]?.payload
    const hasWarning = row.qoq != null && Math.abs(row.qoq) > 200
    return (
      <div style={{ background: 'var(--bg-elev)', border: '1px solid var(--border)', borderRadius: 6, padding: '8px 12px', fontSize: 11 }}>
        <div style={{ color: 'var(--accent)', fontWeight: 700, marginBottom: 4 }}>
          {label}
          {hasWarning && <span style={{ marginLeft: 6 }}>⚠️</span>}
        </div>
        {row.amount != null && (
          <div style={{ color: '#4fc3f7', marginBottom: 2 }}>
            수주잔고: {fmtAmt(row.amount)}원
          </div>
        )}
        {row.qoq != null && (
          <div style={{ color: row.qoq >= 0 ? '#81c784' : '#ef9a9a' }}>
            QoQ: {row.qoq >= 0 ? '+' : ''}{row.qoq}%
            {hasWarning && <span style={{ marginLeft: 4, color: '#ffb74d' }}>이상값</span>}
          </div>
        )}
        {row.source && (
          <div style={{ marginTop: 4, fontSize: 10, color: 'var(--text-3)' }}>
            출처: {row.source === 'llm' ? 'AI 추출' : row.source === 'manual' ? '수동' : 'DART'}
          </div>
        )}
      </div>
    )
  }

  const SourceBadge = ({ source }) => {
    if (source === 'llm') return (
      <span style={{ fontSize: 9, padding: '1px 5px', borderRadius: 3, background: '#1a2a3a', color: '#4fc3f7', border: '1px solid #4fc3f7' }}>AI 추출</span>
    )
    if (source === 'manual') return (
      <span style={{ fontSize: 9, padding: '1px 5px', borderRadius: 3, background: '#2a1a2a', color: '#ce93d8', border: '1px solid #ce93d8' }}>수동</span>
    )
    return null
  }

  const sources = [...new Set(data.map(d => d.source).filter(Boolean))]
  const hasLlm = sources.includes('llm')
  const hasManual = sources.includes('manual')

  return (
    <div style={{ background: 'var(--bg-elev)', borderRadius: 6, padding: 14, marginTop: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        <SectionTitle>📦 수주잔고 추이</SectionTitle>
        <div style={{ display: 'flex', gap: 4 }}>
          {hasLlm && <SourceBadge source="llm" />}
          {hasManual && <SourceBadge source="manual" />}
        </div>
      </div>

      <div style={{ display: 'flex', gap: 12, fontSize: 10, color: 'var(--text-3)', marginBottom: 4 }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <span style={{ width: 10, height: 10, background: '#4fc3f7', display: 'inline-block', borderRadius: 2 }} />
          수주잔고
        </span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <span style={{ width: 16, height: 2, background: '#ffcc80', display: 'inline-block', borderRadius: 1 }} />
          QoQ 변동률
        </span>
      </div>

      <ResponsiveContainer width="100%" height={180}>
        <ComposedChart data={chartData} margin={{ top: 8, right: 36, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--chart-grid)" />
          <XAxis dataKey="quarter" tick={axisStyle} axisLine={false} tickLine={false} />
          <YAxis yAxisId="left" tickFormatter={fmtAmt} tick={axisStyle} axisLine={false} tickLine={false} width={40} />
          <YAxis yAxisId="right" orientation="right" tickFormatter={v => `${v}%`} tick={axisStyle} axisLine={false} tickLine={false} width={36} />
          <Tooltip content={<CustomTooltip />} />
          <ReferenceLine yAxisId="right" y={0} stroke="var(--border)" />
          <Bar yAxisId="left" dataKey="amount" name="수주잔고" fill="#4fc3f7" opacity={0.8} radius={[2, 2, 0, 0]} />
          <Line yAxisId="right" type="monotone" dataKey="qoq" name="QoQ%" stroke="#ffcc80" strokeWidth={2} dot={{ r: 3 }} activeDot={{ r: 5 }} connectNulls />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  )
}

import { useState, useEffect } from 'react'
import api from '../../api'
import {
  ComposedChart, Area, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, Legend, ResponsiveContainer,
} from 'recharts'
import { CARD_STYLE, DESC_STYLE, SectionCard, SectionCardLoading, SectionCardError } from './marketUtils.jsx'

const SIGNAL_STYLE = {
  display: 'inline-block',
  fontSize: 11,
  fontWeight: 600,
  padding: '2px 7px',
  borderRadius: 4,
  marginRight: 6,
}

export default function LeverageSection() {
  const [open, setOpen] = useState(false)
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    api.get('/api/market/leverage')
      .then(r => setData(r.data))
      .catch(() => setError(true))
      .finally(() => setLoading(false))
  }, [])

  if (loading) return <SectionCardLoading title="한국 레버리지: 신용잔고·반대매매" />
  if (error || !data) return <SectionCardError title="한국 레버리지: 신용잔고·반대매매" />

  const { history = [], signals, latest } = data
  const { credit_ratio_alert, credit_ratio_p90, margin_call_signal, credit_momentum } = signals || {}

  const latestCredit = latest?.total_credit
  const latestRatio  = latest?.liquidation_ratio
  const summary = latestCredit != null ? `신용잔고 ${latestCredit.toFixed(1)}조` : ''

  const badges = []
  if (credit_ratio_alert)
    badges.push({ label: '빚투 과열', color: 'var(--down)', bg: 'rgba(239,68,68,0.12)' })
  if (margin_call_signal === 'ALERT')
    badges.push({ label: '반대매매 급증', color: 'var(--down)', bg: 'rgba(239,68,68,0.12)' })
  if (credit_momentum === 'ACCELERATING')
    badges.push({ label: '신용잔고 가속', color: '#f59e0b', bg: 'rgba(245,158,11,0.12)' })

  const badgeEls = badges.length > 0 ? (
    <span style={{ marginLeft: 8 }}>
      {badges.map(b => (
        <span key={b.label} style={{ ...SIGNAL_STYLE, color: b.color, background: b.bg }}>
          {b.label}
        </span>
      ))}
    </span>
  ) : null

  return (
    <SectionCard
      title={<>한국 레버리지: 신용잔고·반대매매{badgeEls}</>}
      summary={summary}
      open={open}
      onToggle={() => setOpen(o => !o)}
    >
      <p style={DESC_STYLE}>
        코스피·코스닥 신용융자 잔고와 반대매매 비중을 추적합니다.
        신용잔고 시총 비율이 5년 90백분위수를 초과하거나 반대매매가 급증하면 단기 과열 또는 투매 신호로 해석할 수 있습니다.
        {credit_ratio_p90 != null && ` (90분위 기준: ${credit_ratio_p90.toFixed(2)}%)`}
      </p>

      {latest && (
        <div style={{ display: 'flex', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
          {[
            { label: '신용잔고', value: latestCredit, unit: '조원', color: '#4fc3f7' },
            { label: '반대매매 비중', value: latestRatio, unit: '%', color: '#ef5350' },
          ].map(({ label, value, unit, color }) => (
            <div key={label} style={{ ...CARD_STYLE, minWidth: 120, flex: 1 }}>
              <div style={{ fontSize: 11, color: 'var(--text-3)', marginBottom: 4 }}>{label}</div>
              <div style={{ fontSize: 20, fontWeight: 700, color }}>
                {value != null ? value.toFixed(label === '신용잔고' ? 1 : 2) : '—'}
                <span style={{ fontSize: 12, marginLeft: 3, color: 'var(--text-3)' }}>{unit}</span>
              </div>
            </div>
          ))}
        </div>
      )}

      <div style={{ outline: 'none', WebkitTapHighlightColor: 'transparent' }}>
      <ResponsiveContainer width="100%" height={220}>
        <ComposedChart data={history} margin={{ top: 4, right: 16, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
          <XAxis
            dataKey="date"
            tick={{ fontSize: 10, fill: 'var(--text-3)' }}
            tickFormatter={d => d?.slice(5)}
            interval="preserveStartEnd"
          />
          <YAxis
            yAxisId="left"
            tick={{ fontSize: 10, fill: 'var(--text-3)' }}
            tickFormatter={v => `${v}조`}
            width={42}
          />
          <YAxis
            yAxisId="right"
            orientation="right"
            tick={{ fontSize: 10, fill: 'var(--text-3)' }}
            tickFormatter={v => `${v}%`}
            width={36}
          />
          <Tooltip
            contentStyle={{ background: 'var(--bg-elev)', border: '1px solid var(--border)', fontSize: 12 }}
            labelStyle={{ color: 'var(--text-3)' }}
            labelFormatter={d => d ? `${d.slice(0,4)}년 ${d.slice(5,7)}월 ${d.slice(8,10)}일` : ''}
            cursor={{ fill: 'transparent' }}
            formatter={(v, name) => {
              if (name === '반대매매 비중') return [`${v}%`, name]
              return [`${v}조`, name]
            }}
          />
          <Legend wrapperStyle={{ fontSize: 11 }} />
          <Area
            yAxisId="left"
            type="monotone"
            dataKey="total_credit"
            name="신용잔고 합계"
            fill="#4fc3f740"
            stroke="#4fc3f7"
            strokeWidth={1.5}
            dot={false}
          />
          <Line
            yAxisId="right"
            type="monotone"
            dataKey="liquidation_ratio"
            name="반대매매 비중"
            stroke="#ef5350"
            strokeWidth={1.5}
            dot={false}
          />
        </ComposedChart>
      </ResponsiveContainer>
      </div>
    </SectionCard>
  )
}

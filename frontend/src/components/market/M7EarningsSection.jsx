import { useState, useEffect } from 'react'
import api from '../../api'
import { LineChart, Line, LabelList, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts'
import { CARD_STYLE, SECTION_STYLE, SECTION_HEADER_STYLE, DESC_STYLE, LoadingBox, ErrorBox, isEstimated } from './marketUtils.jsx'

export default function M7EarningsSection() {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    api.get('/api/market/m7-earnings')
      .then(r => setData(r.data))
      .catch(() => setError(true))
      .finally(() => setLoading(false))
  }, [])

  if (loading) return <div style={SECTION_STYLE}><h3 style={SECTION_HEADER_STYLE}>M7 vs 나머지 S&P 500 순이익</h3><LoadingBox /></div>
  if (error || !data) return <div style={SECTION_STYLE}><h3 style={SECTION_HEADER_STYLE}>M7 vs 나머지 S&P 500 순이익</h3><ErrorBox /></div>

  const qs = data.quarters.map(q => ({
    ...q,
    m7share: q.m7 != null && q.rest != null ? q.m7 / (q.m7 + q.rest) * 100 : null,
  }))
  const latest = qs[qs.length - 1]
  const prev = qs[qs.length - 2]
  const [latestYear, latestQNum] = latest?.q?.split('Q') || []
  const yoy = qs.find(q => q.q === `${parseInt(latestYear) - 1}Q${latestQNum}`)
  const chg = (cur, base) => base ? ((cur - base) / Math.abs(base) * 100) : null
  const m7Share = latest ? (latest.m7 / (latest.m7 + latest.rest) * 100) : null
  const m7SharePrev = yoy ? (yoy.m7 / (yoy.m7 + yoy.rest) * 100) : null

  return (
    <div style={SECTION_STYLE}>
      <h3 style={SECTION_HEADER_STYLE}>M7 vs 나머지 S&P 500 순이익</h3>
      <p style={DESC_STYLE}>애플·마이크로소프트·구글·아마존·엔비디아·메타·테슬라 7개 빅테크의 분기 순이익과 S&P 500 나머지 493종목을 비교합니다. M7 비중이 높을수록 지수 수익률이 소수 종목에 집중되어 있음을 의미합니다.</p>
      <div style={{ display: 'flex', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
        {[
          { label: 'M7', value: latest?.m7, qoq: chg(latest?.m7, prev?.m7), yoy: chg(latest?.m7, yoy?.m7), color: '#4fc3f7' },
          { label: '나머지 S&P 500', value: latest?.rest, qoq: chg(latest?.rest, prev?.rest), yoy: chg(latest?.rest, yoy?.rest), color: '#80cbc4' },
        ].map(({ label, value, qoq, yoy: yoyChg, color }) => (
          <div key={label} style={{ ...CARD_STYLE, minWidth: 140, flex: 1 }}>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 4 }}>{label} 순이익 ({latest?.q})</div>
            <div style={{ fontSize: 20, fontWeight: 700, color }}>
              {value != null ? value.toLocaleString() : '-'} <span style={{ fontSize: 11, fontWeight: 400 }}>{data.unit}</span>
            </div>
            {qoq != null && (
              <div style={{ fontSize: 12, color: qoq > 0 ? '#81c784' : '#e57373', marginTop: 3 }}>
                {qoq > 0 ? '▲' : '▼'} {Math.abs(qoq).toFixed(1)}% <span style={{ color: 'var(--text-muted)' }}>QoQ</span>
              </div>
            )}
            {yoyChg != null && (
              <div style={{ fontSize: 12, color: yoyChg > 0 ? '#81c784' : '#e57373', marginTop: 2 }}>
                {yoyChg > 0 ? '▲' : '▼'} {Math.abs(yoyChg).toFixed(1)}% <span style={{ color: 'var(--text-muted)' }}>YoY</span>
              </div>
            )}
          </div>
        ))}
        <div style={{ ...CARD_STYLE, minWidth: 120, flex: 1 }}>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 4 }}>M7 순이익 비중</div>
          <div style={{ fontSize: 20, fontWeight: 700, color: '#ffb74d' }}>
            {m7Share != null ? m7Share.toFixed(1) : '-'}<span style={{ fontSize: 13 }}>%</span>
          </div>
          {m7Share != null && m7SharePrev != null && (
            <div style={{ fontSize: 12, color: m7Share > m7SharePrev ? '#81c784' : '#e57373', marginTop: 3 }}>
              {m7Share > m7SharePrev ? '▲' : '▼'} {Math.abs(m7Share - m7SharePrev).toFixed(1)}%p <span style={{ color: 'var(--text-muted)' }}>YoY</span>
            </div>
          )}
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>M7 / 전체 S&P 500</div>
        </div>
      </div>
      <div style={CARD_STYLE}>
        <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 8 }}>
          분기별 순이익 추이 ({data.unit}) — AAPL·MSFT·GOOGL·AMZN·NVDA·META·TSLA vs S&P 500 ex-M7
        </div>
        <ResponsiveContainer width="100%" height={240}>
          <LineChart data={qs} margin={{ top: 16, right: 40, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
            <XAxis dataKey="q" tick={{ fontSize: 10, fill: 'var(--text-muted)' }} tickFormatter={v => isEstimated(v) ? `${v}(E)` : v} />
            <YAxis yAxisId="left" tick={{ fontSize: 10, fill: 'var(--text-muted)' }} domain={['auto', 'auto']} />
            <YAxis yAxisId="right" orientation="right" domain={[0, 100]} tick={{ fontSize: 10, fill: '#ffb74d' }} tickFormatter={v => `${v}%`} />
            <Tooltip contentStyle={{ background: 'var(--bg-card)', border: '1px solid var(--border)', fontSize: 12 }}
                     formatter={(v, n) => n === 'M7 비중' ? [`${v?.toFixed(1)}%`, n] : v != null ? [v.toLocaleString() + ' ' + data.unit, n] : ['-', n]} />
            <Legend wrapperStyle={{ fontSize: 12 }} />
            <Line yAxisId="left" type="monotone" dataKey="m7" name="M7" stroke="#4fc3f7" dot={{ r: 3 }} strokeWidth={2}>
              <LabelList dataKey="m7" position="top" style={{ fontSize: 9, fill: '#4fc3f7' }} formatter={v => v?.toFixed(0)} />
            </Line>
            <Line yAxisId="left" type="monotone" dataKey="rest" name="나머지" stroke="#80cbc4" dot={{ r: 3 }} strokeWidth={2}>
              <LabelList dataKey="rest" position="bottom" style={{ fontSize: 9, fill: '#80cbc4' }} formatter={v => v?.toFixed(0)} />
            </Line>
            <Line yAxisId="right" type="monotone" dataKey="m7share" name="M7 비중" stroke="#ffb74d" dot={false} strokeWidth={1.5} strokeDasharray="4 2" />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}

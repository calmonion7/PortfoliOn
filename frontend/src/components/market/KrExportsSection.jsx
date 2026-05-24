import { useState, useEffect } from 'react'
import axios from 'axios'
import { LineChart, Line, LabelList, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts'
import { CARD_STYLE, SECTION_STYLE, SECTION_HEADER_STYLE, DESC_STYLE, LoadingBox, ErrorBox } from './marketUtils.jsx'

export default function KrExportsSection() {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    axios.get('/api/market/kr-exports')
      .then(r => setData(r.data))
      .catch(() => setError(true))
      .finally(() => setLoading(false))
  }, [])

  if (loading) return <div style={SECTION_STYLE}><h3 style={SECTION_HEADER_STYLE}>한국 수출: 반도체 vs 비반도체</h3><LoadingBox /></div>
  if (error || !data) return <div style={SECTION_STYLE}><h3 style={SECTION_HEADER_STYLE}>한국 수출: 반도체 vs 비반도체</h3><ErrorBox /></div>

  if (data.error) {
    return (
      <div style={SECTION_STYLE}>
        <h3 style={SECTION_HEADER_STYLE}>한국 수출: 반도체 vs 비반도체</h3>
        <div style={{ ...CARD_STYLE, fontSize: 13, color: 'var(--text-muted)' }}>
          <p>{data.error}</p>
        </div>
      </div>
    )
  }

  const months = (data.months || []).map(m => ({
    ...m,
    semishare: m.semiconductor != null && m.non_semiconductor != null
      ? m.semiconductor / (m.semiconductor + m.non_semiconductor) * 100 : null,
  }))
  const latest = months[months.length - 1]
  const prev = months[months.length - 2]
  const yoyMonth = latest ? `${parseInt(latest.month.slice(0, 4)) - 1}${latest.month.slice(4)}` : null
  const yoy3 = months.find(m => m.month === yoyMonth)
  const chg3 = (cur, base) => base ? ((cur - base) / Math.abs(base) * 100) : null
  const semiShare = latest ? (latest.semiconductor / (latest.semiconductor + latest.non_semiconductor) * 100) : null
  const semiSharePrev = yoy3 ? (yoy3.semiconductor / (yoy3.semiconductor + yoy3.non_semiconductor) * 100) : null
  const latestLabel = latest?.month?.replace(/(\d{4})(\d{2})/, '$1-$2')

  return (
    <div style={SECTION_STYLE}>
      <h3 style={SECTION_HEADER_STYLE}>한국 수출: 반도체 vs 비반도체</h3>
      <p style={DESC_STYLE}>관세청 월별 수출 통계 기준입니다. 반도체(HS 8542)는 한국 무역수지와 원화 가치의 핵심 동력으로, 수출 비중 상승은 업황 호조를 의미합니다. 비반도체 비중은 수출 다각화 정도를 나타냅니다.</p>
      <div style={{ display: 'flex', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
        {[
          { label: '반도체', value: latest?.semiconductor, mom: chg3(latest?.semiconductor, prev?.semiconductor), yoy: chg3(latest?.semiconductor, yoy3?.semiconductor), color: '#4fc3f7' },
          { label: '비반도체', value: latest?.non_semiconductor, mom: chg3(latest?.non_semiconductor, prev?.non_semiconductor), yoy: chg3(latest?.non_semiconductor, yoy3?.non_semiconductor), color: '#80cbc4' },
        ].map(({ label, value, mom, yoy: yoyChg, color }) => (
          <div key={label} style={{ ...CARD_STYLE, minWidth: 140, flex: 1 }}>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 4 }}>{label} 수출액 ({latestLabel})</div>
            <div style={{ fontSize: 20, fontWeight: 700, color }}>
              {value != null ? value.toLocaleString() : '-'} <span style={{ fontSize: 11, fontWeight: 400 }}>억달러</span>
            </div>
            {mom != null && (
              <div style={{ fontSize: 12, color: mom > 0 ? '#81c784' : '#e57373', marginTop: 3 }}>
                {mom > 0 ? '▲' : '▼'} {Math.abs(mom).toFixed(1)}% <span style={{ color: 'var(--text-muted)' }}>MoM</span>
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
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 4 }}>반도체 수출 비중</div>
          <div style={{ fontSize: 20, fontWeight: 700, color: '#ffb74d' }}>
            {semiShare != null ? semiShare.toFixed(1) : '-'}<span style={{ fontSize: 13 }}>%</span>
          </div>
          {semiShare != null && semiSharePrev != null && (
            <div style={{ fontSize: 12, color: semiShare > semiSharePrev ? '#81c784' : '#e57373', marginTop: 3 }}>
              {semiShare > semiSharePrev ? '▲' : '▼'} {Math.abs(semiShare - semiSharePrev).toFixed(1)}%p <span style={{ color: 'var(--text-muted)' }}>YoY</span>
            </div>
          )}
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>반도체 / 전체 수출</div>
        </div>
      </div>
      <div style={CARD_STYLE}>
        <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 8 }}>
          월별 수출액 추이 (억달러) — 반도체 vs 비반도체
        </div>
        <ResponsiveContainer width="100%" height={240}>
          <LineChart data={months} margin={{ top: 16, right: 40, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
            <XAxis dataKey="month" tick={{ fontSize: 10, fill: 'var(--text-muted)' }}
                   tickFormatter={v => v.slice(2)} />
            <YAxis yAxisId="left" tick={{ fontSize: 10, fill: 'var(--text-muted)' }} domain={['auto', 'auto']} />
            <YAxis yAxisId="right" orientation="right" domain={[0, 100]} tick={{ fontSize: 10, fill: '#ffb74d' }} tickFormatter={v => `${v}%`} />
            <Tooltip contentStyle={{ background: 'var(--bg-card)', border: '1px solid var(--border)', fontSize: 12 }}
                     labelFormatter={v => v.replace(/(\d{4})(\d{2})/, '$1-$2')}
                     formatter={(v, n) => n === '반도체 비중' ? [`${v?.toFixed(1)}%`, n] : [v.toLocaleString() + ' 억달러', n]} />
            <Legend wrapperStyle={{ fontSize: 12 }} />
            <Line yAxisId="left" type="monotone" dataKey="semiconductor" name="반도체" stroke="#4fc3f7" dot={{ r: 3 }} strokeWidth={2}>
              <LabelList dataKey="semiconductor" position="top" style={{ fontSize: 9, fill: '#4fc3f7' }} formatter={v => v?.toFixed(0)} />
            </Line>
            <Line yAxisId="left" type="monotone" dataKey="non_semiconductor" name="비반도체" stroke="#80cbc4" dot={{ r: 3 }} strokeWidth={2}>
              <LabelList dataKey="non_semiconductor" position="bottom" style={{ fontSize: 9, fill: '#80cbc4' }} formatter={v => v?.toFixed(0)} />
            </Line>
            <Line yAxisId="right" type="monotone" dataKey="semishare" name="반도체 비중" stroke="#ffb74d" dot={false} strokeWidth={1.5} strokeDasharray="4 2" />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}

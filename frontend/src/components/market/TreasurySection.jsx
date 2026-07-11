import { useState, useEffect } from 'react'
import api from '../../api'
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, ReferenceLine } from 'recharts'
import { DESC_STYLE, SectionCard, SectionCardLoading, SectionCardError } from './marketUtils.jsx'

export default function TreasurySection() {
  const [open, setOpen] = useState(true)
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    api.get('/api/market/treasury')
      .then(r => setData(r.data))
      .catch(() => setError(true))
      .finally(() => setLoading(false))
  }, [])

  if (loading) return <SectionCardLoading title="미국 국채금리" />
  if (error || !data) return <SectionCardError title="미국 국채금리" />

  const LABELS = { '3m': '3개월', '5y': '5년', '10y': '10년', '30y': '30년' }
  const rates = data.rates || {}
  const h3m = Object.fromEntries((data.history?.['3m'] || []).map(d => [d.date, d.value]))
  const h10y = Object.fromEntries((data.history?.['10y'] || []).map(d => [d.date, d.value]))
  const chartData = Object.keys({ ...h3m, ...h10y }).sort().slice(-252).map(date => ({
    date: date.slice(5),
    '3개월': h3m[date] ?? null,
    '10년': h10y[date] ?? null,
    '스프레드': h3m[date] != null && h10y[date] != null
      ? Math.round((h10y[date] - h3m[date]) * 1000) / 1000
      : null,
  }))

  const r10y = rates['10y']
  const summary = r10y ? `10Y ${r10y.current.toFixed(2)}%` : ''

  return (
    <SectionCard title="미국 국채금리" summary={summary} change={r10y?.change_bp ?? null} changeSuffix="bp" open={open} onToggle={() => setOpen(o => !o)}>
      <p style={DESC_STYLE}>연준 통화정책 방향의 핵심 지표입니다. 단기(2년)는 금리 기대를, 장기(10년·30년)는 경기 및 인플레이션 전망을 반영합니다. 2년물이 10년물을 상회하는 장단기 역전은 역사적으로 경기 침체의 선행 신호입니다.</p>
      <div className="yield-row yield-row--4" style={{ marginBottom: 20 }}>
        {['3m', '5y', '10y', '30y'].map(key => {
          const r = rates[key]
          const up = r?.change_bp > 0
          const down = r?.change_bp < 0
          return (
            <div key={key} className="metric-tile">
              <div className="lbl">{LABELS[key]}</div>
              <div className="v">{r ? `${r.current.toFixed(2)}%` : '-'}</div>
              {r && (
                <div className="d" style={{ color: up ? 'var(--up)' : down ? 'var(--down)' : 'var(--text-3)' }}>
                  {up ? '▲' : down ? '▼' : '─'} {Math.abs(r.change_bp).toFixed(1)}bp
                </div>
              )}
            </div>
          )
        })}
      </div>
      {chartData.length > 0 && (
        <div className="chartbox">
          <div className="sub">3개월 / 10년 금리 추이 (1년) + 스프레드(10Y-3M)</div>
          <ResponsiveContainer width="100%" height={220}>
            <LineChart data={chartData} margin={{ top: 4, right: 16, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
              <XAxis dataKey="date" tick={{ fontSize: 10, fill: 'var(--text-3)' }}
                     interval={Math.floor(chartData.length / 6)} />
              <YAxis tick={{ fontSize: 10, fill: 'var(--text-3)' }} domain={['auto', 'auto']} width={36} />
              <Tooltip contentStyle={{ background: 'var(--bg-elev)', border: '1px solid var(--border)', fontSize: 12 }}
                       labelStyle={{ color: 'var(--text-3)' }} />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <ReferenceLine y={0} stroke="var(--border)" />
              <Line type="monotone" dataKey="10년" stroke="var(--data-2)" dot={false} strokeWidth={1.5} />
              <Line type="monotone" dataKey="3개월" stroke="var(--data-5)" dot={false} strokeWidth={1.5} />
              <Line type="monotone" dataKey="스프레드" stroke="var(--data-3)" dot={false} strokeWidth={1} strokeDasharray="4 2" />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
    </SectionCard>
  )
}

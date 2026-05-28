import { useState, useEffect } from 'react'
import api from '../../api'
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, ReferenceLine } from 'recharts'
import { CARD_STYLE, SECTION_STYLE, SECTION_HEADER_STYLE, DESC_STYLE, LoadingBox, ErrorBox } from './marketUtils.jsx'
import useIsMobile from '../../hooks/useIsMobile'

export default function TreasurySection() {
  const isMobile = useIsMobile()
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

  if (loading) return <div style={SECTION_STYLE}><h3 style={SECTION_HEADER_STYLE}>미국 국채금리</h3><LoadingBox /></div>
  if (error || !data) return <div style={SECTION_STYLE}><h3 style={SECTION_HEADER_STYLE}>미국 국채금리</h3><ErrorBox /></div>

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

  return (
    <div style={SECTION_STYLE}>
      {isMobile ? (
        <button className="accordion-header" onClick={() => setOpen(o => !o)}>
          <span style={SECTION_HEADER_STYLE}>미국 국채금리</span>
          <span>{open ? '∧' : '∨'}</span>
        </button>
      ) : (
        <h3 style={SECTION_HEADER_STYLE}>미국 국채금리</h3>
      )}
      {(!isMobile || open) && (
        <>
      <p style={DESC_STYLE}>연준 통화정책 방향의 핵심 지표입니다. 단기(2년)는 금리 기대를, 장기(10년·30년)는 경기 및 인플레이션 전망을 반영합니다. 2년물이 10년물을 상회하는 장단기 역전은 역사적으로 경기 침체의 선행 신호입니다.</p>
      <div style={isMobile
        ? { display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 12, marginBottom: 20 }
        : { display: 'flex', gap: 12, marginBottom: 20, flexWrap: 'wrap' }}>
        {['3m', '5y', '10y', '30y'].map(key => {
          const r = rates[key]
          const up = r?.change_bp > 0
          const down = r?.change_bp < 0
          return (
            <div key={key} style={{ ...CARD_STYLE, ...(isMobile ? {} : { minWidth: 110, flex: 1 }) }}>
              <div style={{ fontSize: 11, color: 'var(--text-3)', marginBottom: 4 }}>{LABELS[key]}</div>
              <div style={{ fontSize: 22, fontWeight: 700, color: 'var(--text)' }}>
                {r ? `${r.current.toFixed(2)}%` : '-'}
              </div>
              {r && (
                <div style={{ fontSize: 12, color: up ? '#81c784' : down ? '#e57373' : 'var(--text-3)', marginTop: 2 }}>
                  {up ? '▲' : down ? '▼' : '─'} {Math.abs(r.change_bp).toFixed(1)}bp
                </div>
              )}
            </div>
          )
        })}
      </div>
      {chartData.length > 0 && (
        <div style={CARD_STYLE}>
          <div style={{ fontSize: 12, color: 'var(--text-3)', marginBottom: 8 }}>
            3개월 / 10년 금리 추이 (1년) + 스프레드(10Y-3M)
          </div>
          <ResponsiveContainer width="100%" height={220}>
            <LineChart data={chartData} margin={{ top: 4, right: 16, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
              <XAxis dataKey="date" tick={{ fontSize: 10, fill: 'var(--text-3)' }}
                     interval={Math.floor(chartData.length / 6)} />
              <YAxis tick={{ fontSize: 10, fill: 'var(--text-3)' }} domain={['auto', 'auto']} />
              <Tooltip contentStyle={{ background: 'var(--bg-elev)', border: '1px solid var(--border)', fontSize: 12 }}
                       labelStyle={{ color: 'var(--text-3)' }} />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <ReferenceLine y={0} stroke="var(--border)" />
              <Line type="monotone" dataKey="10년" stroke="#4fc3f7" dot={false} strokeWidth={1.5} />
              <Line type="monotone" dataKey="3개월" stroke="#81c784" dot={false} strokeWidth={1.5} />
              <Line type="monotone" dataKey="스프레드" stroke="#ffb74d" dot={false} strokeWidth={1} strokeDasharray="4 2" />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
        </>
      )}
    </div>
  )
}

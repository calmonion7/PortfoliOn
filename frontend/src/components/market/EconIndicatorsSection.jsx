import { useState, useEffect } from 'react'
import api from '../../api'
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts'
import { DESC_STYLE, SectionCard, SectionCardLoading, SectionCardError, EmptyNote } from './marketUtils.jsx'

export default function EconIndicatorsSection() {
  const [open, setOpen] = useState(false)
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    api.get('/api/market/econ-indicators')
      .then(r => setData(r.data))
      .catch(() => setError(true))
      .finally(() => setLoading(false))
  }, [])

  if (loading) return <SectionCardLoading title="경제지표 (미국)" />
  if (error || !data) return <SectionCardError title="경제지표 (미국)" />

  if (data.error) {
    return (
      <SectionCard title="경제지표 (미국)" summary="" open={open} onToggle={() => setOpen(o => !o)}>
        <EmptyNote msg={data.error} />
      </SectionCard>
    )
  }

  const charts = [
    { key: 'cpi', label: 'CPI (소비자물가지수)', color: 'var(--data-3)', unit: '' },
    { key: 'unemployment', label: '실업률', color: 'var(--data-2)', unit: '%' },
  ]

  const lastCpi = data.cpi?.slice(-1)[0]
  const prevCpi = data.cpi?.slice(-2, -1)[0]
  const cpiChange = (lastCpi && prevCpi) ? ((lastCpi.value - prevCpi.value) / prevCpi.value * 100) : null
  const summary = lastCpi ? `CPI ${lastCpi.value.toFixed(1)}` : ''

  const lastUnemp = data.unemployment?.slice(-1)[0]
  const prevUnemp = data.unemployment?.slice(-2, -1)[0]
  const unempChange = (lastUnemp && prevUnemp) ? (lastUnemp.value - prevUnemp.value) : null

  const indicators = [
    {
      label: 'CPI (소비자물가지수)', color: 'var(--data-3)',
      last: lastCpi, prev: prevCpi,
      valFmt: v => v.toFixed(1), unit: '',
      chg: cpiChange, chgUnit: '%', chgLabel: 'MoM%',
    },
    {
      label: '실업률', color: 'var(--data-2)',
      last: lastUnemp, prev: prevUnemp,
      valFmt: v => `${v.toFixed(1)}%`, unit: '%',
      chg: unempChange, chgUnit: '%p', chgLabel: 'MoM',
    },
  ]

  return (
    <SectionCard title="경제지표 (미국)" summary={summary} change={cpiChange} changeSuffix="%" open={open} onToggle={() => setOpen(o => !o)}>
      <p style={DESC_STYLE}>CPI는 소비자물가지수로 인플레이션 수준을 나타냅니다. 실업률은 노동시장 건강도를 측정합니다. 두 지표 모두 연준(Fed)의 금리 결정 핵심 근거로, 이중 책무(물가 안정·완전고용) 달성 여부를 판단합니다.</p>
      <div style={{ display: 'flex', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
        {indicators.map(({ label, color, last, prev, valFmt, chg, chgUnit, chgLabel }) => (
          <div key={label} className="metric-tile" style={{ flex: 1, minWidth: 140 }}>
            <div className="lbl">{label}</div>
            <div className="v" style={{ color }}>{last ? valFmt(last.value) : '-'}</div>
            {last && <div style={{ fontSize: 10, color: 'var(--text-3)', marginTop: 2 }}>{last.date?.slice(0, 7)}</div>}
            {chg != null && (
              <>
                <div className="d" style={{ color: chg > 0 ? 'var(--up)' : chg < 0 ? 'var(--down)' : 'var(--text-3)' }}>
                  {chg > 0 ? '▲' : chg < 0 ? '▼' : '─'} {Math.abs(chg).toFixed(2)}{chgUnit} <span style={{ color: 'var(--text-3)' }}>{chgLabel}</span>
                </div>
                {prev && <div style={{ fontSize: 10, color: 'var(--text-3)', marginTop: 1 }}>전월 {valFmt(prev.value)} ({prev.date?.slice(0, 7)})</div>}
              </>
            )}
          </div>
        ))}
      </div>
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        {charts.map(({ key, label, color, unit }) => {
          const h = data[key] || []
          return (
            <div key={key} className="chartbox" style={{ flex: 1, minWidth: 280 }}>
              <div className="sub">{label} (3년)</div>
              <ResponsiveContainer width="100%" height={180}>
                <LineChart data={h} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                  <XAxis dataKey="date" tick={{ fontSize: 9, fill: 'var(--text-3)' }}
                         tickFormatter={v => v.slice(0, 7)} interval={Math.floor(h.length / 5)} />
                  <YAxis tick={{ fontSize: 9, fill: 'var(--text-3)' }} domain={['auto', 'auto']}
                         tickFormatter={v => `${v}${unit}`} width={36} />
                  <Tooltip contentStyle={{ background: 'var(--bg-elev)', border: '1px solid var(--border)', fontSize: 11 }}
                           labelStyle={{ color: 'var(--text-3)' }}
                           formatter={v => [`${v}${unit}`, label]} />
                  <Line type="monotone" dataKey="value" name={label} stroke={color} dot={false} strokeWidth={1.5} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )
        })}
      </div>
    </SectionCard>
  )
}

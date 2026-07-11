import { useState, useEffect } from 'react'
import api from '../../api'
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine } from 'recharts'
import { DESC_STYLE, SectionCard, SectionCardLoading, SectionCardError } from './marketUtils.jsx'

export default function VixSection() {
  const [open, setOpen] = useState(false)
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    api.get('/api/market/vix')
      .then(r => setData(r.data))
      .catch(() => setError(true))
      .finally(() => setLoading(false))
  }, [])

  if (loading) return <SectionCardLoading title="변동성지수 (VIX)" />
  if (error || !data) return <SectionCardError title="변동성지수 (VIX)" />

  const vix = data.current
  const vixColor = vix >= 30 ? 'var(--color-error)' : vix >= 20 ? 'var(--warn)' : 'var(--color-success)'
  const vixLabel = vix >= 30 ? '공포' : vix >= 20 ? '주의' : '탐욕'
  const history = (data.history || []).slice(-252)

  const summary = vix != null ? `${vix.toFixed(1)} ${vixLabel}` : ''

  return (
    <SectionCard title="변동성지수 (VIX)" summary={summary} change={data.change ?? null} changeSuffix="" changeInverted open={open} onToggle={() => setOpen(o => !o)}>
      <p style={DESC_STYLE}>S&P 500 옵션 내재변동성을 기반으로 시장 심리를 수치화한 지수입니다. 20 이하는 안정, 20~30은 주의, 30 이상은 공포 구간으로 해석합니다. 급등 시 단기 과매도 신호로 활용되기도 합니다.</p>
      <div style={{ display: 'flex', gap: 12, marginBottom: 20 }}>
        <div className="metric-tile" style={{ minWidth: 140 }}>
          <div className="lbl">VIX 현재값</div>
          <div className="v" style={{ color: vixColor }}>{vix != null ? vix.toFixed(1) : '-'}</div>
          <div className="d" style={{ color: vixColor }}>{vixLabel}</div>
          {data.change != null && (
            <div className="d" style={{ color: data.change > 0 ? 'var(--down)' : 'var(--up)' }}>
              {data.change > 0 ? '▲' : '▼'} {Math.abs(data.change).toFixed(2)}
            </div>
          )}
        </div>
      </div>
      {history.length > 0 && (
        <div className="chartbox">
          <div className="sub">VIX 추이 (1년)</div>
          <ResponsiveContainer width="100%" height={180}>
            <LineChart data={history} margin={{ top: 4, right: 16, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
              <XAxis dataKey="date" tick={{ fontSize: 10, fill: 'var(--text-3)' }}
                     tickFormatter={v => v.slice(5)} interval={Math.floor(history.length / 6)} />
              <YAxis tick={{ fontSize: 10, fill: 'var(--text-3)' }} domain={['auto', 'auto']} width={36} />
              <Tooltip contentStyle={{ background: 'var(--bg-elev)', border: '1px solid var(--border)', fontSize: 12 }}
                       labelStyle={{ color: 'var(--text-3)' }} />
              <ReferenceLine y={30} stroke="var(--warn)" strokeDasharray="4 2" label={{ value: '30', fill: 'var(--warn)', fontSize: 10 }} />
              <Line type="monotone" dataKey="value" name="VIX" stroke="var(--data-3)" dot={false} strokeWidth={1.5} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
    </SectionCard>
  )
}

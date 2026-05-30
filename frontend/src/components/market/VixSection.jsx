import { useState, useEffect } from 'react'
import api from '../../api'
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine } from 'recharts'
import { CARD_STYLE, DESC_STYLE, SectionCard, SectionCardLoading, SectionCardError } from './marketUtils.jsx'

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

  if (loading) return <SectionCardLoading title="공포탐욕지수 (VIX)" />
  if (error || !data) return <SectionCardError title="공포탐욕지수 (VIX)" />

  const vix = data.current
  const vixColor = vix >= 30 ? '#e57373' : vix >= 20 ? '#ffb74d' : '#81c784'
  const vixLabel = vix >= 30 ? '공포' : vix >= 20 ? '주의' : '탐욕'
  const history = (data.history || []).slice(-252)

  const summary = vix != null ? `${vix.toFixed(1)} ${vixLabel}` : ''

  return (
    <SectionCard title="공포탐욕지수 (VIX)" summary={summary} change={data.change ?? null} changeSuffix="" changeInverted open={open} onToggle={() => setOpen(o => !o)}>
      <p style={DESC_STYLE}>S&P 500 옵션 내재변동성을 기반으로 시장 심리를 수치화한 지수입니다. 20 이하는 안정, 20~30은 주의, 30 이상은 공포 구간으로 해석합니다. 급등 시 단기 과매도 신호로 활용되기도 합니다.</p>
      <div style={{ display: 'flex', gap: 12, marginBottom: 20 }}>
        <div style={{ ...CARD_STYLE, minWidth: 140 }}>
          <div style={{ fontSize: 11, color: 'var(--text-3)', marginBottom: 4 }}>VIX 현재값</div>
          <div style={{ fontSize: 28, fontWeight: 700, color: vixColor }}>
            {vix != null ? vix.toFixed(1) : '-'}
          </div>
          <div style={{ fontSize: 12, color: vixColor, marginTop: 2 }}>{vixLabel}</div>
          {data.change != null && (
            <div style={{ fontSize: 12, color: data.change > 0 ? '#e57373' : '#81c784', marginTop: 4 }}>
              {data.change > 0 ? '▲' : '▼'} {Math.abs(data.change).toFixed(2)}
            </div>
          )}
        </div>
      </div>
      {history.length > 0 && (
        <div style={CARD_STYLE}>
          <div style={{ fontSize: 12, color: 'var(--text-3)', marginBottom: 8 }}>VIX 추이 (1년)</div>
          <ResponsiveContainer width="100%" height={180}>
            <LineChart data={history} margin={{ top: 4, right: 16, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
              <XAxis dataKey="date" tick={{ fontSize: 10, fill: 'var(--text-3)' }}
                     tickFormatter={v => v.slice(5)} interval={Math.floor(history.length / 6)} />
              <YAxis tick={{ fontSize: 10, fill: 'var(--text-3)' }} domain={['auto', 'auto']} />
              <Tooltip contentStyle={{ background: 'var(--bg-elev)', border: '1px solid var(--border)', fontSize: 12 }}
                       labelStyle={{ color: 'var(--text-3)' }} />
              <ReferenceLine y={30} stroke="#e57373" strokeDasharray="4 2" label={{ value: '30', fill: '#e57373', fontSize: 10 }} />
              <Line type="monotone" dataKey="value" name="VIX" stroke="#ffb74d" dot={false} strokeWidth={1.5} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
    </SectionCard>
  )
}

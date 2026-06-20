import { useState, useEffect } from 'react'
import api from '../../api'
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts'
import { CARD_STYLE, DESC_STYLE, SectionCard, SectionCardLoading, SectionCardError } from './marketUtils.jsx'

export default function CommoditiesSection() {
  const [open, setOpen] = useState(false)
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    api.get('/api/market/commodities')
      .then(r => setData(r.data))
      .catch(() => setError(true))
      .finally(() => setLoading(false))
  }, [])

  if (loading) return <SectionCardLoading title="원자재" />
  if (error || !data) return <SectionCardError title="원자재" />

  const LABELS = { gold: '금 (Gold)', oil: 'WTI 원유', copper: '구리 (Copper)' }
  const prices = data.prices || {}
  const history = data.history || {}

  const oil = prices.oil
  const summary = oil ? `WTI $${oil.current.toFixed(1)}` : ''

  return (
    <SectionCard title="원자재" summary={summary} change={oil?.change_pct ?? null} changeSuffix="%" open={open} onToggle={() => setOpen(o => !o)}>
      <p style={DESC_STYLE}>금은 안전자산 수요와 실질금리를 반영합니다. WTI 원유는 경기 및 물가의 선행지표입니다. 구리는 '닥터 코퍼'로 불리며 산업 수요를 통해 경기 방향성을 선행 진단합니다.</p>
      <div style={{ display: 'flex', gap: 12, marginBottom: 20, flexWrap: 'wrap' }}>
        {['gold', 'oil', 'copper'].map(key => {
          const p = prices[key]
          const up = p?.change_pct > 0
          const down = p?.change_pct < 0
          return (
            <div key={key} style={{ ...CARD_STYLE, minWidth: 120, flex: 1 }}>
              <div style={{ fontSize: 11, color: 'var(--text-3)', marginBottom: 4 }}>{LABELS[key]}</div>
              <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--text)' }}>
                {p ? `$${p.current.toLocaleString()}` : '-'}
              </div>
              <div style={{ fontSize: 10, color: 'var(--text-3)' }}>{p?.unit}</div>
              {p && (
                <div style={{ fontSize: 12, color: up ? 'var(--up)' : down ? 'var(--down)' : 'var(--text-3)', marginTop: 2 }}>
                  {up ? '▲' : down ? '▼' : '─'} {Math.abs(p.change_pct).toFixed(2)}%
                </div>
              )}
            </div>
          )
        })}
      </div>
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        {[
          { key: 'gold', label: '금', color: 'var(--data-3)' },
          { key: 'oil',  label: 'WTI', color: 'var(--data-2)' },
          { key: 'copper', label: '구리', color: 'var(--data-5)' },
        ].map(({ key, label, color }) => {
          const h = (history[key] || []).slice(-252)
          if (!h.length) return null
          return (
            <div key={key} style={{ ...CARD_STYLE, flex: 1, minWidth: 240 }}>
              <div style={{ fontSize: 12, color: 'var(--text-3)', marginBottom: 8 }}>{label} 추이 (1년)</div>
              <ResponsiveContainer width="100%" height={140}>
                <LineChart data={h} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                  <XAxis dataKey="date" tick={{ fontSize: 9, fill: 'var(--text-3)' }}
                         tickFormatter={v => v.slice(5)} interval={Math.floor(h.length / 4)} />
                  <YAxis tick={{ fontSize: 9, fill: 'var(--text-3)' }} domain={['auto', 'auto']} width={40} />
                  <Tooltip contentStyle={{ background: 'var(--bg-elev)', border: '1px solid var(--border)', fontSize: 11 }}
                           labelStyle={{ color: 'var(--text-3)' }} />
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

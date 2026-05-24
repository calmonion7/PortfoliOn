import { useState, useEffect } from 'react'
import api from '../../api'
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts'
import { CARD_STYLE, SECTION_STYLE, SECTION_HEADER_STYLE, DESC_STYLE, LoadingBox, ErrorBox } from './marketUtils.jsx'

export default function CommoditiesSection() {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    api.get('/api/market/commodities')
      .then(r => setData(r.data))
      .catch(() => setError(true))
      .finally(() => setLoading(false))
  }, [])

  if (loading) return <div style={SECTION_STYLE}><h3 style={SECTION_HEADER_STYLE}>원자재</h3><LoadingBox /></div>
  if (error || !data) return <div style={SECTION_STYLE}><h3 style={SECTION_HEADER_STYLE}>원자재</h3><ErrorBox /></div>

  const LABELS = { gold: '금 (Gold)', oil: 'WTI 원유', copper: '구리 (Copper)' }
  const prices = data.prices || {}
  const history = data.history || {}

  return (
    <div style={SECTION_STYLE}>
      <h3 style={SECTION_HEADER_STYLE}>원자재</h3>
      <p style={DESC_STYLE}>금은 안전자산 수요와 실질금리를 반영합니다. WTI 원유는 경기 및 물가의 선행지표입니다. 구리는 '닥터 코퍼'로 불리며 산업 수요를 통해 경기 방향성을 선행 진단합니다.</p>
      <div style={{ display: 'flex', gap: 12, marginBottom: 20, flexWrap: 'wrap' }}>
        {['gold', 'oil', 'copper'].map(key => {
          const p = prices[key]
          const up = p?.change_pct > 0
          const down = p?.change_pct < 0
          return (
            <div key={key} style={{ ...CARD_STYLE, minWidth: 120, flex: 1 }}>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 4 }}>{LABELS[key]}</div>
              <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--text)' }}>
                {p ? `$${p.current.toLocaleString()}` : '-'}
              </div>
              <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>{p?.unit}</div>
              {p && (
                <div style={{ fontSize: 12, color: up ? '#81c784' : down ? '#e57373' : 'var(--text-muted)', marginTop: 2 }}>
                  {up ? '▲' : down ? '▼' : '─'} {Math.abs(p.change_pct).toFixed(2)}%
                </div>
              )}
            </div>
          )
        })}
      </div>
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        {[
          { key: 'gold', label: '금', color: '#ffd54f' },
          { key: 'oil',  label: 'WTI', color: '#4fc3f7' },
          { key: 'copper', label: '구리', color: '#ff8a65' },
        ].map(({ key, label, color }) => {
          const h = (history[key] || []).slice(-252)
          if (!h.length) return null
          return (
            <div key={key} style={{ ...CARD_STYLE, flex: 1, minWidth: 240 }}>
              <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 8 }}>{label} 추이 (1년)</div>
              <ResponsiveContainer width="100%" height={140}>
                <LineChart data={h} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                  <XAxis dataKey="date" tick={{ fontSize: 9, fill: 'var(--text-muted)' }}
                         tickFormatter={v => v.slice(5)} interval={Math.floor(h.length / 4)} />
                  <YAxis tick={{ fontSize: 9, fill: 'var(--text-muted)' }} domain={['auto', 'auto']} />
                  <Tooltip contentStyle={{ background: 'var(--bg-card)', border: '1px solid var(--border)', fontSize: 11 }}
                           labelStyle={{ color: 'var(--text-muted)' }} />
                  <Line type="monotone" dataKey="value" name={label} stroke={color} dot={false} strokeWidth={1.5} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )
        })}
      </div>
    </div>
  )
}

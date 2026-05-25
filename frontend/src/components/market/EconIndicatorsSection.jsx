import { useState, useEffect } from 'react'
import api from '../../api'
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts'
import { CARD_STYLE, SECTION_STYLE, SECTION_HEADER_STYLE, DESC_STYLE, LoadingBox, ErrorBox } from './marketUtils.jsx'
import useIsMobile from '../../hooks/useIsMobile'

export default function EconIndicatorsSection() {
  const isMobile = useIsMobile()
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

  if (loading) return <div style={SECTION_STYLE}><h3 style={SECTION_HEADER_STYLE}>경제지표 (미국)</h3><LoadingBox /></div>
  if (error || !data) return <div style={SECTION_STYLE}><h3 style={SECTION_HEADER_STYLE}>경제지표 (미국)</h3><ErrorBox /></div>

  if (data.error) {
    return (
      <div style={SECTION_STYLE}>
        <h3 style={SECTION_HEADER_STYLE}>경제지표 (미국)</h3>
        <div style={{ ...CARD_STYLE, fontSize: 13, color: 'var(--text-muted)' }}>
          <p>{data.error}</p>
        </div>
      </div>
    )
  }

  const charts = [
    { key: 'cpi', label: 'CPI (소비자물가지수)', color: '#ce93d8', unit: '' },
    { key: 'unemployment', label: '실업률', color: '#80cbc4', unit: '%' },
  ]

  return (
    <div style={SECTION_STYLE}>
      {isMobile ? (
        <button className="accordion-header" onClick={() => setOpen(o => !o)}>
          <span style={SECTION_HEADER_STYLE}>경제지표 (미국)</span>
          <span>{open ? '▲' : '▼'}</span>
        </button>
      ) : (
        <h3 style={SECTION_HEADER_STYLE}>경제지표 (미국)</h3>
      )}
      {(!isMobile || open) && (
        <>
          <p style={DESC_STYLE}>CPI는 소비자물가지수로 인플레이션 수준을 나타냅니다. 실업률은 노동시장 건강도를 측정합니다. 두 지표 모두 연준(Fed)의 금리 결정 핵심 근거로, 이중 책무(물가 안정·완전고용) 달성 여부를 판단합니다.</p>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            {charts.map(({ key, label, color, unit }) => {
              const h = data[key] || []
              return (
                <div key={key} style={{ ...CARD_STYLE, flex: 1, minWidth: 280 }}>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 8 }}>{label} (3년)</div>
                  <ResponsiveContainer width="100%" height={180}>
                    <LineChart data={h} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                      <XAxis dataKey="date" tick={{ fontSize: 9, fill: 'var(--text-muted)' }}
                             tickFormatter={v => v.slice(0, 7)} interval={Math.floor(h.length / 5)} />
                      <YAxis tick={{ fontSize: 9, fill: 'var(--text-muted)' }} domain={['auto', 'auto']}
                             tickFormatter={v => `${v}${unit}`} />
                      <Tooltip contentStyle={{ background: 'var(--bg-card)', border: '1px solid var(--border)', fontSize: 11 }}
                               labelStyle={{ color: 'var(--text-muted)' }}
                               formatter={v => [`${v}${unit}`, label]} />
                      <Line type="monotone" dataKey="value" name={label} stroke={color} dot={false} strokeWidth={1.5} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              )
            })}
          </div>
        </>
      )}
    </div>
  )
}

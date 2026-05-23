import { useState, useEffect } from 'react'
import axios from 'axios'
import {
  PieChart, Pie, Cell, Tooltip, ResponsiveContainer,
} from 'recharts'

const SECTOR_COLORS = [
  '#4fc3f7', '#81c784', '#ffb74d', '#f06292',
  '#ce93d8', '#80cbc4', '#fff176', '#a5d6a7',
  '#ef9a9a', '#90caf9',
]

function SectorAllocation({ cards }) {
  const total = cards.reduce((s, c) => s + (c.quantity ?? 0) * (c.current_price ?? 0), 0)

  const sectorMap = {}
  for (const c of cards) {
    const val = (c.quantity ?? 0) * (c.current_price ?? 0)
    if (!val) continue
    const key = c.sector || '기타'
    sectorMap[key] = (sectorMap[key] ?? 0) + val
  }

  const data = Object.entries(sectorMap)
    .sort((a, b) => b[1] - a[1])
    .map(([name, value]) => ({
      name,
      value,
      pct: total ? (value / total * 100).toFixed(1) : '0.0',
    }))

  const fmt = (v) =>
    v >= 1e9 ? `$${(v / 1e9).toFixed(1)}B`
    : v >= 1e6 ? `$${(v / 1e6).toFixed(1)}M`
    : `$${v.toFixed(0)}`

  return (
    <div style={{ marginBottom: 48 }}>
      <h3 style={{ color: 'var(--text)', marginBottom: 16 }}>섹터 배분</h3>
      <div style={{ display: 'flex', gap: 32, alignItems: 'center', flexWrap: 'wrap' }}>
        <ResponsiveContainer width={260} height={260}>
          <PieChart>
            <Pie data={data} dataKey="value" innerRadius={70} outerRadius={110} paddingAngle={2}>
              {data.map((_, i) => (
                <Cell key={i} fill={SECTOR_COLORS[i % SECTOR_COLORS.length]} />
              ))}
            </Pie>
            <Tooltip
              formatter={(v, n, p) => [`${p.payload.pct}%`, n]}
              contentStyle={{ background: 'var(--bg-card)', border: '1px solid var(--border)', fontSize: 12 }}
            />
          </PieChart>
        </ResponsiveContainer>
        <table style={{ borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr>
              <th style={{ textAlign: 'left', paddingRight: 16, color: 'var(--text-muted)', fontWeight: 400 }}>섹터</th>
              <th style={{ textAlign: 'right', paddingRight: 12, color: 'var(--text-muted)', fontWeight: 400 }}>비중</th>
              <th style={{ textAlign: 'right', color: 'var(--text-muted)', fontWeight: 400 }}>시가</th>
            </tr>
          </thead>
          <tbody>
            {data.map((d, i) => (
              <tr key={d.name}>
                <td style={{ paddingRight: 16, paddingTop: 4, color: 'var(--text)' }}>
                  <span style={{
                    width: 10, height: 10, borderRadius: 2,
                    background: SECTOR_COLORS[i % SECTOR_COLORS.length],
                    display: 'inline-block', marginRight: 6, verticalAlign: 'middle',
                  }} />
                  {d.name}
                </td>
                <td style={{ textAlign: 'right', paddingRight: 12, paddingTop: 4, color: 'var(--text)' }}>
                  {d.pct}%
                </td>
                <td style={{ textAlign: 'right', paddingTop: 4, color: 'var(--text-muted)' }}>
                  {fmt(d.value)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function OpportunityBubble() {
  return null
}

export default function Analytics() {
  const [cards, setCards] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    axios.get('/api/dashboard')
      .then(r => { setCards(r.data); setLoading(false) })
      .catch(e => { setError(e.message); setLoading(false) })
  }, [])

  if (loading) return <div style={{ color: 'var(--text-muted)' }}>불러오는 중...</div>
  if (error) return <div style={{ color: '#ef9a9a' }}>오류: {error}</div>
  if (!cards.length) return <div style={{ color: 'var(--text-muted)' }}>보유종목 없음</div>

  return (
    <div>
      <h2 style={{ color: 'var(--text)', marginBottom: 32 }}>포트폴리오 분석</h2>
      <SectorAllocation cards={cards} />
      <OpportunityBubble cards={cards} />
    </div>
  )
}

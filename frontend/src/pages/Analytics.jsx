import { useState, useEffect } from 'react'
import axios from 'axios'
import {
  PieChart, Pie, Cell, Tooltip, ResponsiveContainer,
  ScatterChart, Scatter, XAxis, YAxis, CartesianGrid, ReferenceLine, Label,
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

const CustomDot = (props) => {
  const { cx, cy, payload } = props
  const r = Math.max(6, Math.sqrt(payload.weight) * 4)
  return (
    <g>
      <circle cx={cx} cy={cy} r={r} fill={payload.fill} fillOpacity={0.75} stroke={payload.fill} />
      <text x={cx} y={cy - r - 4} textAnchor="middle" fontSize={10} fill="var(--text)">
        {payload.ticker}
      </text>
    </g>
  )
}

function OpportunityBubble({ cards }) {
  const totalVal = cards.reduce((s, c) => s + (c.quantity ?? 0) * (c.current_price ?? 0), 0)

  const included = []
  const excluded = []

  for (const c of cards) {
    const price = c.current_price
    const avgCost = c.avg_cost
    const target = c.target_mean
    if (!price || !avgCost || !target) {
      excluded.push(c.ticker)
      continue
    }
    const upside = parseFloat(((target - price) / price * 100).toFixed(1))
    const returnPct = parseFloat(((price - avgCost) / avgCost * 100).toFixed(1))
    const weight = totalVal ? c.quantity * price / totalVal * 100 : 1
    included.push({
      ticker: c.ticker,
      upside,
      returnPct,
      weight,
      fill: upside > 0 ? '#81c784' : '#ef9a9a',
    })
  }

  return (
    <div>
      <h3 style={{ color: 'var(--text)', marginBottom: 8 }}>기회 버블 차트</h3>
      <p style={{ color: 'var(--text-muted)', fontSize: 12, marginBottom: 16 }}>
        X: 컨센서스 업사이드% &nbsp;·&nbsp; Y: 평단가 대비 수익률% &nbsp;·&nbsp; 버블 크기: 포트폴리오 비중
      </p>
      <ResponsiveContainer width="100%" height={420}>
        <ScatterChart margin={{ top: 24, right: 32, bottom: 32, left: 24 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
          <XAxis type="number" dataKey="upside" name="업사이드" unit="%" stroke="var(--text-muted)" tick={{ fontSize: 11 }}>
            <Label value="업사이드 %" position="insideBottom" offset={-16} fill="var(--text-muted)" fontSize={11} />
          </XAxis>
          <YAxis type="number" dataKey="returnPct" name="수익률" unit="%" stroke="var(--text-muted)" tick={{ fontSize: 11 }}>
            <Label value="수익률 %" angle={-90} position="insideLeft" offset={10} fill="var(--text-muted)" fontSize={11} />
          </YAxis>
          <ReferenceLine x={0} stroke="var(--text-muted)" strokeDasharray="4 2" />
          <ReferenceLine y={0} stroke="var(--text-muted)" strokeDasharray="4 2" />
          <Tooltip
            cursor={{ strokeDasharray: '3 3' }}
            content={({ payload }) => {
              if (!payload?.length) return null
              const d = payload[0].payload
              return (
                <div style={{
                  background: 'var(--bg-card)', border: '1px solid var(--border)',
                  padding: '8px 12px', borderRadius: 6, fontSize: 12,
                }}>
                  <div style={{ fontWeight: 600, color: 'var(--text)', marginBottom: 4 }}>{d.ticker}</div>
                  <div style={{ color: 'var(--text-muted)' }}>
                    업사이드: <span style={{ color: 'var(--text)' }}>{d.upside}%</span>
                  </div>
                  <div style={{ color: 'var(--text-muted)' }}>
                    수익률: <span style={{ color: 'var(--text)' }}>{d.returnPct}%</span>
                  </div>
                  <div style={{ color: 'var(--text-muted)' }}>
                    비중: <span style={{ color: 'var(--text)' }}>{d.weight.toFixed(1)}%</span>
                  </div>
                </div>
              )
            }}
          />
          <Scatter data={included} shape={<CustomDot />} />
        </ScatterChart>
      </ResponsiveContainer>
      {excluded.length > 0 && (
        <p style={{ color: 'var(--text-muted)', fontSize: 11, marginTop: 8 }}>
          컨센서스 목표가 없어 제외: {excluded.join(', ')}
        </p>
      )}
    </div>
  )
}

function corrColor(v) {
  const neutral = [69, 90, 100]
  const pos = [79, 195, 247]
  const neg = [239, 154, 154]
  const t = Math.abs(v)
  const to = v >= 0 ? pos : neg
  return `rgb(${Math.round(neutral[0] + t * (to[0] - neutral[0]))},${Math.round(neutral[1] + t * (to[1] - neutral[1]))},${Math.round(neutral[2] + t * (to[2] - neutral[2]))})`
}

function CorrelationHeatmap() {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    axios.get('/api/analytics/correlation')
      .then(r => { setData(r.data); setLoading(false) })
      .catch(e => { setError(e.message); setLoading(false) })
  }, [])

  if (loading) return <div style={{ color: 'var(--text-muted)', marginTop: 48 }}>상관관계 계산 중...</div>
  if (error) return <div style={{ color: '#ef9a9a', marginTop: 48 }}>오류: {error}</div>
  if (!data || !data.tickers.length) return (
    <div style={{ color: 'var(--text-muted)', marginTop: 48 }}>보유종목 2개 이상 필요</div>
  )

  const { tickers, matrix } = data
  const n = tickers.length
  const CELL = 48
  const LABEL = 64

  return (
    <div style={{ marginTop: 48 }}>
      <h3 style={{ color: 'var(--text)', marginBottom: 8 }}>상관관계 히트맵</h3>
      <p style={{ color: 'var(--text-muted)', fontSize: 12, marginBottom: 16 }}>
        90일 종가 기준 Pearson 상관계수 · 1.0=완전 양의 상관 · -1.0=완전 음의 상관
      </p>
      <svg width={LABEL + n * CELL} height={LABEL + n * CELL}>
        {tickers.map((t, j) => (
          <text key={`col-${j}`} x={LABEL + j * CELL + CELL / 2} y={LABEL - 8}
            textAnchor="middle" fontSize={11} fill="var(--text-muted)">{t}</text>
        ))}
        {tickers.map((t, i) => (
          <text key={`row-${i}`} x={LABEL - 8} y={LABEL + i * CELL + CELL / 2 + 4}
            textAnchor="end" fontSize={11} fill="var(--text-muted)">{t}</text>
        ))}
        {matrix.map((row, i) => row.map((v, j) => (
          <g key={`${i}-${j}`}>
            <rect x={LABEL + j * CELL} y={LABEL + i * CELL}
              width={CELL} height={CELL} fill={corrColor(v)} rx={2} />
            <text x={LABEL + j * CELL + CELL / 2} y={LABEL + i * CELL + CELL / 2 + 4}
              textAnchor="middle" fontSize={10} fill="white">{v.toFixed(2)}</text>
          </g>
        )))}
      </svg>
    </div>
  )
}

export default function Analytics() {
  const [cards, setCards] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    axios.get('/api/stocks/dashboard')
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
      <CorrelationHeatmap />
    </div>
  )
}

import { useState, useEffect } from 'react'
import api from '../api'
import LoadingSpinner from '../components/LoadingSpinner'
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
      <h3 style={{ color: 'var(--text)', marginBottom: 8 }}>섹터 배분</h3>
      <p style={{ color: 'var(--text-3)', fontSize: 11, marginBottom: 16, lineHeight: 1.7 }}>
        보유 종목의 현재가 기준 섹터별 자산 비중. 특정 섹터에 집중되어 있는지 분산 현황을 확인합니다.
      </p>
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
              contentStyle={{ background: 'var(--bg-elev)', border: '1px solid var(--border)', fontSize: 12 }}
            />
          </PieChart>
        </ResponsiveContainer>
        <table style={{ borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr>
              <th style={{ textAlign: 'left', paddingRight: 16, color: 'var(--text-3)', fontWeight: 400 }}>섹터</th>
              <th style={{ textAlign: 'right', paddingRight: 12, color: 'var(--text-3)', fontWeight: 400 }}>비중</th>
              <th style={{ textAlign: 'right', color: 'var(--text-3)', fontWeight: 400 }}>시가</th>
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
                <td style={{ textAlign: 'right', paddingTop: 4, color: 'var(--text-3)' }}>
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

const KRW_TO_USD = 1380
const toUSD = (price, market) => market === 'KR' ? price / KRW_TO_USD : price

function OpportunityBubble({ cards }) {
  const totalVal = cards.reduce(
    (s, c) => s + (c.quantity ?? 0) * toUSD(c.current_price ?? 0, c.market),
    0,
  )

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
    const weight = totalVal ? c.quantity * toUSD(price, c.market) / totalVal * 100 : 1
    included.push({
      ticker: c.ticker,
      market: c.market || 'US',
      upside,
      returnPct,
      weight,
      fill: upside > 0 ? '#81c784' : '#ef9a9a',
    })
  }

  return (
    <div>
      <h3 style={{ color: 'var(--text)', marginBottom: 8 }}>기회 버블 차트</h3>
      <p style={{ color: 'var(--text-3)', fontSize: 12, marginBottom: 4 }}>
        X: 컨센서스 업사이드% &nbsp;·&nbsp; Y: 평단가 대비 수익률% &nbsp;·&nbsp; 버블 크기: 포트폴리오 비중
      </p>
      <p style={{ color: 'var(--text-3)', fontSize: 11, marginBottom: 16, lineHeight: 1.7 }}>
        우상단(업사이드↑, 수익률↑): 목표가 여력이 있고 수익 중인 종목 &nbsp;·&nbsp;
        좌하단: 하락 중이면서 목표가 하회 — 점검 필요<br />
        버블이 클수록 포트폴리오에서 차지하는 비중이 높습니다. 컨센서스 목표가가 없는 종목은 제외됩니다.
      </p>
      <ResponsiveContainer width="100%" height={420}>
        <ScatterChart margin={{ top: 24, right: 32, bottom: 32, left: 24 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
          <XAxis type="number" dataKey="upside" name="업사이드" unit="%" stroke="var(--text-3)" tick={{ fontSize: 11 }}>
            <Label value="업사이드 %" position="insideBottom" offset={-16} fill="var(--text-3)" fontSize={11} />
          </XAxis>
          <YAxis type="number" dataKey="returnPct" name="수익률" unit="%" stroke="var(--text-3)" tick={{ fontSize: 11 }}>
            <Label value="수익률 %" angle={-90} position="insideLeft" offset={10} fill="var(--text-3)" fontSize={11} />
          </YAxis>
          <ReferenceLine x={0} stroke="var(--text-3)" strokeDasharray="4 2" />
          <ReferenceLine y={0} stroke="var(--text-3)" strokeDasharray="4 2" />
          <Tooltip
            cursor={{ strokeDasharray: '3 3' }}
            content={({ payload }) => {
              if (!payload?.length) return null
              const d = payload[0].payload
              return (
                <div style={{
                  background: 'var(--bg-elev)', border: '1px solid var(--border)',
                  padding: '8px 12px', borderRadius: 6, fontSize: 12,
                }}>
                  <div style={{ fontWeight: 600, color: 'var(--text)', marginBottom: 4 }}>
                    {d.ticker} <span style={{ fontSize: 10, color: 'var(--text-3)', fontWeight: 400 }}>{d.market === 'KR' ? '🇰🇷 KRW' : '🇺🇸 USD'}</span>
                  </div>
                  <div style={{ color: 'var(--text-3)' }}>
                    업사이드: <span style={{ color: 'var(--text)' }}>{d.upside}%</span>
                  </div>
                  <div style={{ color: 'var(--text-3)' }}>
                    수익률: <span style={{ color: 'var(--text)' }}>{d.returnPct}%</span>
                  </div>
                  <div style={{ color: 'var(--text-3)' }}>
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
        <p style={{ color: 'var(--text-3)', fontSize: 11, marginTop: 8 }}>
          컨센서스 목표가 없어 제외: {excluded.join(', ')}
        </p>
      )}
    </div>
  )
}

function corrColor(v) {
  if (v === null || v === undefined) return 'var(--bg-elev-2)'
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
    api.get('/api/analytics/correlation')
      .then(r => { setData(r.data); setLoading(false) })
      .catch(e => { setError(e.message); setLoading(false) })
  }, [])

  if (loading) return <LoadingSpinner label="상관관계 불러오는 중입니다." style={{ marginTop: 48 }} />
  if (error) return <div style={{ color: '#ef9a9a', marginTop: 48 }}>오류: {error}</div>
  if (!data || !data.tickers.length) return (
    <div style={{ color: 'var(--text-3)', marginTop: 48 }}>보유종목 2개 이상 필요</div>
  )

  const { tickers, matrix } = data
  const n = tickers.length
  const CELL = 48
  const LABEL = 64

  return (
    <div style={{ marginTop: 48 }}>
      <h3 style={{ color: 'var(--text)', marginBottom: 8 }}>상관관계 히트맵</h3>
      <p style={{ color: 'var(--text-3)', fontSize: 12, marginBottom: 4 }}>
        90일 종가 기준 Pearson 상관계수 &nbsp;·&nbsp; 1.0=완전 양의 상관 &nbsp;·&nbsp; -1.0=완전 음의 상관
      </p>
      <p style={{ color: 'var(--text-3)', fontSize: 11, marginBottom: 16, lineHeight: 1.7 }}>
        값이 1에 가까울수록 두 종목이 같은 방향으로 움직임. 파란색 계열이 많으면 분산 효과가 낮아<br />
        시장 충격 시 포트폴리오 전체가 동반 하락할 위험이 있습니다. 보유종목 2개 이상 필요.
      </p>
      <svg width={LABEL + n * CELL} height={LABEL + n * CELL}>
        {tickers.map((t, j) => (
          <text key={`col-${j}`} x={LABEL + j * CELL + CELL / 2} y={LABEL - 8}
            textAnchor="middle" fontSize={11} fill="var(--text-3)">{t}</text>
        ))}
        {tickers.map((t, i) => (
          <text key={`row-${i}`} x={LABEL - 8} y={LABEL + i * CELL + CELL / 2 + 4}
            textAnchor="end" fontSize={11} fill="var(--text-3)">{t}</text>
        ))}
        {matrix.map((row, i) => row.map((v, j) => (
          <g key={`${i}-${j}`}>
            <rect x={LABEL + j * CELL} y={LABEL + i * CELL}
              width={CELL} height={CELL} fill={corrColor(v)} rx={2} />
            <text x={LABEL + j * CELL + CELL / 2} y={LABEL + i * CELL + CELL / 2 + 4}
              textAnchor="middle" fontSize={10} fill="white">{v !== null ? v.toFixed(2) : '—'}</text>
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
    api.get('/api/stocks/dashboard')
      .then(r => { setCards(r.data); setLoading(false) })
      .catch(e => { setError(e.message); setLoading(false) })
  }, [])

  if (loading) return <LoadingSpinner label="분석 데이터 불러오는 중입니다." />
  if (error) return <div style={{ color: '#ef9a9a' }}>오류: {error}</div>
  if (!cards.length) return <div style={{ color: 'var(--text-3)' }}>보유종목 없음</div>

  return (
    <div>
      <h2 style={{ color: 'var(--text)', marginBottom: 32 }}>포트폴리오 분석</h2>
      <SectorAllocation cards={cards} />
      <OpportunityBubble cards={cards} />
      <CorrelationHeatmap />
    </div>
  )
}

import { useState, useEffect } from 'react'
import api from '../../api'
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts'
import { DESC_STYLE, SectionCard, SectionCardLoading, SectionCardError, EmptyNote } from './marketUtils.jsx'
import { GlossaryText } from '../Glossary.jsx'

// 4계열 모두 같은 단위(YoY %)라 축이 하나다 — 고용 조사 격차(형제, task#294)의 이중축은 두 조사의
// 절대 수준이 달라 필요했던 것이고 여긴 해당 없음(CONVENTIONS §9.6 dual-axis는 여기 적용 안 됨).
const SERIES = [
  { key: 'core_pce', label: '코어 PCE', color: 'var(--data-3)' },
  { key: 'dallas_trimmed', label: 'Dallas Fed 절사평균', color: 'var(--data-1)' },
  { key: 'cleveland_trimmed', label: 'Cleveland Fed 16% 절사평균', color: 'var(--data-2)' },
  { key: 'headline_pce', label: '헤드라인 PCE', color: 'var(--data-5)' },
]

export const fmtPct2 = v => v == null ? '-' : `${v.toFixed(2)}%`

// 계열마다 관측일이 어긋날 수 있어 날짜로 합친다 — 한 계열의 결손이 다른 계열을 지우지 않는다.
function mergeHistories(series) {
  const byDate = new Map()
  for (const { key, history } of series) {
    for (const p of history) {
      const row = byDate.get(p.date) || { date: p.date }
      row[key] = p.value
      byDate.set(p.date, row)
    }
  }
  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date))
}

export default function TrimmedInflationSection() {
  const [open, setOpen] = useState(false)
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    api.get('/api/market/trimmed-inflation')
      .then(r => setData(r.data))
      .catch(() => setError(true))
      .finally(() => setLoading(false))
  }, [])

  if (loading) return <SectionCardLoading title="절사평균 물가 (미국)" />
  if (error || !data) return <SectionCardError title="절사평균 물가 (미국)" />

  if (data.error) {
    return (
      <SectionCard title="절사평균 물가 (미국)" summary="" open={open} onToggle={() => setOpen(o => !o)}>
        <EmptyNote msg={data.error} />
      </SectionCard>
    )
  }

  const core = data.core_pce || {}
  const summary = core.latest != null ? `코어 ${fmtPct2(core.latest)}` : ''

  const chartData = mergeHistories(SERIES.map(s => ({ key: s.key, history: data[s.key]?.history || [] })))

  return (
    <SectionCard title="절사평균 물가 (미국)" summary={summary} open={open} onToggle={() => setOpen(o => !o)}>
      <p style={DESC_STYLE}>
        코어는 식품·에너지라는 정해진 항목을 <b>항상</b> 빼는 물가이고, 절사평균은 그 달에 가장 크게
        오르거나 내린 품목을 <b>그때그때</b> 잘라낸 뒤 평균한 물가입니다 — 어느 품목이 잘릴지는 매달
        달라집니다. 코어만 오르고 절사평균은 안 오르면 소수 품목 탓일 가능성이 큽니다.
      </p>

      <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', marginBottom: 12 }}>
        {SERIES.map(({ key, label, color }) => {
          const s = data[key] || {}
          return (
            <span key={key} className="chart-legend__item" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
              <span aria-hidden="true" style={{ width: 8, height: 8, borderRadius: '50%', background: color, flexShrink: 0 }} />
              <span style={{ color: 'var(--text-2)' }}><GlossaryText text={label} /></span>
              <span style={{ color, fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{fmtPct2(s.latest)}</span>
            </span>
          )
        })}
      </div>

      <div className="chartbox">
        <div className="sub">전년동월비(YoY) %, 단일 축</div>
        <ResponsiveContainer width="100%" height={240}>
          <LineChart data={chartData} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
            <XAxis dataKey="date" tick={{ fontSize: 9, fill: 'var(--text-3)' }}
                   tickFormatter={v => v.slice(0, 7)} interval={Math.floor(chartData.length / 6)} />
            <YAxis tick={{ fontSize: 9, fill: 'var(--text-3)' }} domain={['auto', 'auto']} width={40} unit="%" />
            <Tooltip contentStyle={{ background: 'var(--bg-elev)', border: '1px solid var(--border)', fontSize: 11 }}
                     labelStyle={{ color: 'var(--text-3)' }}
                     formatter={(v, name) => [v == null ? '-' : `${v}%`, name]} />
            {SERIES.map(({ key, label, color }) => (
              <Line key={key} type="monotone" dataKey={key} name={label} stroke={color} dot={false} strokeWidth={1.5} connectNulls />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </SectionCard>
  )
}

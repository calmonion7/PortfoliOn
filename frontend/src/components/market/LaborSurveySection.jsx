import { useState, useEffect } from 'react'
import api from '../../api'
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts'
import { DESC_STYLE, SectionCard, SectionCardLoading, SectionCardError, EmptyNote } from './marketUtils.jsx'
import { GlossaryText } from '../Glossary.jsx'

// 입력은 FRED 관례상 '천 명'(Thousands of Persons)이다 — marketUtils.jsx의 krFmt는
// '억원' 입력 가정이라 재사용하면 1e8배 오표기가 난다(CLAUDE.md gotcha, "35조경원" 전례).
// 그래서 전용 순수함수로 뺀다: 최신값은 억 명(/1e5), 증감은 만 명(/10)으로 축약.
export const fmtEokMyeong = v => v == null ? '-' : `${(v / 1e5).toFixed(2)}억 명`
export const fmtManMyeongDelta = v => v == null ? '-' : `${(v / 10).toFixed(1)}만 명`

// household=가계조사(좌축, --data-4) · establishment=기업조사(우축, --data-1) — CONTEXT.md
// "고용 조사 격차" 정본에 명시된 색·축 배정 그대로.
const SURVEYS = [
  { key: 'household', label: '가계조사 (CE16OV)', color: 'var(--data-4)', axis: 'left' },
  { key: 'establishment', label: '기업조사 (PAYEMS)', color: 'var(--data-1)', axis: 'right' },
]

// 두 조사의 관측일이 어긋날 수 있어 인덱스가 아니라 날짜로 합친다(누락은 그 계열만 빈칸).
function mergeHistories(surveys) {
  const byDate = new Map()
  for (const { key, history } of surveys) {
    for (const p of history) {
      const row = byDate.get(p.date) || { date: p.date }
      row[key] = p.value
      byDate.set(p.date, row)
    }
  }
  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date))
}

export default function LaborSurveySection() {
  const [open, setOpen] = useState(false)
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    api.get('/api/market/labor-surveys')
      .then(r => setData(r.data))
      .catch(() => setError(true))
      .finally(() => setLoading(false))
  }, [])

  if (loading) return <SectionCardLoading title="고용 조사 격차 (미국)" />
  if (error || !data) return <SectionCardError title="고용 조사 격차 (미국)" />

  if (data.error) {
    return (
      <SectionCard title="고용 조사 격차 (미국)" summary="" open={open} onToggle={() => setOpen(o => !o)}>
        <EmptyNote msg={data.error} />
      </SectionCard>
    )
  }

  const household = data.household || {}
  const establishment = data.establishment || {}
  const summary = household.latest != null && establishment.latest != null
    ? `가계 ${fmtEokMyeong(household.latest)} · 기업 ${fmtEokMyeong(establishment.latest)}`
    : ''

  // 이중축 오버레이 — 좌(가계조사)·우(기업조사)는 각자 domain=['auto','auto']로 독립
  // 스케일된다. 두 선이 지나치는 지점은 "두 조사가 같아졌다"는 뜻이 아니라 축이 서로
  // 다른 손맞춤 스케일이라 생기는 시각적 우연이다(비목표 — 절대 수준 차는 표시 안 함).
  // 판정 근거는 화면의 12개월 증감 타일이고, 이 차트는 발산의 형태만 보여준다.
  const chartData = mergeHistories(SURVEYS.map(s => ({ key: s.key, history: data[s.key]?.history || [] })))

  return (
    <SectionCard title="고용 조사 격차 (미국)" summary={summary} open={open} onToggle={() => setOpen(o => !o)}>
      <p style={DESC_STYLE}>
        기업조사(PAYEMS, 사업체 급여명부)와 가계조사(CE16OV, 가구 응답 취업자)는 서로 다른 방법론으로 고용 규모를
        재기 때문에 수준 차이가 상시 존재합니다 — 그 차이 자체는 신호가 아닙니다. 아래 차트는 좌·우 축이 서로 다른 범위로
        독립 스케일되어 있어(각 축 자동 범위), 두 선이 겹치거나 지나치는 지점은 두 조사가 같아졌다는 의미가
        아닙니다. 의미가 있는 것은 12개월 증감의 부호가 갈리는 <b>추이의 발산</b>입니다.
      </p>

      <div style={{ display: 'flex', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
        {SURVEYS.map(({ key, label, color }) => {
          const s = data[key] || {}
          const chg = s.change_12m
          return (
            <div key={key} className="metric-tile" style={{ flex: 1, minWidth: 170 }}>
              <div className="lbl"><GlossaryText text={label} /></div>
              <div className="v" style={{ color }}>{fmtEokMyeong(s.latest)}</div>
              {s.latest_date && <div style={{ fontSize: 10, color: 'var(--text-3)', marginTop: 2 }}>{s.latest_date.slice(0, 7)}</div>}
              {chg != null && (
                <div className="d" style={{ color: chg > 0 ? 'var(--up)' : chg < 0 ? 'var(--down)' : 'var(--text-3)' }}>
                  {chg > 0 ? '▲' : chg < 0 ? '▼' : '─'} {fmtManMyeongDelta(Math.abs(chg))} <span style={{ color: 'var(--text-3)' }}>12개월 전 대비</span>
                </div>
              )}
            </div>
          )
        })}
      </div>

      <div className="chartbox">
        <div className="sub">가계조사(좌) · 기업조사(우) — 이중축 오버레이</div>
        <ResponsiveContainer width="100%" height={220}>
          <LineChart data={chartData} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
            <XAxis dataKey="date" tick={{ fontSize: 9, fill: 'var(--text-3)' }}
                   tickFormatter={v => v.slice(0, 7)} interval={Math.floor(chartData.length / 6)} />
            {SURVEYS.map(({ key, axis }) => (
              <YAxis key={axis} yAxisId={axis} orientation={axis} tick={{ fontSize: 9, fill: 'var(--text-3)' }}
                     domain={['auto', 'auto']} width={48} tickFormatter={v => v.toLocaleString()} />
            ))}
            <Tooltip contentStyle={{ background: 'var(--bg-elev)', border: '1px solid var(--border)', fontSize: 11 }}
                     labelStyle={{ color: 'var(--text-3)' }}
                     formatter={(v, name) => [v == null ? '-' : v.toLocaleString(), name]} />
            {SURVEYS.map(({ key, label, color, axis }) => (
              <Line key={key} yAxisId={axis} type="monotone" dataKey={key} name={label} stroke={color} dot={false} strokeWidth={1.5} connectNulls />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </SectionCard>
  )
}

import { useState, useEffect } from 'react'
import api from '../../api'
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts'
import { DESC_STYLE, SectionCard, SectionCardLoading, SectionCardError, EmptyNote } from './marketUtils.jsx'
import { GlossaryText } from '../Glossary.jsx'

// 원계열·3MA 모두 건수(Number)다 — krFmt/fmtEokWon은 '억원' 입력 가정이라 재사용하지 않는다
// (1e8배 오표기 전례, CLAUDE.md gotcha). 천 단위 쉼표면 충분.
const fmtCount = v => v == null ? '-' : Math.round(v).toLocaleString()

const SECTORS = [
  { key: 'information', label: '정보 (NAICS 51)', color: 'var(--data-1)' },
  { key: 'professional', label: '전문·과학·기술 (NAICS 54)', color: 'var(--data-2)' },
]

export default function BusinessFormationSection() {
  const [open, setOpen] = useState(false)
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    api.get('/api/market/business-formation')
      .then(r => setData(r.data))
      .catch(() => setError(true))
      .finally(() => setLoading(false))
  }, [])

  if (loading) return <SectionCardLoading title="신규 창업 신청 (미국)" />
  if (error || !data) return <SectionCardError title="신규 창업 신청 (미국)" />

  if (data.error) {
    return (
      <SectionCard title="신규 창업 신청 (미국)" summary="" open={open} onToggle={() => setOpen(o => !o)}>
        <EmptyNote msg={data.error} />
      </SectionCard>
    )
  }

  const info = data.information || {}
  const infoChgPct = (info.latest_raw != null && info.prev_raw)
    ? (info.latest_raw - info.prev_raw) / info.prev_raw * 100 : null
  const summary = info.latest_ma3 != null ? `정보 3MA ${fmtCount(info.latest_ma3)}건` : ''

  return (
    <SectionCard title="신규 창업 신청 (미국)" summary={summary} change={infoChgPct} changeSuffix="%" open={open} onToggle={() => setOpen(o => !o)}>
      <p style={DESC_STYLE}>미국 census국이 매주 접수해 월 단위로 집계하는 신규 사업자 등록 신청 건수입니다. 신청 접수 기준이라 실제 창업(개업)으로 이어지는 비율과는 다르며, 단기 잡음을 줄이기 위해 3개월 이동평균(3MA)을 함께 봅니다.</p>

      <div style={{ display: 'flex', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
        {SECTORS.map(({ key, label, color }) => {
          const s = data[key] || {}
          const chg = (s.latest_raw != null && s.prev_raw != null) ? s.latest_raw - s.prev_raw : null
          return (
            <div key={key} className="metric-tile" style={{ flex: 1, minWidth: 170 }}>
              <div className="lbl"><GlossaryText text={label} /></div>
              <div className="v" style={{ color }}>{fmtCount(s.latest_ma3)} <span style={{ fontSize: 10, color: 'var(--text-3)' }}>3MA</span></div>
              <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 2 }}>
                원계열 {fmtCount(s.latest_raw)}{s.latest_date && ` (${s.latest_date.slice(0, 7)})`}
              </div>
              {chg != null && (
                <div className="d" style={{ color: chg > 0 ? 'var(--up)' : chg < 0 ? 'var(--down)' : 'var(--text-3)' }}>
                  {chg > 0 ? '▲' : chg < 0 ? '▼' : '─'} {fmtCount(Math.abs(chg))} <span style={{ color: 'var(--text-3)' }}>전월(원계열)</span>
                </div>
              )}
            </div>
          )
        })}
      </div>

      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        {SECTORS.map(({ key, label, color }) => {
          const h = data[key]?.ma3 || []
          return (
            <div key={key} className="chartbox" style={{ flex: 1, minWidth: 280 }}>
              <div className="sub">{label} · 3개월 이동평균</div>
              <ResponsiveContainer width="100%" height={180}>
                <LineChart data={h} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                  <XAxis dataKey="date" tick={{ fontSize: 9, fill: 'var(--text-3)' }}
                         tickFormatter={v => v.slice(0, 7)} interval={Math.floor(h.length / 5)} />
                  <YAxis tick={{ fontSize: 9, fill: 'var(--text-3)' }} domain={['auto', 'auto']} width={44}
                         tickFormatter={v => v.toLocaleString()} />
                  <Tooltip contentStyle={{ background: 'var(--bg-elev)', border: '1px solid var(--border)', fontSize: 11 }}
                           labelStyle={{ color: 'var(--text-3)' }}
                           formatter={v => [v.toLocaleString(), '3MA']} />
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

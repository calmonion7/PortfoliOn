import { useState, useEffect } from 'react'
import api from '../../api'
import { LineChart, Line, LabelList, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts'
import { DESC_STYLE, SectionCard, SectionCardLoading, SectionCardError, EmptyNote } from './marketUtils.jsx'
import { GlossaryRechartsLegend } from '../Glossary.jsx'

export default function KrExportsSection() {
  const [open, setOpen] = useState(false)
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    api.get('/api/market/kr-exports')
      .then(r => setData(r.data))
      .catch(() => setError(true))
      .finally(() => setLoading(false))
  }, [])

  if (loading) return <SectionCardLoading title="한국 수출: 반도체 vs 비반도체" />
  if (error || !data) return <SectionCardError title="한국 수출: 반도체 vs 비반도체" />

  if (data.error) {
    return (
      <SectionCard title="한국 수출: 반도체 vs 비반도체" summary="" open={open} onToggle={() => setOpen(o => !o)}>
        <EmptyNote msg={data.error} />
      </SectionCard>
    )
  }

  const months = (data.months || []).map(m => ({
    ...m,
    semishare: m.semiconductor != null && m.non_semiconductor != null
      ? m.semiconductor / (m.semiconductor + m.non_semiconductor) * 100 : null,
  }))
  const latest = months[months.length - 1]
  const prev = months[months.length - 2]
  const yoyMonth = latest ? `${parseInt(latest.month.slice(0, 4)) - 1}${latest.month.slice(4)}` : null
  const yoy3 = months.find(m => m.month === yoyMonth)
  const chg3 = (cur, base) => base ? ((cur - base) / Math.abs(base) * 100) : null
  const semiShare = latest ? (latest.semiconductor / (latest.semiconductor + latest.non_semiconductor) * 100) : null
  const semiSharePrev = yoy3 ? (yoy3.semiconductor / (yoy3.semiconductor + yoy3.non_semiconductor) * 100) : null
  const semiShareMom = prev ? (prev.semiconductor / (prev.semiconductor + prev.non_semiconductor) * 100) : null
  const latestLabel = latest?.month?.replace(/(\d{4})(\d{2})/, '$1-$2')

  const summary = semiShare != null ? `반도체 ${semiShare.toFixed(1)}%` : ''
  const shareChg = semiShare != null ? ((semiSharePrev ?? semiShareMom) != null ? (semiShare - (semiSharePrev ?? semiShareMom)) : null) : null

  return (
    <SectionCard title="한국 수출: 반도체 vs 비반도체" summary={summary} change={shareChg} changeSuffix="%p" open={open} onToggle={() => setOpen(o => !o)}>
      <p style={DESC_STYLE}>관세청 월별 수출 통계 기준입니다. 반도체(HS 8542)는 한국 무역수지와 원화 가치의 핵심 동력으로, 수출 비중 상승은 업황 호조를 의미합니다. 비반도체 비중은 수출 다각화 정도를 나타냅니다.</p>
      <div style={{ display: 'flex', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
        {[
          { label: '반도체', value: latest?.semiconductor, mom: chg3(latest?.semiconductor, prev?.semiconductor), yoy: chg3(latest?.semiconductor, yoy3?.semiconductor), prevVal: prev?.semiconductor, yoyVal: yoy3?.semiconductor, color: 'var(--data-2)' },
          { label: '비반도체', value: latest?.non_semiconductor, mom: chg3(latest?.non_semiconductor, prev?.non_semiconductor), yoy: chg3(latest?.non_semiconductor, yoy3?.non_semiconductor), prevVal: prev?.non_semiconductor, yoyVal: yoy3?.non_semiconductor, color: 'var(--data-5)' },
        ].map(({ label, value, mom, yoy: yoyChg, prevVal, yoyVal, color }) => (
          <div key={label} className="metric-tile" style={{ minWidth: 140, flex: 1 }}>
            <div className="lbl">{label} 수출액 ({latestLabel})</div>
            <div className="v" style={{ color }}>
              {value != null ? value.toLocaleString() : '-'} <span style={{ fontSize: 11, fontWeight: 400 }}>억달러</span>
            </div>
            {mom != null && (
              <>
                <div className="d" style={{ color: mom > 0 ? 'var(--up)' : 'var(--down)' }}>
                  {mom > 0 ? '▲' : '▼'} {Math.abs(mom).toFixed(1)}% <span style={{ color: 'var(--text-3)' }}>MoM</span>
                </div>
                {prevVal != null && <div style={{ fontSize: 10, color: 'var(--text-3)', marginTop: 1 }}>전월 {prevVal.toLocaleString()} 억달러 ({prev?.month?.replace(/(\d{4})(\d{2})/, '$1-$2')})</div>}
              </>
            )}
            {yoyChg != null && (
              <>
                <div className="d" style={{ color: yoyChg > 0 ? 'var(--up)' : 'var(--down)' }}>
                  {yoyChg > 0 ? '▲' : '▼'} {Math.abs(yoyChg).toFixed(1)}% <span style={{ color: 'var(--text-3)' }}>YoY</span>
                </div>
                {yoyVal != null && <div style={{ fontSize: 10, color: 'var(--text-3)', marginTop: 1 }}>전년동기 {yoyVal.toLocaleString()} 억달러 ({yoy3?.month?.replace(/(\d{4})(\d{2})/, '$1-$2')})</div>}
              </>
            )}
          </div>
        ))}
        <div className="metric-tile" style={{ minWidth: 120, flex: 1 }}>
          <div className="lbl">반도체 수출 비중</div>
          <div className="v" style={{ color: 'var(--data-3)' }}>
            {semiShare != null ? semiShare.toFixed(1) : '-'}<span style={{ fontSize: 13 }}>%</span>
          </div>
          {semiShare != null && (semiSharePrev ?? semiShareMom) != null && (() => {
            const base = semiSharePrev ?? semiShareMom
            const isYoy = semiSharePrev != null
            const label = isYoy ? 'YoY' : 'MoM'
            const baseLabel = isYoy
              ? `전년동기 ${base.toFixed(1)}% (${yoyMonth?.replace(/(\d{4})(\d{2})/, '$1-$2')})`
              : `전월 ${base.toFixed(1)}% (${prev?.month?.replace(/(\d{4})(\d{2})/, '$1-$2')})`
            return (
              <>
                <div className="d" style={{ color: semiShare > base ? 'var(--up)' : 'var(--down)' }}>
                  {semiShare > base ? '▲' : '▼'} {Math.abs(semiShare - base).toFixed(1)}%p <span style={{ color: 'var(--text-3)' }}>{label}</span>
                </div>
                <div style={{ fontSize: 10, color: 'var(--text-3)', marginTop: 1 }}>{baseLabel}</div>
              </>
            )
          })()}
          <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 2 }}>반도체 / 전체 수출</div>
        </div>
      </div>
      <div className="chartbox">
        <div className="sub">
          월별 수출액 추이 (억달러) — 반도체 vs 비반도체
        </div>
        <ResponsiveContainer width="100%" height={240}>
          <LineChart data={months} margin={{ top: 16, right: 4, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
            <XAxis dataKey="month" tick={{ fontSize: 10, fill: 'var(--text-3)' }}
                   tickFormatter={v => v.slice(2)} />
            <YAxis yAxisId="left" tick={{ fontSize: 10, fill: 'var(--text-3)' }} domain={['auto', 'auto']} width={40} />
            <YAxis yAxisId="right" orientation="right" domain={[0, 100]} tick={{ fontSize: 10, fill: 'var(--data-3)' }} tickFormatter={v => `${v}%`} width={36} />
            <Tooltip contentStyle={{ background: 'var(--bg-elev)', border: '1px solid var(--border)', fontSize: 12 }}
                     labelFormatter={v => v.replace(/(\d{4})(\d{2})/, '$1-$2')}
                     formatter={(v, n) => n === '반도체 비중' ? [`${v?.toFixed(1)}%`, n] : [v.toLocaleString() + ' 억달러', n]} />
            <Legend content={<GlossaryRechartsLegend />} />
            <Line yAxisId="left" type="monotone" dataKey="semiconductor" name="반도체" stroke="var(--data-2)" dot={{ r: 3 }} strokeWidth={2}>
              <LabelList dataKey="semiconductor" position="top" style={{ fontSize: 9, fill: 'var(--data-2)' }} formatter={v => v?.toFixed(0)} />
            </Line>
            <Line yAxisId="left" type="monotone" dataKey="non_semiconductor" name="비반도체" stroke="var(--data-5)" dot={{ r: 3 }} strokeWidth={2}>
              <LabelList dataKey="non_semiconductor" position="bottom" style={{ fontSize: 9, fill: 'var(--data-5)' }} formatter={v => v?.toFixed(0)} />
            </Line>
            <Line yAxisId="right" type="monotone" dataKey="semishare" name="반도체 비중" stroke="var(--data-3)" dot={false} strokeWidth={1.5} strokeDasharray="4 2" />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </SectionCard>
  )
}

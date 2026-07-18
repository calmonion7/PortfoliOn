import { useState, useEffect } from 'react'
import api from '../../api'
import { Bar, Cell, Line, ComposedChart, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine, Legend } from 'recharts'
import { DESC_STYLE, SectionCard, SectionCardLoading, SectionCardError, EmptyNote } from './marketUtils.jsx'
import { GlossaryRechartsLegend } from '../Glossary.jsx'

// KR 가격색 컨벤션(--up=빨강/--down=파랑)을 그대로 신호색으로 사용 — Badge success/danger 변형 금지
const SIGNAL_DISPLAY = {
  bullish: { label: '강세', color: 'var(--up)' },
  bearish: { label: '약세', color: 'var(--down)' },
  neutral: { label: '중립', color: 'var(--text-3)' },
}

const DRIVER_LABELS = { sp500: 'S&P500', nasdaq: '나스닥', usdkrw: 'USD/KRW' }

export default function KospiSignalSection() {
  const [open, setOpen] = useState(false)
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    api.get('/api/market/kospi-signal')
      .then(r => setData(r.data))
      .catch(() => setError(true))
      .finally(() => setLoading(false))
  }, [])

  if (loading) return <SectionCardLoading title="코스피 방향 신호" />
  if (error || !data) return <SectionCardError title="코스피 방향 신호" />

  const { current, history = [], hit_rate, neutral, timestamp } = data

  if (!current) {
    return (
      <SectionCard title="코스피 방향 신호" summary="" open={open} onToggle={() => setOpen(o => !o)}>
        <EmptyNote msg="아직 수집된 데이터가 없습니다." />
      </SectionCard>
    )
  }

  const { label, color } = SIGNAL_DISPLAY[current.signal] || SIGNAL_DISPLAY.neutral
  const chart = history.slice(-60).map(h => ({
    date: h.date,
    composite_pct: h.composite_pct,
    actual_close_pct: h.actual_close_pct,
    color: (SIGNAL_DISPLAY[h.signal] || SIGNAL_DISPLAY.neutral).color,
  }))

  const daysAgo = timestamp ? Math.floor((Date.now() - new Date(timestamp).getTime()) / 86400000) : null
  const stale = daysAgo != null && daysAgo >= 1

  return (
    <SectionCard title="코스피 방향 신호" summary={`${label} ${current.composite_pct != null ? current.composite_pct.toFixed(2) : '-'}%`} open={open} onToggle={() => setOpen(o => !o)}>
      <p style={DESC_STYLE}>미국 증시 마감(S&P500·나스닥)과 원/달러 환율(원화약세=비우호로 역방향 반영) 등락률을 등가중 합성해 다음날 코스피 방향을 추정하는 오버나잇 프록시입니다. 합성치가 ±0.5%p를 넘으면 강세/약세, 그 안이면 중립으로 판정합니다. 실제 결과는 다음 배치 실행 시 코스피 시가·종가 데이터가 확보되는 대로 소급 확정됩니다.</p>

      <div style={{ display: 'flex', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
        <div className="metric-tile" style={{ minWidth: 140 }}>
          <div className="lbl">{current.date} 신호</div>
          <div className="v" style={{ color }}>{label}</div>
          <div className="d" style={{ color }}>
            {current.composite_pct != null ? `${current.composite_pct > 0 ? '+' : ''}${current.composite_pct.toFixed(2)}%` : '-'}
          </div>
          {stale && <div style={{ fontSize: 10, color: 'var(--text-3)', marginTop: 4 }}>{daysAgo}일 전 기준</div>}
        </div>

        {Object.entries(DRIVER_LABELS).map(([key, label2]) => {
          const v = current.drivers?.[key]
          const c = v > 0 ? 'var(--up)' : v < 0 ? 'var(--down)' : 'var(--text-3)'
          return (
            <div key={key} className="metric-tile" style={{ minWidth: 120 }}>
              <div className="lbl">{label2}</div>
              <div className="v" style={{ color: c }}>
                {v != null ? `${v > 0 ? '+' : ''}${v.toFixed(2)}%` : '-'}
              </div>
            </div>
          )
        })}

        <div className="metric-tile" style={{ minWidth: 140 }}>
          <div className="lbl">적중률 (방향성)</div>
          <div className="v">{hit_rate != null ? `${(hit_rate * 100).toFixed(1)}%` : '-'}</div>
          <div style={{ fontSize: 10, color: 'var(--text-3)', marginTop: 4 }}>
            중립 {neutral?.total ?? 0}건 중 {neutral?.hit ?? 0}건 적중 (별도 집계)
          </div>
        </div>
      </div>

      {chart.length > 0 && (
        <div className="chartbox">
          <div className="sub">합성 신호 vs 실제 코스피 등락률 (최근 60일)</div>
          {/* 막대 per-cell 색(신호 방향) 범례 — recharts Legend는 시리즈명만 보여줘 셀 색 의미가 비었음 */}
          <div style={{ display: 'flex', gap: 10, fontSize: 10, color: 'var(--text-3)', marginBottom: 4 }}>
            {Object.values(SIGNAL_DISPLAY).map(({ label, color }) => (
              <span key={label} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                <span style={{ width: 8, height: 8, borderRadius: 2, background: color, display: 'inline-block' }} />
                신호 {label}
              </span>
            ))}
          </div>
          <ResponsiveContainer width="100%" height={220}>
            <ComposedChart data={chart} margin={{ top: 4, right: 16, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
              <XAxis dataKey="date" tick={{ fontSize: 10, fill: 'var(--text-3)' }}
                     tickFormatter={v => v.slice(5)} interval={Math.floor(chart.length / 6)} />
              <YAxis tick={{ fontSize: 10, fill: 'var(--text-3)' }} width={36} tickFormatter={v => `${v}%`} />
              <Tooltip contentStyle={{ background: 'var(--bg-elev)', border: '1px solid var(--border)', fontSize: 12 }}
                       labelStyle={{ color: 'var(--text-3)' }}
                       formatter={(v, name) => [v != null ? `${v.toFixed(2)}%` : '-', name]} />
              <Legend content={<GlossaryRechartsLegend />} />
              <ReferenceLine y={0} stroke="var(--border)" />
              <Bar dataKey="composite_pct" name="합성 신호">
                {chart.map((c, i) => <Cell key={i} fill={c.color} />)}
              </Bar>
              <Line type="monotone" dataKey="actual_close_pct" name="실제 코스피 등락률" stroke="var(--data-3)" dot={false} strokeWidth={1.5} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      )}
    </SectionCard>
  )
}

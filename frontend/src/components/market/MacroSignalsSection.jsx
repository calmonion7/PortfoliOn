import { useState, useEffect } from 'react'
import api from '../../api'
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine } from 'recharts'
import { CARD_STYLE, DESC_STYLE, SectionCard, SectionCardLoading, SectionCardError } from './marketUtils.jsx'

export default function MacroSignalsSection() {
  const [open, setOpen] = useState(false)
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    api.get('/api/market/macro-signals')
      .then(r => setData(r.data))
      .catch(() => setError(true))
      .finally(() => setLoading(false))
  }, [])

  if (loading) return <SectionCardLoading title="매크로 신호 (미국)" />
  if (error || !data) return <SectionCardError title="매크로 신호 (미국)" />

  if (data.error) {
    return (
      <SectionCard title="매크로 신호 (미국)" summary="" open={open} onToggle={() => setOpen(o => !o)}>
        <div style={{ ...CARD_STYLE, fontSize: 13, color: 'var(--text-3)' }}>
          <p>{data.error}</p>
        </div>
      </SectionCard>
    )
  }

  const series = [
    { key: 'yield_curve', label: '장단기 금리차 (10Y-2Y)', color: 'var(--data-2)', valFmt: v => `${v.toFixed(2)}%p`, chgUnit: '%p', zeroLine: true },
    { key: 'hy_spread', label: '하이일드 스프레드', color: 'var(--data-3)', valFmt: v => `${v.toFixed(2)}%`, chgUnit: '%p', refLine: 5.0 },
    { key: 'm2', label: 'M2 통화량 (십억$)', color: 'var(--data-5)', valFmt: v => v.toLocaleString(undefined, { maximumFractionDigits: 0 }), chgUnit: '%', chgPct: true },
    { key: 'fed_funds', label: '연방기금금리', color: 'var(--data-4)', valFmt: v => `${v.toFixed(2)}%`, chgUnit: '%p' },
  ]

  const signals = data.signals || {}
  const inverted = signals.inverted
  const creditStress = signals.credit_stress

  const lastYc = data.yield_curve?.slice(-1)[0]
  const summary = lastYc ? `금리차 ${lastYc.value.toFixed(2)}%p` : ''

  const cards = series.map(s => {
    const hist = data[s.key] || []
    const last = hist.slice(-1)[0]
    const prev = hist.slice(-2, -1)[0]
    let chg = null
    if (last && prev) {
      chg = s.chgPct ? (last.value - prev.value) / prev.value * 100 : last.value - prev.value
    }
    return { ...s, hist, last, prev, chg }
  })

  return (
    <SectionCard title="매크로 신호 (미국)" summary={summary} open={open} onToggle={() => setOpen(o => !o)}>
      <p style={DESC_STYLE}>장단기 금리차(10Y-2Y)가 음수이면 수익률곡선 역전으로 침체 경고 신호입니다. 하이일드 스프레드 급확대는 신용 스트레스를 의미합니다. M2 통화량과 연방기금금리는 유동성·통화정책 방향을 보여줍니다.</p>

      {(inverted || creditStress) && (
        <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
          {inverted && (
            <div style={{ ...CARD_STYLE, fontSize: 12, color: 'var(--warn)', border: '1px solid var(--warn)', display: 'flex', alignItems: 'center', gap: 6 }}>
              <span>⚠</span> 수익률곡선 역전 (장단기 금리차 &lt; 0)
            </div>
          )}
          {creditStress && (
            <div style={{ ...CARD_STYLE, fontSize: 12, color: 'var(--warn)', border: '1px solid var(--warn)', display: 'flex', alignItems: 'center', gap: 6 }}>
              <span>⚠</span> 신용 스트레스 (HY 스프레드 ≥ 5%)
            </div>
          )}
        </div>
      )}

      <div style={{ display: 'flex', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
        {cards.map(({ key, label, color, valFmt, chg, chgUnit, last, prev, zeroLine }) => {
          const warn = zeroLine && last && last.value < 0
          return (
            <div key={key} style={{ ...CARD_STYLE, flex: 1, minWidth: 150, ...(warn ? { border: '1px solid var(--warn)' } : {}) }}>
              <div style={{ fontSize: 11, color: 'var(--text-3)', marginBottom: 4 }}>{label}</div>
              <div style={{ fontSize: 20, fontWeight: 700, color: warn ? 'var(--warn)' : color }}>
                {last ? valFmt(last.value) : '-'}
              </div>
              {last && <div style={{ fontSize: 10, color: 'var(--text-3)', marginTop: 2 }}>{last.date}</div>}
              {chg != null && (
                <div style={{ fontSize: 12, color: chg > 0 ? 'var(--up)' : chg < 0 ? 'var(--down)' : 'var(--text-3)', marginTop: 4 }}>
                  {chg > 0 ? '▲' : chg < 0 ? '▼' : '─'} {Math.abs(chg).toFixed(2)}{chgUnit} <span style={{ color: 'var(--text-3)' }}>전일</span>
                </div>
              )}
            </div>
          )
        })}
      </div>

      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        {cards.map(({ key, label, color, hist, refLine, zeroLine }) => (
          <div key={key} style={{ ...CARD_STYLE, flex: 1, minWidth: 280 }}>
            <div style={{ fontSize: 12, color: 'var(--text-3)', marginBottom: 8 }}>{label} (3년)</div>
            <ResponsiveContainer width="100%" height={180}>
              <LineChart data={hist} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                <XAxis dataKey="date" tick={{ fontSize: 9, fill: 'var(--text-3)' }}
                       tickFormatter={v => v.slice(0, 7)} interval={Math.floor(hist.length / 5)} />
                <YAxis tick={{ fontSize: 9, fill: 'var(--text-3)' }} domain={['auto', 'auto']} width={40} />
                <Tooltip contentStyle={{ background: 'var(--bg-elev)', border: '1px solid var(--border)', fontSize: 11 }}
                         labelStyle={{ color: 'var(--text-3)' }}
                         formatter={v => [v, label]} />
                {zeroLine && <ReferenceLine y={0} stroke="var(--warn)" strokeDasharray="4 4" />}
                {refLine != null && <ReferenceLine y={refLine} stroke="var(--warn)" strokeDasharray="4 4" />}
                <Line type="monotone" dataKey="value" name={label} stroke={color} dot={false} strokeWidth={1.5} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        ))}
      </div>
    </SectionCard>
  )
}

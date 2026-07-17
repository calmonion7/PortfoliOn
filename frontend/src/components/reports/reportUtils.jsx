import { useState, useRef } from 'react'
import { fmtPrice as fmt } from '../../utils'
import { SketchUnderline } from '../sketches'
import './ReportDetail.css'

export const TH = { padding: '6px 10px', textAlign: 'right', borderBottom: '1px solid var(--border)', whiteSpace: 'nowrap', fontSize: 11, color: 'var(--text-3)', position: 'sticky', top: 0, zIndex: 2, background: 'var(--bg-elev-2)' }
export const TD = { padding: '5px 10px', textAlign: 'right', borderBottom: '1px solid var(--border)', fontSize: 12, fontFamily: 'var(--font-mono)', fontVariantNumeric: 'tabular-nums' }

export const fmtN = (val) => val != null ? val : '—'
export const rsiColor = (rsi) => {
  if (rsi == null) return 'var(--text-3)'
  const hue = Math.round(120 - (rsi / 100) * 120)
  const isDark = document.documentElement.getAttribute('data-theme') === 'dark'
  return isDark ? `hsl(${hue}, 60%, 60%)` : `hsl(${hue}, 70%, 24%)`
}

export const fmtGap = (target, price) => {
  if (target == null || !price) return null
  const pct = (target - price) / price * 100
  return { text: `${pct >= 0 ? '+' : ''}${pct.toFixed(1)}%`, positive: pct >= 0 }
}

const _PEER_METRICS = [
  { key: 'per', label: 'PER' },
  { key: 'pbr', label: 'PBR' },
  { key: 'psr', label: 'PSR' },
  { key: 'ev_ebitda', label: 'EV/EBITDA' },
]

export const computePeerPremiums = (competitors) => {
  if (!Array.isArray(competitors)) return []
  const self = competitors.find((c) => c.is_self)
  if (!self) return []
  const peers = competitors.filter((c) => !c.is_self)

  return _PEER_METRICS.reduce((acc, { key, label }) => {
    const selfVal = self[key]
    if (typeof selfVal !== 'number' || !Number.isFinite(selfVal)) return acc
    const peerVals = peers
      .map((c) => c[key])
      .filter((v) => typeof v === 'number' && Number.isFinite(v))
      .sort((a, b) => a - b)
    if (peerVals.length < 2) return acc

    const mid = peerVals.length / 2
    const median = peerVals.length % 2 === 0
      ? (peerVals[mid - 1] + peerVals[mid]) / 2
      : peerVals[Math.floor(mid)]
    if (median <= 0) return acc

    const pct = Math.round((selfVal / median - 1) * 100)
    acc.push({ metric: label, pct, discount: pct < 0 })
    return acc
  }, [])
}

export const _weather = (score) => {
  if (score <= 0) return { icon: '☀️', label: '맑음' }
  if (score <= 1) return { icon: '⛅', label: '구름 조금' }
  if (score <= 2) return { icon: '☁️', label: '흐림' }
  return { icon: '🌧️', label: '비' }
}

export const overallWeather = (summary) => {
  if (!summary) return null
  const scores = []
  if (summary.price && summary.target_mean) {
    const gap = (summary.target_mean - summary.price) / summary.price * 100
    const total = (summary.buy ?? 0) + (summary.hold ?? 0) + (summary.sell ?? 0)
    const buyPct = total > 0 ? (summary.buy ?? 0) / total * 100 : 50
    if (gap >= 15 && buyPct >= 60) scores.push(0)
    else if (gap >= 5 && buyPct >= 45) scores.push(1)
    else if (gap >= -5) scores.push(2)
    else scores.push(3)
  }
  const rsi = summary.daily_rsi?.rsi
  if (rsi != null) {
    if (rsi < 30) scores.push(0)
    else if (rsi < 45) scores.push(1)
    else if (rsi < 65) scores.push(2)
    else scores.push(3)
  }
  if (!scores.length) return null
  return _weather(Math.round(scores.reduce((a, b) => a + b, 0) / scores.length))
}

export const MetricCard = ({ label, value, sub, valueColor }) => (
  <div style={{ background: 'var(--bg-elev)', border: '1px solid var(--border)', borderRadius: 5, padding: '5px 8px' }}>
    <div style={{ color: 'var(--text-3)', fontSize: 10, marginBottom: 2 }}>{label}</div>
    <div className="mono tnum" style={{ fontWeight: 700, fontSize: 12, color: valueColor ?? 'var(--text)' }}>{value}</div>
    {sub && <div style={{ color: 'var(--text-3)', fontSize: 9, marginTop: 1 }}>{sub}</div>}
  </div>
)

export const SectionTitle = ({ children, weather, right }) => (
  <div className="rpt-title">
    <div className="rpt-title__row">
      <span className="rpt-title__text">{children}</span>
      {weather && <span title={weather.label} className="rpt-title__weather">{weather.icon}</span>}
      {right}
    </div>
    <SketchUnderline size={64} className="rpt-title__underline" />
  </div>
)

export const GapCell = ({ target, price, baseColor, highlight, market }) => {
  const gap = fmtGap(target, price)
  return (
    <td className="mono tnum" style={{ ...TD, color: baseColor, background: highlight ? 'var(--surface-hover)' : undefined, border: highlight ? '2px solid var(--accent)' : undefined, fontWeight: highlight ? 700 : undefined }}>
      {target != null ? <>{fmt(target, market)}{gap && <span style={{ color: gap.positive ? 'var(--up)' : 'var(--down)' }}>({gap.text})</span>}</> : '—'}
    </td>
  )
}

export function TargetTooltip({ s }) {
  const [visible, setVisible] = useState(false)
  const ref = useRef(null)
  const [pos, setPos] = useState({ top: 0, left: 0 })

  const total = (s?.buy ?? 0) + (s?.hold ?? 0) + (s?.sell ?? 0)
  const pct = (n) => total > 0 ? ` (${Math.round(n / total * 100)}%)` : ''
  const gap = s?.target_mean != null && s?.price != null
    ? ((s.target_mean - s.price) / s.price * 100)
    : null

  const handleMouseEnter = (e) => {
    const rect = e.currentTarget.getBoundingClientRect()
    setPos({ top: rect.bottom + 4, left: rect.left })
    setVisible(true)
  }

  return (
    <div ref={ref} style={{ display: 'inline-block', position: 'relative' }}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={() => setVisible(false)}
    >
      {s ? fmt(s.target_mean, s.market) : '—'}
      {gap != null && <div style={{ color: gap >= 0 ? 'var(--up)' : 'var(--down)', fontSize: 10 }}>{gap >= 0 ? '+' : ''}{gap.toFixed(1)}%</div>}
      {visible && s?.target_mean != null && (
        <div style={{
          position: 'fixed',
          top: pos.top,
          left: pos.left,
          zIndex: 9999,
          background: 'var(--bg-elev)',
          border: '1px solid var(--border)',
          borderRadius: 6,
          padding: '10px 14px',
          minWidth: 200,
          fontSize: 12,
          color: 'var(--text)',
          boxShadow: '0 4px 16px rgba(0,0,0,0.6)',
          pointerEvents: 'none',
          lineHeight: 1.8,
        }}>
          <div style={{ color: 'var(--accent)', fontWeight: 700, marginBottom: 6, fontSize: 11 }}>목표가 근거</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '2px 10px' }}>
            <span style={{ color: 'var(--text-3)' }}>평균</span>
            <span style={{ color: 'var(--text)', fontWeight: 600 }}>{fmt(s.target_mean, s.market)}{gap != null && <span style={{ color: gap >= 0 ? 'var(--up)' : 'var(--down)', marginLeft: 4 }}>{gap >= 0 ? '+' : ''}{gap.toFixed(1)}%</span>}</span>
            <span style={{ color: 'var(--text-3)' }}>최고</span>
            <span style={{ color: 'var(--up)' }}>{fmt(s.target_high, s.market)}</span>
            <span style={{ color: 'var(--text-3)' }}>최저</span>
            <span style={{ color: 'var(--down)' }}>{fmt(s.target_low, s.market)}</span>
            <span style={{ color: 'var(--text-3)' }}>애널리스트</span>
            <span>{total > 0 ? `${total}명` : '—'}</span>
            <span style={{ color: 'var(--text-3)' }}>Buy</span>
            <span style={{ color: 'var(--semantic-buy)' }}>{s.buy ?? 0}{pct(s.buy ?? 0)}</span>
            <span style={{ color: 'var(--text-3)' }}>Hold</span>
            <span>{s.hold ?? 0}{pct(s.hold ?? 0)}</span>
            <span style={{ color: 'var(--text-3)' }}>Sell</span>
            <span style={{ color: 'var(--semantic-sell)' }}>{s.sell ?? 0}{pct(s.sell ?? 0)}</span>
            {s.finviz_recom != null && <>
              <span style={{ color: 'var(--text-3)' }}>Finviz</span>
              <span>{s.finviz_recom} <span style={{ color: 'var(--text-3)', fontSize: 10 }}>(1=강매수)</span></span>
            </>}
          </div>
        </div>
      )}
    </div>
  )
}

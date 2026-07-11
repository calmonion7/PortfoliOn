import { useMemo } from 'react'

// ── 유틸 ──────────────────────────────────────────────────────
export const fmt = (n, d = 2) => {
  if (n == null || isNaN(n)) return '—'
  return n.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d })
}

export const sign = (n) =>
  (n > 0 ? '+' : '') + n.toFixed(Math.abs(n) < 1 ? 2 : 1)

// ── SVG 아이콘 ────────────────────────────────────────────────
export function ChevDown() {
  return <svg aria-hidden="true" width="10" height="10" viewBox="0 0 10 10" fill="none"><path d="M2 4l3 3 3-3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
}
export function Search() {
  return <svg aria-hidden="true" width="14" height="14" viewBox="0 0 14 14" fill="none"><circle cx="6" cy="6" r="4.5" stroke="currentColor" strokeWidth="1.3"/><path d="M9.5 9.5l2.5 2.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/></svg>
}
export function Plus() {
  return <svg aria-hidden="true" width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M6 2v8M2 6h8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/></svg>
}
export function Sun() {
  return <svg aria-hidden="true" width="14" height="14" viewBox="0 0 14 14" fill="none"><circle cx="7" cy="7" r="2.5" stroke="currentColor" strokeWidth="1.3"/><path d="M7 .8v1.6M7 11.6v1.6M.8 7h1.6M11.6 7h1.6M2.2 2.2l1.1 1.1M10.7 10.7l1.1 1.1M2.2 11.8l1.1-1.1M10.7 3.3l1.1-1.1" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/></svg>
}
export function Moon() {
  return <svg aria-hidden="true" width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M11.5 8.5A5 5 0 0 1 5.5 2.5a5 5 0 1 0 6 6z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round"/></svg>
}
export function Bell() {
  return <svg aria-hidden="true" width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M3.5 6a3.5 3.5 0 0 1 7 0v2l1 1.5h-9L3.5 8V6z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round"/><path d="M5.5 11a1.5 1.5 0 0 0 3 0" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/></svg>
}
export function Caret({ dir = 'right' }) {
  const r = dir === 'left' ? 180 : dir === 'down' ? 90 : dir === 'up' ? -90 : 0
  return <svg aria-hidden="true" width="10" height="10" viewBox="0 0 10 10" style={{ transform: `rotate(${r}deg)` }}><path d="M3.5 2l3 3-3 3" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round"/></svg>
}
export function Refresh() {
  return <svg aria-hidden="true" width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M2 6a4 4 0 0 1 7-2.6M10 6a4 4 0 0 1-7 2.6M9 1.5V3.5H7M3 10.5V8.5H5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/></svg>
}
export function Warn() {
  return <svg aria-hidden="true" width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M6 1.5l5 8.5H1l5-8.5z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round"/><path d="M6 5v2.5M6 8.7v.3" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/></svg>
}
export function HomeIcon() {
  return <svg aria-hidden="true" width="20" height="20" viewBox="0 0 20 20" fill="none"><path d="M3 8.5L10 3l7 5.5V17a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V8.5z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round"/><path d="M7 18v-6h6v6" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round"/></svg>
}
export function SearchIcon() {
  return <svg aria-hidden="true" width="20" height="20" viewBox="0 0 20 20" fill="none"><circle cx="9" cy="9" r="6" stroke="currentColor" strokeWidth="1.4"/><path d="M13.5 13.5l3 3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/></svg>
}
export function ChartIcon() {
  return <svg aria-hidden="true" width="20" height="20" viewBox="0 0 20 20" fill="none"><path d="M3 14l4-4 4 2 6-7" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/></svg>
}
export function GridIcon() {
  return <svg aria-hidden="true" width="20" height="20" viewBox="0 0 20 20" fill="none"><rect x="3" y="3" width="6" height="6" rx="1.5" stroke="currentColor" strokeWidth="1.4"/><rect x="11" y="3" width="6" height="6" rx="1.5" stroke="currentColor" strokeWidth="1.4"/><rect x="3" y="11" width="6" height="6" rx="1.5" stroke="currentColor" strokeWidth="1.4"/><rect x="11" y="11" width="6" height="6" rx="1.5" stroke="currentColor" strokeWidth="1.4"/></svg>
}
export function GearIcon() {
  return <svg aria-hidden="true" width="20" height="20" viewBox="0 0 20 20" fill="none"><circle cx="10" cy="10" r="2.5" stroke="currentColor" strokeWidth="1.4"/><path d="M10 2v2M10 16v2M2 10h2M16 10h2M4.2 4.2l1.4 1.4M14.4 14.4l1.4 1.4M4.2 15.8l1.4-1.4M14.4 5.6l1.4-1.4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/></svg>
}
export function GuruIcon() {
  return <svg aria-hidden="true" width="20" height="20" viewBox="0 0 20 20" fill="none"><circle cx="10" cy="7" r="3" stroke="currentColor" strokeWidth="1.4"/><path d="M4 17c0-3.314 2.686-5 6-5s6 1.686 6 5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/></svg>
}
export function CalendarIcon() {
  return <svg aria-hidden="true" width="20" height="20" viewBox="0 0 20 20" fill="none"><rect x="3" y="4" width="14" height="13" rx="1.5" stroke="currentColor" strokeWidth="1.4"/><path d="M3 8h14M7 2.5v3M13 2.5v3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/></svg>
}

export function LogOut() {
  return <svg aria-hidden="true" width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M5 2.5H3a1 1 0 0 0-1 1v7a1 1 0 0 0 1 1h2" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/><path d="M7 7h5M9.5 4.5l2.5 2.5-2.5 2.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/></svg>
}
export function Pencil() {
  return <svg aria-hidden="true" width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M9.5 2.5l2 2L4 12H2v-2L9.5 2.5z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round"/><path d="M8 4l2 2" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/></svg>
}

// ── Spark 차트 ──────────────────────────────────────────────
export function Spark({ data, w = 80, h = 24, color, area = true }) {
  const path = useMemo(() => {
    if (!data || data.length < 2) return { line: '', area: '' }
    const min = Math.min(...data), max = Math.max(...data)
    const range = max - min || 1
    const pts = data.map((v, i) => [
      (i / (data.length - 1)) * w,
      h - ((v - min) / range) * h * 0.85 - h * 0.075,
    ])
    const line = pts.map((p, i) => (i === 0 ? 'M' : 'L') + p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join(' ')
    const ar = line + ` L ${w} ${h} L 0 ${h} Z`
    return { line, area: ar }
  }, [data, w, h])
  const c = color || 'var(--text-2)'
  return (
    <svg width={w} height={h} style={{ display: 'block' }} viewBox={`0 0 ${w} ${h}`}>
      {area && <path d={path.area} fill={c} opacity="0.10" />}
      <path d={path.line} stroke={c} strokeWidth="1.4" fill="none" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

// 시드 기반 의사 스파크 데이터 (실제 시계열 없을 때 placeholder용)
export function sparkFor(seed, len = 40, drift = 0) {
  const arr = []
  let v = 100
  let s = 0
  for (let i = 0; i < seed.length; i++) s = (s * 31 + seed.charCodeAt(i)) & 0xffffffff
  const rng = () => { s = (s * 1664525 + 1013904223) & 0xffffffff; return (s >>> 0) / 0x100000000 }
  for (let i = 0; i < len; i++) { v += (rng() - 0.5) * 2 + drift; arr.push(v) }
  return arr
}

// ── 마켓 배지 ─────────────────────────────────────────────────
export function MarketBadge({ mkt, exchange = '' }) {
  const label = mkt === 'US' ? 'US' : exchange === 'KS' ? 'KOSPI' : exchange === 'KQ' ? 'KOSDAQ' : 'KR'
  return (
    <span className="mkt-badge">
      <span className="mkt-flag" aria-hidden>{mkt === 'US' ? '🇺🇸' : '🇰🇷'}</span>
      <span>{label}</span>
    </span>
  )
}

// ── 부호 포함 수치 표시 ────────────────────────────────────────
export function Sig({ v, suffix = '%' }) {
  const c = v > 0 ? 'up' : v < 0 ? 'down' : 'muted'
  return <span className={c + ' tnum'}>{sign(v)}{suffix}</span>
}

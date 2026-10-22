import { useState, useEffect } from 'react'
import api from '../../api'
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts'
import { DESC_STYLE, SectionCard, SectionCardLoading, SectionCardError } from './marketUtils.jsx'

const DEFAULT_ITEM = 'dram:475'
const fmt = (v, d = 2) => (v == null ? '-' : v.toLocaleString(undefined, { maximumFractionDigits: d }))
const TOOLTIP_STYLE = { background: 'var(--bg-elev)', border: '1px solid var(--border)', fontSize: 12 }
const ROW_BASE = {
  display: 'flex', alignItems: 'center', gap: 8, width: '100%', minHeight: 44, padding: '6px 12px',
  background: 'none', border: 'none', borderLeft: '3px solid transparent', cursor: 'pointer', textAlign: 'left',
}
const NAME_STYLE = { flex: 1, minWidth: 0, fontSize: 13, color: 'var(--text)', wordBreak: 'keep-all', overflowWrap: 'break-word' }
const NUM_STYLE = { flexShrink: 0, fontSize: 12, fontVariantNumeric: 'tabular-nums', color: 'var(--text-2)' }

const dirColor = v => (v > 0 ? 'var(--up)' : v < 0 ? 'var(--down)' : 'var(--text-3)')
const dirArrow = v => (v > 0 ? '▲' : v < 0 ? '▼' : '─')

function LineBox({ title, data, color }) {
  return (
    <div className="chartbox" data-testid="semi-linebox" style={{ marginBottom: 16 }}>
      <div className="sub">{title}</div>
      <ResponsiveContainer width="100%" height={180}>
        <LineChart data={data} margin={{ top: 4, right: 16, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
          <XAxis dataKey="date" tick={{ fontSize: 10, fill: 'var(--text-3)' }} tickFormatter={v => v.slice(5)}
                 interval="preserveStartEnd" minTickGap={16} />
          <YAxis tick={{ fontSize: 10, fill: 'var(--text-3)' }} domain={['auto', 'auto']} width={52} />
          <Tooltip contentStyle={TOOLTIP_STYLE} labelStyle={{ color: 'var(--text-3)' }} />
          <Line type="monotone" dataKey="value" name={title} stroke={color} dot={false} strokeWidth={1.5} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}

// 반도체: SOX 지수 + DRAMeXchange 메모리 현물가 (task#403 S5).
// 두 조회는 독립 — 한쪽 실패가 다른 쪽을 지우지 않는다. 메모리는 3상태(null=미조회 · categories=[]=0건 · failed=실패).
export default function SemiconductorSection() {
  const [open, setOpen] = useState(true)
  const [sox, setSox] = useState(null)
  const [semi, setSemi] = useState(null)
  const [failed, setFailed] = useState(false)
  const [selected, setSelected] = useState(DEFAULT_ITEM)

  useEffect(() => {
    api.get('/api/market/indices').then(r => setSox(r.data?.indices?.sox ?? null)).catch(() => {})
    api.get('/api/market/semiconductor').then(r => setSemi(r.data)).catch(() => setFailed(true))
  }, [])

  if (failed && !sox) return <SectionCardError title="반도체" />
  if (!semi && !sox) return <SectionCardLoading title="반도체" />

  const categories = semi?.categories || []
  const items = categories.flatMap(c => c.items)
  const sel = items.find(i => i.id === selected)
  const soxHist = sox?.history?.slice(-252) || []

  return (
    <SectionCard title="반도체" summary={sox ? fmt(sox.current) : ''} change={sox?.change_pct ?? null} changeSuffix="%" open={open} onToggle={() => setOpen(o => !o)}>
      <p style={DESC_STYLE}>필라델피아 반도체지수(SOX)와 DRAMeXchange 메모리 현물가입니다. 행을 누르면 아래 차트가 해당 품목으로 바뀝니다.</p>

      {sox && (
        <div className="metric-tile" style={{ marginBottom: 16 }}>
          <div className="lbl">SOX</div>
          <div className="v">{fmt(sox.current)}</div>
          <div className="d" style={{ color: dirColor(sox.change_pct) }}>{dirArrow(sox.change_pct)} {Math.abs(sox.change_pct ?? 0).toFixed(2)}%</div>
        </div>
      )}
      {soxHist.length > 0 && <LineBox title="SOX 추이 (1년)" data={soxHist} color="var(--data-2)" />}

      {failed && <p role="alert" style={{ ...DESC_STYLE, color: 'var(--color-error)' }}>메모리 현물가를 불러오지 못했습니다.</p>}
      {!failed && !semi && <p style={DESC_STYLE}>메모리 현물가를 불러오는 중…</p>}
      {semi && items.length === 0 && <p style={DESC_STYLE}>수집된 메모리 현물가가 아직 없습니다.</p>}

      {categories.map(c => (
        <div key={c.key} data-testid={`semi-cat-${c.key}`} style={{ marginBottom: 12, border: '1px solid var(--border)', borderRadius: 8 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, padding: '8px 12px', background: 'var(--bg)', borderBottom: '1px solid var(--border)' }}>
            <strong style={{ fontSize: 13, color: 'var(--text)' }}>{c.label}</strong>
            <span style={{ fontSize: 11, color: 'var(--text-3)', flexShrink: 0 }}>{c.updated_at}</span>
          </div>
          {c.items.map(it => {
            const on = it.id === selected
            return (
              <button key={it.id} type="button" data-testid={`semi-row-${it.id}`} aria-pressed={on} onClick={() => setSelected(it.id)}
                      style={{ ...ROW_BASE, borderLeftColor: on ? 'var(--text)' : 'transparent', background: on ? 'var(--bg)' : 'none' }}>
                <span style={NAME_STYLE}>{it.name}</span>
                <span style={NUM_STYLE}>{fmt(it.avg)}</span>
                <span style={{ ...NUM_STYLE, minWidth: 64, textAlign: 'right', color: dirColor(it.change_pct) }}>
                  {it.change_pct == null ? '-' : `${dirArrow(it.change_pct)} ${Math.abs(it.change_pct).toFixed(2)}%`}
                </span>
              </button>
            )
          })}
        </div>
      ))}

      {sel && sel.history?.length > 0 && (
        <div data-testid="semi-chart" data-item={sel.id}>
          <LineBox title={sel.name} data={sel.history} color="var(--data-3)" />
        </div>
      )}
    </SectionCard>
  )
}

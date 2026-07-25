import { useState, useEffect } from 'react'
import { useParams, Link } from 'react-router-dom'
import { ComposedChart, LineChart, Line, LabelList, CartesianGrid, XAxis, YAxis, ReferenceArea, ReferenceLine, ResponsiveContainer } from 'recharts'
import api from '../api'
import { fmtPrice } from '../utils'
import Badge, { MarketBadge } from '../components/ui/Badge'
import Card from '../components/ui/Card'
import Stat from '../components/ui/Stat'
import Skeleton from '../components/ui/Skeleton'
import { SectionTitle, TH, TD } from '../components/reports/reportUtils.jsx'

// 증권사 리포트식 단일 문서 페이지 (task#212, 에디토리얼 재설계 task#216, ADR-0026/0027)
// 헤더(스탯 스트립+밴드 게이지) → 한줄 논지 → 투자 포인트 → 밸류에이션 → 실적 추정 → 리스크

export const RATING_META = {
  buy: { label: '매수', variant: 'success' },      // 의미 배지 — 가격색(up/down) 교차 사용 금지(task#194)
  neutral: { label: '중립', variant: 'neutral' },
  sell: { label: '매도', variant: 'danger' },
}

const fmtAmount = (v, isKR) => {
  if (v == null) return '—'
  const abs = Math.abs(v)
  if (isKR) {
    if (abs >= 1e12) return `${(v / 1e12).toFixed(1)}조`
    if (abs >= 1e8) return `${Math.round(v / 1e8).toLocaleString()}억`
    return Math.round(v).toLocaleString()
  }
  if (abs >= 1e12) return `${(v / 1e12).toFixed(1)}T`
  if (abs >= 1e9) return `${(v / 1e9).toFixed(1)}B`
  if (abs >= 1e6) return `${(v / 1e6).toFixed(0)}M`
  return v.toLocaleString()
}

const fmtEps = (v, isKR) => {
  if (v == null) return '—'
  return isKR ? `${Math.round(v).toLocaleString()}원` : `$${v.toFixed(2)}`
}

export function PerBandChart({ band }) {
  if (!band || band.min == null || band.max == null) return null
  const marks = [
    { key: 'avg', v: band.avg, label: '평균', color: 'var(--text-3)', dash: '4 3' },
    { key: 'current', v: band.current, label: '현재', color: 'var(--up)' },
    { key: 'forward', v: band.forward, label: 'Fwd', color: 'var(--accent)' },
  ].filter(m => m.v != null && Number.isFinite(m.v))
  const values = [band.min, band.max, ...marks.map(m => m.v)]
  const lo = Math.min(...values), hi = Math.max(...values)
  const pad = (hi - lo) * 0.12 || 1
  // XAxis type=number는 실제 데이터 포인트가 있어야 domain이 유효 — 빈 행이면 축이 한 점으로 붕괴(uat212)
  const axisData = [{ x: lo - pad, y: 0 }, { x: hi + pad, y: 0 }]
  return (
    <div style={{ margin: '14px 0 4px' }}>
      <ResponsiveContainer width="100%" height={96}>
        <ComposedChart data={axisData} margin={{ top: 26, right: 28, bottom: 0, left: 28 }}>
          <XAxis dataKey="x" type="number" domain={['dataMin', 'dataMax']} tickFormatter={v => v.toFixed(1)}
                 tick={{ fontSize: 10, fill: 'var(--text-3)' }} stroke="var(--border)" />
          <YAxis dataKey="y" hide />
          <ReferenceArea x1={band.min} x2={band.max} fill="var(--accent)" fillOpacity={0.1}
                         label={{ value: `밴드 ${band.min}~${band.max}`, position: 'insideBottomLeft', fontSize: 10, fill: 'var(--text-3)' }} />
          {marks.map(m => (
            <ReferenceLine key={m.key} x={m.v} stroke={m.color} strokeDasharray={m.dash}
                           label={{ value: `${m.label} ${m.v}`, position: 'top', fontSize: 10, fill: m.color }} />
          ))}
        </ComposedChart>
      </ResponsiveContainer>
      <p style={{ color: 'var(--text-3)', fontSize: 11, margin: 0 }}>과거 연간 PER 밴드(min~max·평균) 대비 현재·forward PER 위치</p>
    </div>
  )
}

// 적정주가 밴드 대비 현재가 위치 게이지 (task#216) — low~high 음영 + 현재가 마커
export function BandGauge({ low, high, price, market }) {
  if (low == null || high == null || price == null || high <= 0) return null
  const lo = Math.min(low, price) * 0.97
  const hi = Math.max(high, price) * 1.03
  const pct = v => Math.max(0, Math.min(100, ((v - lo) / (hi - lo)) * 100))
  return (
    <div style={{ margin: '14px 2px 2px' }}>
      <div style={{ position: 'relative', height: 26 }}>
        <div style={{ position: 'absolute', top: 11, left: 0, right: 0, height: 4, background: 'var(--bg-elev-2)', borderRadius: 2 }} />
        <div style={{ position: 'absolute', top: 11, left: `${pct(low)}%`, width: `${pct(high) - pct(low)}%`, height: 4, background: 'var(--accent)', opacity: 0.35, borderRadius: 2 }} />
        <div title="발행 시점 현재가" style={{ position: 'absolute', top: 6, left: `calc(${pct(price)}% - 7px)`, width: 14, height: 14, borderRadius: '50%', background: 'var(--up)', border: '2.5px solid var(--bg)', boxShadow: '0 0 0 1px var(--up)' }} />
      </div>
      <div className="mono tnum" style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: 'var(--text-3)' }}>
        <span>밴드 하단 {fmtPrice(low, market)}</span>
        <span>상단 {fmtPrice(high, market)}</span>
      </div>
    </div>
  )
}

// 실적 추정 차트 (task#217) — 표 대체. 값·YoY 증감%를 상시 라벨로 병기(FinancialsChart 톤).
export function EstimatesChart({ annual, isKR }) {
  const rows = annual || []
  if (!rows.length) return null
  const pctOf = (c, p) => (c != null && p != null && p !== 0) ? Math.round((c - p) / Math.abs(p) * 1000) / 10 : null
  const data = rows.map((f, i) => {
    const prev = i > 0 ? rows[i - 1] : null
    return {
      period: f.is_consensus ? `${f.period}(E)` : f.period,
      revenue: f.revenue, op: f.operating_income, eps: f.eps,
      rev_pct: pctOf(f.revenue, prev?.revenue),
      op_pct: pctOf(f.operating_income, prev?.operating_income),
      eps_pct: pctOf(f.eps, prev?.eps),
    }
  })
  const hasOp = data.some(d => d.op != null)
  const hasEps = data.some(d => d.eps != null)
  const fmtV = v => fmtAmount(v, isKR)

  // 값(위) + YoY 증감%(아래) 2줄 상시 라벨
  const makeLabel = (valueKey, pctKey, color, fmtFn) => (props) => {
    const { x, y, index } = props
    const row = data[index]
    const v = row?.[valueKey]
    if (v == null || x == null || y == null) return null
    const pct = row?.[pctKey]
    return (
      <g>
        <text x={x} y={y - 17} textAnchor="middle" fontSize={9.5} fontWeight={600} fill={color}>{fmtFn(v)}</text>
        {pct != null && (
          <text x={x} y={y - 7} textAnchor="middle" fontSize={8.5} fill={pct >= 0 ? 'var(--up)' : 'var(--down)'}>
            {pct >= 0 ? '▲+' : '▼'}{pct}%
          </text>
        )}
      </g>
    )
  }

  const legendItem = (color, label) => (
    <span key={label} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
      <span style={{ width: 16, height: 2, background: color, display: 'inline-block', borderRadius: 1 }} />
      <span>{label}</span>
    </span>
  )
  const axisStyle = { fontSize: 10, fill: 'var(--text-3)' }
  const lineCfg = { type: 'monotone', strokeWidth: 2, dot: { r: 3 }, activeDot: { r: 5 }, connectNulls: true, isAnimationActive: false }

  return (
    <div>
      <div style={{ display: 'flex', gap: 12, fontSize: 10, color: 'var(--text-3)', marginBottom: 4 }}>
        {legendItem('var(--data-2)', isKR ? '매출(원)' : '매출($)')}
        {hasOp && legendItem('var(--data-5)', '영업이익')}
      </div>
      <ResponsiveContainer width="100%" height={200}>
        <LineChart data={data} margin={{ top: 30, right: 26, left: 26, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--chart-grid)" />
          <XAxis dataKey="period" tick={axisStyle} axisLine={false} tickLine={false} />
          <YAxis hide domain={['auto', 'auto']} />
          <Line {...lineCfg} dataKey="revenue" name="매출" stroke="var(--data-2)">
            <LabelList content={makeLabel('revenue', 'rev_pct', 'var(--data-2)', fmtV)} />
          </Line>
          {hasOp && (
            <Line {...lineCfg} dataKey="op" name="영업이익" stroke="var(--data-5)">
              <LabelList content={makeLabel('op', 'op_pct', 'var(--data-5)', fmtV)} />
            </Line>
          )}
        </LineChart>
      </ResponsiveContainer>
      {hasEps && (
        <>
          <div style={{ display: 'flex', gap: 12, fontSize: 10, color: 'var(--text-3)', margin: '10px 0 4px' }}>
            {legendItem('var(--data-3)', 'EPS')}
          </div>
          <ResponsiveContainer width="100%" height={130}>
            <LineChart data={data} margin={{ top: 30, right: 26, left: 26, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--chart-grid)" />
              <XAxis dataKey="period" tick={axisStyle} axisLine={false} tickLine={false} />
              <YAxis hide domain={['auto', 'auto']} />
              <Line {...lineCfg} dataKey="eps" name="EPS" stroke="var(--data-3)">
                <LabelList content={makeLabel('eps', 'eps_pct', 'var(--data-3)', v => fmtEps(v, isKR))} />
              </Line>
            </LineChart>
          </ResponsiveContainer>
        </>
      )}
    </div>
  )
}

const numeralStyle = {
  fontFamily: 'var(--font-serif)', fontSize: 26, fontWeight: 700, lineHeight: 1,
  color: 'var(--accent)', opacity: 0.85, flexShrink: 0, width: 38,
}

export default function AnalystReport() {
  const { ticker, date } = useParams()
  const [report, setReport] = useState(null)
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    setError(null)
    api.get(`/api/analyst-reports/${ticker}/${date}`)
      .then(({ data }) => setReport(data))
      .catch((e) => {
        console.error('[AnalystReport] 발행물 조회 실패:', e)
        setError(e.response?.status === 404 ? '발행물을 찾을 수 없습니다.' : '발행물을 불러오지 못했습니다.')
      })
      .finally(() => setLoading(false))
  }, [ticker, date])

  if (loading) return <div style={{ maxWidth: 780, margin: '0 auto', padding: '24px 16px' }}><Skeleton variant="row" count={8} /></div>
  if (error) return (
    <div style={{ maxWidth: 780, margin: '0 auto', padding: '48px 16px', textAlign: 'center', color: 'var(--text-3)' }}>
      <p>{error}</p>
      <Link to="/analyst-reports" style={{ color: 'var(--accent)' }}>← 심층 리포트로 돌아가기</Link>
    </div>
  )

  const d = report.data || {}
  const market = d.market || report.market
  const isKR = market === 'KR'
  const rating = RATING_META[report.rating] || RATING_META.neutral
  const annual = d.financials_annual || []
  const peers = d.competitors || []
  const bandMid = (report.fair_value_low != null && report.fair_value_high != null)
    ? (report.fair_value_low + report.fair_value_high) / 2 : null
  const upside = (bandMid != null && d.price) ? (bandMid / d.price - 1) * 100 : null

  return (
    <div style={{ maxWidth: 780, margin: '0 auto', padding: '20px 16px 64px' }}>
      {/* ── 헤더 ─────────────────────────────────────────── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <span style={{ color: 'var(--text-3)', fontSize: 11, letterSpacing: '0.12em', fontWeight: 600 }}>ANALYST REPORT</span>
        <span className="mono" style={{ color: 'var(--text-3)', fontSize: 12, marginLeft: 'auto' }}>{report.published_date} 발행</span>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', margin: '8px 0 14px' }}>
        <span style={{ fontFamily: 'var(--font-serif)', fontSize: 28, fontWeight: 700, color: 'var(--text)', lineHeight: 1.15 }}>
          {report.name || d.name || ticker}
        </span>
        <span className="mono" style={{ color: 'var(--text-3)', fontSize: 14 }}>{report.ticker}</span>
        <MarketBadge market={market || 'US'} />
        <Badge variant={rating.variant} size="md">{rating.label}</Badge>
      </div>

      <Card padding="md">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 14 }}>
          <Stat size="sm" label="적정주가 밴드"
                value={<span className="tnum">{fmtPrice(report.fair_value_low, market)} ~ {fmtPrice(report.fair_value_high, market)}</span>} />
          <Stat size="sm" label="발행 시점 현재가" value={fmtPrice(d.price, market)} helperText={d.snapshot_date ? `${d.snapshot_date} 스냅샷` : null} />
          <Stat size="sm" label="컨센서스 목표가" value={d.consensus?.target_mean != null ? fmtPrice(d.consensus.target_mean, market) : '—'}
                helperText={d.consensus?.buy != null ? `매수 ${d.consensus.buy} · 보유 ${d.consensus.hold ?? 0} · 매도 ${d.consensus.sell ?? 0}` : null} />
          <Stat size="sm" label="상승여력 (밴드 중앙)" value={upside != null ? `${upside >= 0 ? '+' : ''}${upside.toFixed(1)}%` : '—'}
                valueColor={upside == null ? null : upside >= 0 ? 'up' : 'down'} />
        </div>
        <BandGauge low={report.fair_value_low} high={report.fair_value_high} price={d.price} market={market} />
      </Card>

      {/* ── 한줄 논지 ────────────────────────────────────── */}
      <blockquote style={{ margin: '26px 0 30px', padding: '4px 0 4px 16px', borderLeft: '3px solid var(--accent)' }}>
        <p style={{ fontFamily: 'var(--font-serif)', color: 'var(--text)', fontSize: 22, lineHeight: 1.45, margin: 0, fontWeight: 600 }}>
          {report.title}
        </p>
      </blockquote>

      {/* ── 투자 포인트 ──────────────────────────────────── */}
      <SectionTitle>투자 포인트</SectionTitle>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 30 }}>
        {(report.points || []).map((p, i) => (
          <Card key={i} padding="md">
            <div style={{ display: 'flex', gap: 12 }}>
              <span className="tnum" style={numeralStyle}>{String(i + 1).padStart(2, '0')}</span>
              <div style={{ minWidth: 0 }}>
                <div style={{ color: 'var(--text)', fontWeight: 700, fontSize: 14, marginBottom: 5 }}>{p.title}</div>
                <p style={{ color: 'var(--text-2, var(--text))', fontSize: 13, lineHeight: 1.75, margin: 0, whiteSpace: 'pre-wrap' }}>{p.body}</p>
              </div>
            </div>
          </Card>
        ))}
      </div>

      {/* ── 밸류에이션 ───────────────────────────────────── */}
      <SectionTitle>밸류에이션</SectionTitle>
      <Card padding="md" style={{ marginBottom: 30 }}>
        <p style={{ color: 'var(--text-2, var(--text))', fontSize: 13, lineHeight: 1.75, margin: 0, whiteSpace: 'pre-wrap' }}>{report.valuation_method}</p>
        <PerBandChart band={d.per_band} />
        {peers.length > 0 && (
          <div style={{ overflowX: 'auto', marginTop: 16 }}>
            <table className="tnum" style={{ width: '100%', borderCollapse: 'collapse', minWidth: 430 }}>
              <thead>
                <tr>
                  <th style={{ ...TH, textAlign: 'left' }}>피어 멀티플</th>
                  <th style={TH}>PER</th>
                  <th style={TH}>PBR</th>
                  <th style={TH}>PSR</th>
                  <th style={TH}>EV/EBITDA</th>
                  <th style={TH}>R&D집약도</th>
                </tr>
              </thead>
              <tbody>
                {peers.map((c) => (
                  <tr key={c.ticker} style={c.is_self ? { background: 'var(--bg-elev-2)' } : undefined}>
                    <td style={{ ...TD, textAlign: 'left', fontFamily: 'var(--font-sans, inherit)', color: 'var(--text)', fontWeight: c.is_self ? 700 : 400 }}>
                      {c.name || c.ticker}{c.is_self ? ' ●' : ''}
                    </td>
                    <td style={TD}>{c.per != null ? c.per.toFixed(1) : '—'}</td>
                    <td style={TD}>{c.pbr != null ? c.pbr.toFixed(2) : '—'}</td>
                    <td style={TD}>{c.psr != null ? c.psr.toFixed(2) : '—'}</td>
                    <td style={TD}>{c.ev_ebitda != null ? c.ev_ebitda.toFixed(1) : '—'}</td>
                    <td style={TD}>{c.rd_intensity != null ? `${c.rd_intensity.toFixed(1)}%` : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* ── 실적 추정 (차트 — 값·YoY 증감% 병기, task#217) ── */}
      {annual.length > 0 && (
        <>
          <SectionTitle>실적 추정</SectionTitle>
          <Card padding="md" style={{ marginBottom: 30 }}>
            <EstimatesChart annual={annual} isKR={isKR} />
            <p style={{ color: 'var(--text-3)', fontSize: 11, margin: '8px 0 0' }}>(E) = 컨센서스 추정 · 증감%는 전년 대비 · 발행 시점 스냅샷 기준</p>
          </Card>
        </>
      )}

      {/* ── 리스크 요인 ──────────────────────────────────── */}
      <SectionTitle>리스크 요인</SectionTitle>
      <div style={{ padding: '12px 16px', borderLeft: '3px solid var(--warn)', background: 'var(--warn-soft)', borderRadius: '0 6px 6px 0', marginBottom: 8 }}>
        <p style={{ color: 'var(--text-2, var(--text))', fontSize: 13, lineHeight: 1.75, whiteSpace: 'pre-wrap', margin: 0 }}>{report.risks}</p>
      </div>

      <div style={{ marginTop: 32, paddingTop: 12, borderTop: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
        <Link to="/analyst-reports" style={{ color: 'var(--accent)', fontSize: 13 }}>← 심층 리포트</Link>
        <span style={{ color: 'var(--text-3)', fontSize: 11 }}>본 문서는 발행 시점 데이터로 박제된 판단 문서입니다 · 투자 판단의 책임은 투자자 본인에게 있습니다</span>
      </div>
    </div>
  )
}

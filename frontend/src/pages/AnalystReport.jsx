import { useState, useEffect } from 'react'
import { useParams, Link } from 'react-router-dom'
import { ComposedChart, XAxis, YAxis, ReferenceArea, ReferenceLine, ResponsiveContainer } from 'recharts'
import api from '../api'
import { fmtPrice } from '../utils'
import Badge from '../components/ui/Badge'
import Skeleton from '../components/ui/Skeleton'

// 증권사 리포트식 단일 문서 페이지 (task#212, ADR-0027)
// 헤더 → 한줄 논지 → 투자 포인트 → 밸류에이션(산정방식+PER 밴드+피어 멀티플) → 실적 추정 → 리스크

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

function SectionHead({ children }) {
  return (
    <h3 style={{ fontFamily: 'var(--font-serif)', color: 'var(--text)', fontSize: 16, margin: '28px 0 10px', paddingBottom: 6, borderBottom: '1px solid var(--border)' }}>
      {children}
    </h3>
  )
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
    <div style={{ margin: '10px 0 4px' }}>
      <ResponsiveContainer width="100%" height={86}>
        <ComposedChart data={axisData} margin={{ top: 24, right: 24, bottom: 0, left: 24 }}>
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

const thStyle = { textAlign: 'right', padding: '6px 8px', color: 'var(--text-3)', fontWeight: 500, fontSize: 11, borderBottom: '1px solid var(--border)' }
const tdStyle = { textAlign: 'right', padding: '6px 8px', fontSize: 12, borderBottom: '1px solid var(--border-soft, var(--border))' }

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

  if (loading) return <div style={{ maxWidth: 760, margin: '0 auto', padding: '24px 16px' }}><Skeleton variant="row" count={8} /></div>
  if (error) return (
    <div style={{ maxWidth: 760, margin: '0 auto', padding: '48px 16px', textAlign: 'center', color: 'var(--text-3)' }}>
      <p>{error}</p>
      <Link to="/reports" style={{ color: 'var(--accent)' }}>← 리서치로 돌아가기</Link>
    </div>
  )

  const d = report.data || {}
  const isKR = (d.market || report.market) === 'KR'
  const market = d.market || report.market
  const rating = RATING_META[report.rating] || RATING_META.neutral
  const annual = d.financials_annual || []
  const hasOpIncome = annual.some(f => f.operating_income != null) // US forward 영업이익 null graceful — 전무면 열 생략
  const peers = d.competitors || []

  return (
    <div style={{ maxWidth: 760, margin: '0 auto', padding: '24px 16px 64px' }}>
      {/* 1. 헤더 */}
      <div style={{ borderBottom: '2px solid var(--text)', paddingBottom: 14, marginBottom: 18 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
          <span style={{ fontFamily: 'var(--font-serif)', fontSize: 24, fontWeight: 700, color: 'var(--text)' }}>
            {report.name || d.name || ticker}
          </span>
          <span className="mono" style={{ color: 'var(--text-3)', fontSize: 14 }}>({report.ticker})</span>
          <Badge variant={rating.variant}>{rating.label}</Badge>
          <span className="mono" style={{ color: 'var(--text-3)', fontSize: 12, marginLeft: 'auto' }}>{report.published_date} 발행</span>
        </div>
        <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap', marginTop: 12, fontSize: 13 }}>
          <div>
            <div style={{ color: 'var(--text-3)', fontSize: 11 }}>적정주가 밴드</div>
            <div className="mono tnum" style={{ color: 'var(--text)', fontWeight: 700, fontSize: 16 }}>
              {fmtPrice(report.fair_value_low, market)} ~ {fmtPrice(report.fair_value_high, market)}
            </div>
          </div>
          {d.price != null && (
            <div>
              <div style={{ color: 'var(--text-3)', fontSize: 11 }}>발행 시점 현재가 <span className="mono">({d.snapshot_date})</span></div>
              <div className="mono tnum" style={{ color: 'var(--text)', fontWeight: 700, fontSize: 16 }}>{fmtPrice(d.price, market)}</div>
            </div>
          )}
          {d.consensus?.target_mean != null && (
            <div>
              <div style={{ color: 'var(--text-3)', fontSize: 11 }}>컨센서스 평균 목표가</div>
              <div className="mono tnum" style={{ color: 'var(--text)', fontWeight: 700, fontSize: 16 }}>{fmtPrice(d.consensus.target_mean, market)}</div>
            </div>
          )}
        </div>
      </div>

      {/* 2. 한줄 논지 */}
      <h2 style={{ fontFamily: 'var(--font-serif)', color: 'var(--text)', fontSize: 21, lineHeight: 1.4, margin: '0 0 20px' }}>
        {report.title}
      </h2>

      {/* 3. 투자 포인트 */}
      <SectionHead>투자 포인트</SectionHead>
      {(report.points || []).map((p, i) => (
        <div key={i} style={{ marginBottom: 14 }}>
          <div style={{ color: 'var(--text)', fontWeight: 600, fontSize: 14, marginBottom: 4 }}>
            <span className="mono" style={{ color: 'var(--accent)', marginRight: 6 }}>{String(i + 1).padStart(2, '0')}</span>
            {p.title}
          </div>
          <p style={{ color: 'var(--text-2, var(--text))', fontSize: 13, lineHeight: 1.7, margin: 0, whiteSpace: 'pre-wrap' }}>{p.body}</p>
        </div>
      ))}

      {/* 4. 밸류에이션 */}
      <SectionHead>밸류에이션</SectionHead>
      <p style={{ color: 'var(--text-2, var(--text))', fontSize: 13, lineHeight: 1.7, marginTop: 0, whiteSpace: 'pre-wrap' }}>{report.valuation_method}</p>
      <PerBandChart band={d.per_band} />
      {peers.length > 0 && (
        <div style={{ overflowX: 'auto', marginTop: 14 }}>
          <table className="tnum" style={{ width: '100%', borderCollapse: 'collapse', minWidth: 420 }}>
            <thead>
              <tr>
                <th style={{ ...thStyle, textAlign: 'left' }}>피어</th>
                <th style={thStyle}>PER</th>
                <th style={thStyle}>PBR</th>
                <th style={thStyle}>PSR</th>
                <th style={thStyle}>EV/EBITDA</th>
                <th style={thStyle}>R&D집약도</th>
              </tr>
            </thead>
            <tbody>
              {peers.map((c) => (
                <tr key={c.ticker} style={c.is_self ? { background: 'var(--bg-elev-2)' } : undefined}>
                  <td style={{ ...tdStyle, textAlign: 'left', color: 'var(--text)', fontWeight: c.is_self ? 700 : 400 }}>
                    {c.name || c.ticker}{c.is_self ? ' ●' : ''}
                  </td>
                  <td style={tdStyle}>{c.per != null ? c.per.toFixed(1) : '—'}</td>
                  <td style={tdStyle}>{c.pbr != null ? c.pbr.toFixed(2) : '—'}</td>
                  <td style={tdStyle}>{c.psr != null ? c.psr.toFixed(2) : '—'}</td>
                  <td style={tdStyle}>{c.ev_ebitda != null ? c.ev_ebitda.toFixed(1) : '—'}</td>
                  <td style={tdStyle}>{c.rd_intensity != null ? `${c.rd_intensity.toFixed(1)}%` : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* 5. 실적 추정 테이블 */}
      {annual.length > 0 && (
        <>
          <SectionHead>실적 추정</SectionHead>
          <div style={{ overflowX: 'auto' }}>
            <table className="tnum" style={{ width: '100%', borderCollapse: 'collapse', minWidth: 380 }}>
              <thead>
                <tr>
                  <th style={{ ...thStyle, textAlign: 'left' }}>연도</th>
                  <th style={thStyle}>매출{isKR ? '(원)' : '($)'}</th>
                  {hasOpIncome && <th style={thStyle}>영업이익</th>}
                  <th style={thStyle}>EPS</th>
                  <th style={thStyle}>PER</th>
                </tr>
              </thead>
              <tbody>
                {annual.map((f) => (
                  <tr key={f.period} style={f.is_consensus ? { color: 'var(--accent)' } : undefined}>
                    <td style={{ ...tdStyle, textAlign: 'left' }} className="mono">
                      {f.period}{f.is_consensus ? '(E)' : ''}
                    </td>
                    <td style={tdStyle}>{fmtAmount(f.revenue, isKR)}</td>
                    {hasOpIncome && <td style={tdStyle}>{fmtAmount(f.operating_income, isKR)}</td>}
                    <td style={tdStyle}>{fmtEps(f.eps, isKR)}</td>
                    <td style={tdStyle}>{f.per != null ? f.per.toFixed(1) : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p style={{ color: 'var(--text-3)', fontSize: 11, margin: '6px 0 0' }}>(E) = 컨센서스 추정 · 발행 시점 스냅샷 기준</p>
        </>
      )}

      {/* 6. 리스크 요인 */}
      <SectionHead>리스크 요인</SectionHead>
      <p style={{ color: 'var(--text-2, var(--text))', fontSize: 13, lineHeight: 1.7, whiteSpace: 'pre-wrap', margin: 0 }}>{report.risks}</p>

      <div style={{ marginTop: 32, paddingTop: 12, borderTop: '1px solid var(--border)' }}>
        <Link to="/reports" style={{ color: 'var(--accent)', fontSize: 13 }}>← 리서치로 돌아가기</Link>
      </div>
    </div>
  )
}

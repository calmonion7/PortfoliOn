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

const DRIVER_LABELS = { sp500: 'S&P500', nasdaq: '나스닥', usdkrw: 'USD/KRW', sox: '필라델피아 반도체(SOX)' }

const fmtPct = v => (v == null ? '-' : `${v > 0 ? '+' : ''}${v.toFixed(2)}%`)
const fmtDate = d => (d ? `${parseInt(d.slice(5, 7))}/${parseInt(d.slice(8, 10))}` : '')

// S1 — 신호별 전망 문장 + 근거 한 줄 (날짜는 current.date 기반 — "오늘" 하드코딩 금지, 주말 stale 오표기 방지)
function forecastText(current) {
  const d = fmtDate(current.date)
  const band = current.band
  const bandTxt = band != null ? `±${band.toFixed(2)}%` : '보합권'
  const headline =
    current.signal === 'bullish' ? `${d} 코스피, 상승 우세 전망`
    : current.signal === 'bearish' ? `${d} 코스피, 하락 우세 전망`
    : `${d} 코스피, ${band != null ? `${bandTxt} 이내 ` : ''}보합 예상`
  const comp = fmtPct(current.composite_pct)
  const basis =
    current.signal === 'bullish' ? `밤사이 미국 증시·환율 합성치 ${comp}가 판정밴드 ${bandTxt}를 위로 넘어 상승 신호로 판정했습니다.`
    : current.signal === 'bearish' ? `밤사이 미국 증시·환율 합성치 ${comp}가 판정밴드 ${bandTxt}를 아래로 넘어 하락 신호로 판정했습니다.`
    : `밤사이 미국 증시·환율 합성치 ${comp}가 판정밴드 ${bandTxt} 안에 머물러 중립으로 판정했습니다.`
  return { headline, basis }
}

// S3 — 판정(hit) 표시: 의미 상태라 success/error 토큰 사용 (가격 방향 --up/--down과 구분)
function HitBadge({ hit }) {
  if (hit === true) return <span style={{ color: 'var(--color-success)', fontWeight: 600 }}>✓ 적중</span>
  if (hit === false) return <span style={{ color: 'var(--color-error)', fontWeight: 600 }}>✗ 빗나감</span>
  return <span style={{ color: 'var(--text-3)' }}>대기</span>
}

const TH_STYLE = { fontWeight: 500, color: 'var(--text-3)', padding: '4px 6px', borderBottom: '1px solid var(--border)', whiteSpace: 'nowrap' }
const TD_STYLE = { padding: '4px 6px', borderBottom: '1px solid var(--border)', whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }

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

  const { headline, basis } = forecastText(current)
  const recent = history.slice(-10).reverse()

  return (
    <SectionCard title="코스피 방향 신호" summary={`${label} ${current.composite_pct != null ? current.composite_pct.toFixed(2) : '-'}%`} open={open} onToggle={() => setOpen(o => !o)}>
      {/* S1 — 전망 문장 + 근거 요약 */}
      <div style={{ padding: '12px 14px', border: '1px solid var(--border)', borderLeft: `3px solid ${color}`, borderRadius: 8, marginBottom: 16 }}>
        <div style={{ fontSize: 15, fontWeight: 600, color }}>{headline}</div>
        <div style={{ fontSize: 12, color: 'var(--text-3)', marginTop: 4, lineHeight: 1.5 }}>{basis}</div>
        {stale && <div style={{ fontSize: 10, color: 'var(--text-3)', marginTop: 4 }}>{daysAgo}일 전 신호입니다 (주말·휴장 등)</div>}
      </div>

      <div style={{ display: 'flex', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
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
          <div className="lbl">방향성 적중률 (강세·약세만)</div>
          <div className="v">{hit_rate != null ? `${(hit_rate * 100).toFixed(1)}%` : '-'}</div>
          <div style={{ fontSize: 10, color: 'var(--text-3)', marginTop: 4 }}>
            중립 {neutral?.total ?? 0}건 중 {neutral?.hit ?? 0}건 적중 (별도 집계)
          </div>
        </div>
      </div>

      {/* S3 — 최근 10거래일 예상 vs 실제 판정 표 (휴장일 레코드는 백엔드가 드롭) */}
      {recent.length > 0 && (
        <div style={{ marginBottom: 16, overflowX: 'auto' }}>
          <div className="sub" style={{ fontSize: 12, color: 'var(--text-3)', marginBottom: 6 }}>최근 판정 이력 (최근 {recent.length}거래일)</div>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead>
              <tr>
                <th style={{ ...TH_STYLE, textAlign: 'left' }}>날짜</th>
                <th style={{ ...TH_STYLE, textAlign: 'right' }}>예상 (합성치)</th>
                <th style={{ ...TH_STYLE, textAlign: 'right' }}>기준 (밴드)</th>
                <th style={{ ...TH_STYLE, textAlign: 'right' }}>실제 등락</th>
                <th style={{ ...TH_STYLE, textAlign: 'center' }}>판정</th>
              </tr>
            </thead>
            <tbody>
              {recent.map(h => {
                const sd = SIGNAL_DISPLAY[h.signal] || SIGNAL_DISPLAY.neutral
                const actualColor = h.actual_close_pct > 0 ? 'var(--up)' : h.actual_close_pct < 0 ? 'var(--down)' : 'var(--text-3)'
                return (
                  <tr key={h.date}>
                    <td style={{ ...TD_STYLE, textAlign: 'left', color: 'var(--text-3)' }}>{h.date?.slice(5)}</td>
                    <td style={{ ...TD_STYLE, textAlign: 'right' }}>
                      <span style={{ color: sd.color, fontWeight: 600 }}>{sd.label}</span>
                      <span style={{ color: 'var(--text-3)', marginLeft: 4 }}>{fmtPct(h.composite_pct)}</span>
                    </td>
                    {/* 레거시 레코드(band 미저장)는 백엔드 judge_hit과 동일한 ±0.5% 폴백을 표시 — 실제 적용된 판정기준 미러링 */}
                    <td style={{ ...TD_STYLE, textAlign: 'right', color: 'var(--text-3)' }}>±{(h.band ?? 0.5).toFixed(2)}%</td>
                    <td style={{ ...TD_STYLE, textAlign: 'right', color: h.actual_close_pct != null ? actualColor : 'var(--text-3)' }}>
                      {h.actual_close_pct != null ? fmtPct(h.actual_close_pct) : '—'}
                    </td>
                    <td style={{ ...TD_STYLE, textAlign: 'center' }}><HitBadge hit={h.hit} /></td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

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

      {/* S2 — 판단기준 3항목 (기존 장문 설명문 재구성) */}
      <div style={{ ...DESC_STYLE, marginTop: 16, marginBottom: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
        <div><strong style={{ color: 'var(--text-2)' }}>무엇으로 예측?</strong> 미국 증시 마감(S&P500 ×2 · 나스닥 ×0.5 · 필라델피아 반도체 SOX ×1)과 원/달러 환율(×−0.5, 원화 약세=비우호 역반영)을 가중 합성한 오버나잇 프록시입니다(1년 백테스트 재조정, task#203).</div>
        <div><strong style={{ color: 'var(--text-2)' }}>어떻게 판정?</strong> 합성치가 판정밴드(코스피 20일 변동성 σ×0.5, 매일 갱신)를 넘으면 강세/약세, 그 안이면 중립입니다.</div>
        <div><strong style={{ color: 'var(--text-2)' }}>적중 기준?</strong> 강세·약세는 실제 코스피 등락 부호가 신호와 일치하면, 중립은 실제 등락률이 그날 밴드 이내면 적중입니다. 실제 결과는 다음 배치 때 소급 확정됩니다(표의 "대기").</div>
      </div>
    </SectionCard>
  )
}

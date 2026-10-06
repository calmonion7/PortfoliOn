import Badge from '../ui/Badge'
import Card from '../ui/Card'
import { SectionTitle } from './reportUtils.jsx'
import { GlossaryText } from '../Glossary.jsx'

// 심층 리포트 v2 — 구조 축·9렌즈 틀 (ADR 261006-232406, task#369).
// 순서: 한줄 논지 → 신호 집계 → 렌즈 9개 신호판(번호 순) → 바뀜 조건 → 구조 축 → 렌즈 상세 → (서버 숫자 블록은 호출측)
// 투자의견·적정주가가 없다 — 판단 근거는 렌즈 신호다. 계산 렌즈(3·4·5·8)의 숫자·색·바뀜 조건은 서버가 박제한 값을
// 그대로 그린다(프론트가 재계산하지 않는다 — 출처가 하나여야 같은 상황에 같은 색이 나온다).

// 분기 게이트 — 픽스처가 이 분기를 실제로 타는지 테스트가 직접 단언한다(task#301 교훈).
export const isLensReport = (r) => r?.format === 2 && Array.isArray(r.lenses) && r.lenses.length > 0

export const LENS_NAMES = {
  1: '출처 사슬', 2: '런레이트', 3: '비용 구조', 4: '약정', 5: '생존 위협 경로',
  6: '집중과 전환 비용', 7: '지배구조', 8: '밸류에이션', 9: '수요',
}

// 의미 배지(success/warning/danger) — 가격색(up/down) 교차 사용 금지(frontend/CLAUDE.md). 색만으로 말하지 않게 라벨 병기.
export const SIGNAL_META = {
  go: { label: '초록', variant: 'success', color: 'var(--color-success)' },
  wait: { label: '노랑', variant: 'warning', color: 'var(--warn)' },
  stop: { label: '빨강', variant: 'danger', color: 'var(--color-error)' },
  na: { label: '미산출', variant: 'neutral', color: 'var(--text-3)' },
}
const sig = (s) => SIGNAL_META[s] || SIGNAL_META.na

const AXIS_META = {
  revenue_engine: { title: '수익 엔진', values: { usage: '사용량·구독', volume: '판매량', price_exogenous: '외생 가격', balance_rate: '잔고×금리', transaction: '거래×수수료율' } },
  cost_nature: { title: '비용 성격', values: { fixed: '고정비형', revenue_linked: '매출 연동형' } },
  funding_source: { title: '자금 원천', values: { equity: '자기자본', deposit: '예치금', debt: '차입' } },
}

// 서버 계산값 표시 — 모르는 키는 그리지 않는다(내부 보조값: current_profit·profit_per_pp 등)
const fmt = (v, d = 2) => (v == null || !Number.isFinite(v) ? '—' : Number(v.toFixed(d)).toLocaleString(undefined, { maximumFractionDigits: d }))
const VALUE_META = {
  ratio: { label: '배수비', f: v => fmt(v) },
  numerator_growth_pct: { label: '이익측 증가율', f: v => `${fmt(v, 1)}%` },
  cost_growth_pct: { label: '비용 증가율', f: v => `${fmt(v, 1)}%` },
  marginal_pct: { label: '한계 분배율', f: v => `${fmt(v, 1)}%` },
  average_pct: { label: '평균 분배율', f: v => `${fmt(v, 1)}%` },
  commitment_multiple: { label: '약정 증가 배수', f: v => `${fmt(v)}배` },
  revenue_multiple: { label: '매출 증가 배수', f: v => `${fmt(v)}배` },
  runway_years: { label: '런웨이', f: v => (v == null ? '흑자 — 소진 없음' : `${fmt(v, 1)}년`) },
  breakeven_pct: { label: '손익분기 금리', f: v => `${fmt(v)}%` },
  margin_pp: { label: '손익분기 여유', f: v => `${fmt(v)}%p` },
  marginal_share_pct: { label: '금리 변화분 한계 몫', f: v => `${fmt(v, 1)}%` },
  coverage: { label: '이자보상', f: v => (v == null ? '이자비용 없음' : `${fmt(v, 1)}배`) },
  multiple: { label: '시총 ÷ forward 이익', f: v => (v == null ? '적자 — 배수 없음' : `${fmt(v, 1)}배`) },
  earnings_yield_pct: { label: '이익수익률', f: v => `${fmt(v)}%` },
  risk_free_pct: { label: '무위험 금리', f: v => `${fmt(v)}%` },
}

const INPUT_LABELS = {
  revenue_prev: '매출(직전)', revenue_curr: '매출(현재)', opex_prev: '영업비용(직전)', opex_curr: '영업비용(현재)',
  contribution_prev: '기여몫(직전)', contribution_curr: '기여몫(현재)', fixed_cost_prev: '고정비(직전)', fixed_cost_curr: '고정비(현재)',
  commitment_prev: '약정 연 환산(직전)', commitment_curr: '약정 연 환산(현재)',
  linked_cost_prev: '연동비용(직전)', linked_cost_curr: '연동비용(현재)',
  cash: '현금', annual_burn: '연 소진', operating_income: '영업이익', interest_expense: '이자비용',
  balance: '잔고', current_yield_pct: '현재 수익률', avg_share_pct: '평균 몫',
  rate_sens_revenue: '금리 1%p당 수익 변화', rate_sens_cost: '금리 1%p당 비용 변화',
  other_revenue: '기타 매출', operating_expense: '영업비용', forward_earnings: 'forward 이익',
  risk_free_pct: '무위험 금리', unit_cost: '단위원가', fixed_cost: '고정비',
}

const textStyle = { color: 'var(--text-2, var(--text))', fontSize: 13, lineHeight: 1.7, margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'keep-all', overflowWrap: 'break-word' }
const smallCap = { color: 'var(--text-3)', fontSize: 11 }

function SignalDot({ signal, size = 10 }) {
  return <span aria-hidden="true" style={{ display: 'inline-block', width: size, height: size, borderRadius: '50%', background: sig(signal).color, flexShrink: 0 }} />
}

function Tally({ tally, lenses }) {
  const t = tally || lenses.reduce((a, l) => ({ ...a, [l.signal]: (a[l.signal] || 0) + 1 }), {})
  return (
    <div data-testid="lens-tally" style={{ display: 'flex', flexWrap: 'wrap', gap: 8, margin: '0 0 12px' }}>
      {['go', 'wait', 'stop', 'na'].map(s => (
        <Badge key={s} variant={sig(s).variant} size="md">{sig(s).label} {t[s] || 0}</Badge>
      ))}
    </div>
  )
}

function SignalBoard({ lenses }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 8, marginBottom: 28 }}>
      {lenses.map(l => (
        <a key={l.id} href={`#lens-${l.id}`} data-lens-cell={l.id}
           style={{ display: 'block', textDecoration: 'none', background: 'var(--bg)', border: '1px solid var(--border)', borderLeft: `3px solid ${sig(l.signal).color}`, borderRadius: 6, padding: '8px 10px', minHeight: 44 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span className="mono tnum" style={{ ...smallCap, fontWeight: 700 }}>{l.id}</span>
            <span style={{ color: 'var(--text)', fontSize: 12, fontWeight: 700, minWidth: 0, wordBreak: 'keep-all' }}>{LENS_NAMES[l.id]}</span>
            <span style={{ marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11, color: 'var(--text-2, var(--text))', flexShrink: 0 }}>
              <SignalDot signal={l.signal} />{sig(l.signal).label}
            </span>
          </div>
          <div style={{ color: 'var(--text-2, var(--text))', fontSize: 12, lineHeight: 1.5, marginTop: 4, wordBreak: 'keep-all', overflowWrap: 'break-word' }}>{l.summary}</div>
        </a>
      ))}
    </div>
  )
}

function FlipList({ lenses }) {
  const rows = lenses.filter(l => l.signal !== 'na' && l.flip)
  if (!rows.length) return null
  return (
    <>
      <SectionTitle>바뀜 조건</SectionTitle>
      <ul style={{ listStyle: 'none', margin: '0 0 28px', padding: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
        {rows.map(l => (
          <li key={l.id} style={{ display: 'flex', gap: 8, alignItems: 'baseline', fontSize: 13, lineHeight: 1.6 }}>
            <SignalDot signal={l.signal} size={8} />
            <span style={{ ...smallCap, flexShrink: 0, minWidth: 92 }}>{l.id} {LENS_NAMES[l.id]}</span>
            <span style={{ color: 'var(--text)', minWidth: 0, wordBreak: 'keep-all', overflowWrap: 'break-word' }}>{l.flip}</span>
          </li>
        ))}
      </ul>
    </>
  )
}

function StructureAxes({ structure }) {
  if (!structure) return null
  return (
    <>
      <SectionTitle>구조 축</SectionTitle>
      <Card padding="md" style={{ marginBottom: 28 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {Object.entries(AXIS_META).map(([k, meta]) => {
            const ax = structure[k]
            if (!ax) return null
            return (
              <div key={k} style={{ display: 'grid', gridTemplateColumns: 'minmax(72px, 88px) 1fr', gap: 10, alignItems: 'baseline' }}>
                <span style={smallCap}>{meta.title}</span>
                <div style={{ minWidth: 0 }}>
                  <div style={{ color: 'var(--text)', fontWeight: 700, fontSize: 14 }}>{meta.values[ax.value] || ax.value}</div>
                  <div style={{ ...textStyle, fontSize: 12, color: 'var(--text-3)' }}>{ax.rationale}</div>
                </div>
              </div>
            )
          })}
        </div>
      </Card>
    </>
  )
}

function Metrics({ metrics }) {
  if (!metrics?.length) return null
  return (
    <div style={{ display: 'grid', gridTemplateColumns: `repeat(${metrics.length <= 3 ? metrics.length : 2}, minmax(0, 1fr))`, gap: 8, margin: '8px 0' }}>
      {metrics.map((m, j) => (
        <div key={j} style={{ background: 'var(--bg-elev-2)', borderRadius: 6, padding: '6px 8px' }}>
          <div style={{ color: 'var(--text-3)', fontSize: 10, marginBottom: 3, lineHeight: 1.3 }}><GlossaryText text={m.label} /></div>
          <div className="mono tnum" style={{ color: 'var(--text)', fontWeight: 700, fontSize: 15, lineHeight: 1.15 }}>{m.value}</div>
        </div>
      ))}
    </div>
  )
}

function ComputedBlock({ lens }) {
  const c = lens.computed
  if (!c) return null
  // 표시 순서는 VALUE_META 순서(핵심값 먼저) — 응답 JSON의 키 순서에 기대지 않는다
  const vals = Object.keys(VALUE_META).filter(k => k in (c.values || {})).map(k => [k, c.values[k]])
  const sens = c.values?.sensitivity
  return (
    <div style={{ marginTop: 10, padding: '10px 12px', background: 'var(--bg-elev-2)', borderRadius: 6 }}>
      <div style={{ ...smallCap, marginBottom: 6 }}>서버 계산 (원자료 → 고정 공식)</div>
      {vals.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))', gap: 8 }}>
          {vals.map(([k, v]) => (
            <div key={k}>
              <div style={smallCap}>{VALUE_META[k].label}</div>
              <div className="mono tnum" style={{ color: 'var(--text)', fontWeight: 700, fontSize: 15 }}>{VALUE_META[k].f(v)}</div>
            </div>
          ))}
        </div>
      )}
      {sens?.multiples && (
        <div style={{ marginTop: 10, overflowX: 'auto' }}>
          <div style={{ ...smallCap, marginBottom: 4 }}>
            민감도 — 시총 ÷ 이익(배): 행 {lens.sensitivity?.exogenous?.label || '외생'}{lens.sensitivity?.exogenous?.unit ? ` (${lens.sensitivity.exogenous.unit})` : ''}, 열 {lens.sensitivity?.endogenous?.label || '내생'}{lens.sensitivity?.endogenous?.unit ? ` (${lens.sensitivity.endogenous.unit})` : ''}
          </div>
          <table className="mono tnum" style={{ borderCollapse: 'collapse', fontSize: 11 }}>
            <thead>
              <tr>
                <th style={{ padding: '3px 8px' }} />
                {sens.endogenous.map((e, j) => <th key={j} style={{ padding: '3px 8px', color: 'var(--text-3)', fontWeight: 400, textAlign: 'right' }}>{fmt(e, 1)}</th>)}
              </tr>
            </thead>
            <tbody>
              {sens.multiples.map((row, i) => (
                <tr key={i}>
                  <th style={{ padding: '3px 8px', color: 'var(--text-3)', fontWeight: 400, textAlign: 'right' }}>{fmt(sens.exogenous[i], 2)}</th>
                  {row.map((m, j) => <td key={j} style={{ padding: '3px 8px', textAlign: 'right', color: 'var(--text)' }}>{m == null ? '—' : String(m)}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {c.risk_free_source && <div style={{ ...smallCap, marginTop: 6 }}>무위험 금리 출처: {c.risk_free_source === 'input' ? '원자료' : '서버 캐시(미 10년물)'}</div>}
    </div>
  )
}

function InputsTable({ inputs }) {
  const rows = Object.entries(inputs || {})
  if (!rows.length) return null
  return (
    <details style={{ marginTop: 8 }}>
      <summary style={{ ...smallCap, cursor: 'pointer', minHeight: 32, display: 'flex', alignItems: 'center' }}>원자료 {rows.length}건 — 출처</summary>
      <ul style={{ listStyle: 'none', margin: '6px 0 0', padding: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
        {rows.map(([k, r]) => (
          <li key={k} style={{ fontSize: 12, lineHeight: 1.5 }}>
            <span style={{ color: 'var(--text-2, var(--text))' }}>{INPUT_LABELS[k] || k}</span>{' '}
            <span className="mono tnum" style={{ color: 'var(--text)', fontWeight: 700 }}>{fmt(r.value, 3)} {r.unit}</span>{' '}
            <Badge variant={r.source === 'estimate' ? 'warning' : 'neutral'}>{r.source === 'estimate' ? '추정' : '공시'}</Badge>{' '}
            <span style={smallCap}>{r.ref}</span>
            {r.rationale && <div style={{ ...smallCap, wordBreak: 'keep-all', overflowWrap: 'break-word' }}>{r.rationale}</div>}
          </li>
        ))}
      </ul>
    </details>
  )
}

function LensDetail({ lens }) {
  const m = sig(lens.signal)
  return (
    <Card padding="md" id={`lens-${lens.id}`} style={{ scrollMarginTop: 80, borderLeft: `3px solid ${m.color}` }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <span className="mono tnum" style={{ fontFamily: 'var(--font-serif)', fontSize: 22, fontWeight: 700, color: 'var(--accent)', lineHeight: 1 }}>{lens.id}</span>
        <span style={{ color: 'var(--text)', fontWeight: 700, fontSize: 14 }}>{LENS_NAMES[lens.id]}</span>
        <Badge variant={m.variant}>{m.label}</Badge>
        {lens.computed?.estimate_based && <Badge variant="warning">추정 기반</Badge>}
      </div>
      <div style={{ color: 'var(--text)', fontWeight: 600, fontSize: 13, margin: '8px 0 4px', wordBreak: 'keep-all', overflowWrap: 'break-word' }}>{lens.summary}</div>
      <Metrics metrics={lens.metrics} />
      <p style={textStyle}><GlossaryText text={lens.body} /></p>
      {lens.signal === 'na' && lens.na_reason && (
        <p style={{ ...textStyle, marginTop: 8, color: 'var(--text-3)' }}>미산출 사유: <span>{lens.na_reason}</span></p>
      )}
      {lens.signal !== 'na' && lens.flip && (
        <p style={{ ...textStyle, marginTop: 8 }}><span style={smallCap}>바뀜 조건 </span><span>{lens.flip}</span></p>
      )}
      <ComputedBlock lens={lens} />
      <InputsTable inputs={lens.inputs} />
    </Card>
  )
}

export default function LensReport({ report }) {
  const lenses = [...report.lenses].sort((a, b) => a.id - b.id)
  return (
    <>
      <blockquote style={{ margin: '18px 0 22px', padding: '4px 0 4px 16px', borderLeft: '3px solid var(--accent)' }}>
        <p style={{ fontFamily: 'var(--font-serif)', color: 'var(--text)', fontSize: 22, lineHeight: 1.45, margin: 0, fontWeight: 600, wordBreak: 'keep-all', overflowWrap: 'break-word' }}>
          {report.title}
        </p>
      </blockquote>

      <SectionTitle>렌즈 신호</SectionTitle>
      <Tally tally={report.tally} lenses={lenses} />
      <SignalBoard lenses={lenses} />
      <FlipList lenses={lenses} />
      <StructureAxes structure={report.structure} />

      <SectionTitle>렌즈 상세</SectionTitle>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 30 }}>
        {lenses.map(l => <LensDetail key={l.id} lens={l} />)}
      </div>
    </>
  )
}

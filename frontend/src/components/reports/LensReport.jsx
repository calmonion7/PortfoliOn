import { useLayoutEffect, useRef, useState } from 'react'
import Badge from '../ui/Badge'
import Card from '../ui/Card'
import { SectionTitle } from './reportUtils.jsx'
import { GlossaryText, GlossaryTerm } from '../Glossary.jsx'

// 심층 리포트 v2 — 구조 축·9렌즈 틀 (ADR 261006-232406, task#369).
// 순서: 한줄 논지 → 렌즈 신호(집계 + 렌즈별 신호·바뀜 조건 게이지 한 행, 번호 순) → 구조 축 → 렌즈 상세 → (서버 숫자 블록은 호출측)
// 투자의견·적정주가가 없다 — 판단 근거는 렌즈 신호다. 계산 렌즈(3·4·5·8)의 숫자·색·바뀜 조건은 서버가 박제한 값을
// 그대로 그린다(프론트가 재계산하지 않는다 — 출처가 하나여야 같은 상황에 같은 색이 나온다).

// 분기 게이트 — 픽스처가 이 분기를 실제로 타는지 테스트가 직접 단언한다(task#301 교훈).
export const isLensReport = (r) => r?.format === 2 && Array.isArray(r.lenses) && r.lenses.length > 0

// 렌즈 화면 표시명(일반인 말) + 「이 렌즈가 묻는 것」 — 두 렌더 위치(신호 행·상세 헤더)가 같은 소스를 읽는다(task#372).
// 루틴 프롬프트·API 문서는 전문 이름을 유지한다(렌즈는 번호로 식별).
export const LENS_INFO = {
  1: { name: '숫자의 신뢰도', question: '이 숫자는 몇 번 가공된 건가, 믿을 만한가' },
  2: { name: '지금 매출 속도', question: '최근 분기 기준으로 지금 얼마나 버는가' },
  3: { name: '벌수록 남는 구조', question: '매출이 늘 때 비용이 덜 느는가' },
  4: { name: '묶여 있는 비용', question: '매출과 함께 떼 주거나 미리 약속한 지출이 얼마나 빨리 느는가' },
  5: { name: '망할 위험', question: '현금·금리·이자 부담으로 버틸 수 있는가' },
  6: { name: '고객 이탈 위험', question: '큰 고객에 몰려 있는가, 쉽게 떠날 수 있는가' },
  7: { name: '경영진·대주주', question: '주주와 이해가 맞는 사람들이 운영하는가' },
  8: { name: '지금 주가 수준', question: '미래 이익에 비해 비싼가 싼가' },
  9: { name: '앞으로의 수요', question: '이 제품을 앞으로 얼마나 더 살 것인가' },
}

// 「?」 — 기존 용어집 팝오버를 재사용(새 팝오버 신설 금지). 제목 = 렌즈 이름, 본문 = 이 렌즈가 묻는 것.
function LensHelp({ id }) {
  const info = LENS_INFO[id]
  if (!info) return null
  return (
    <GlossaryTerm entry={{ term: info.name, def: info.question }} className="lens-help" ariaLabel={`${info.name} — 설명 보기`}>
      <span className="lens-help-dot" aria-hidden="true">?</span>
    </GlossaryTerm>
  )
}

// 렌즈 3 비교 기간(task#371 박제값) — 없으면(옛 판) 표기하지 않는다
const BASIS_LABEL = { forward: '향후 기간 vs 전년 동기', yoy_quarter: '최근 분기 vs 전년 동기' }
// 원자료 출처 셋 — 공시 · 애널 추정치 · 루틴 자체 추정
const SOURCE_META = { disclosure: { label: '공시', variant: 'neutral' }, consensus: { label: '애널 추정치', variant: 'info' }, estimate: { label: '추정', variant: 'warning' } }

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

// 바뀜 조건 게이지 — 서버가 박제한 구간(낮은 값 → 높은 값)·경계·현재값을 그리기만 한다.
// 문턱을 여기서 다시 정의하지 않는다(정의하면 화면 색 구간과 박제된 신호가 갈라질 수 있다).
const gfmt = (v, unit) => {
  const a = Math.abs(v)
  const s = a >= 1000 ? Math.round(v).toLocaleString() : a >= 100 ? v.toFixed(1) : v.toFixed(2)
  return unit === '%' ? `${s}%` : unit === '배' ? `${s}배` : unit ? `${s} ${unit}` : s
}
// 라벨이 트랙 끝에서 잘리지 않게 — 양 끝 근처는 그쪽 끝에 붙인다
const anchor = (pct) => (pct < 12 ? 'translateX(0)' : pct > 88 ? 'translateX(-100%)' : 'translateX(-50%)')

// 게이지 출처 — 계산 렌즈는 서버 공식, 판단 렌즈는 루틴이 정한 경계(같은 모양이어도 무게가 다르다)
const ORIGIN_LABEL = { server: '서버 계산', routine: '루틴 판단' }

export function FlipGauge({ gauge, signal, origin }) {
  // 경계 라벨 겹침은 **실측**으로 판정한다(task#373) — 아래 28% 고정 문턱은 m390 기준(라벨 ≈ 트랙 23%)이라,
  // 트랙이 좁거나(m278: 라벨 67px ÷ 트랙 178px = 37%) 단위가 긴 금액 라벨에서 두 라벨이 그대로 겹쳤다.
  // 가로 겹침만 보므로 아랫줄로 내린 뒤에도 판정이 유지된다(깜빡임 없음). jsdom은 rect가 0이라 판정하지 않는다.
  const labelsRef = useRef(null)
  const [overlapStagger, setOverlapStagger] = useState(false)
  useLayoutEffect(() => {
    const measure = () => {
      const rs = [...(labelsRef.current?.querySelectorAll('[data-boundary]') || [])].map(e => e.getBoundingClientRect())
      setOverlapStagger(rs.some((a, i) => i > 0 && a.width > 0 && a.left < rs[i - 1].right + 4))
    }
    measure()
    window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
  }, [gauge])
  const { variable, unit, current, boundaries = [], zones = [], current_ref: currentRef } = gauge || {}
  if (!gauge || !Number.isFinite(current) || zones.length !== boundaries.length + 1) return null
  const vals = [current, ...boundaries]
  const lo = Math.min(...vals), hi = Math.max(...vals)
  const span = (hi - lo) || Math.abs(hi) || 1
  const d0 = lo - span * 0.35, d1 = hi + span * 0.35
  const pct = (v) => Math.max(0, Math.min(100, ((v - d0) / (d1 - d0)) * 100))
  const edges = [d0, ...boundaries, d1]
  const curZone = zones[boundaries.filter(b => current >= b).length]
  // 경계 라벨이 서로 가까우면(트랙 폭의 28% 미만 — 금액 라벨 「1,100 USD M」이 m390 트랙의 ~23%다) 다음 라벨을 아랫줄로 — 좁은 폭에서 「53.52%63.52%」처럼 붙는 것을 막는다
  const rows = boundaries.map((b, i) => (i > 0 && (overlapStagger || pct(b) - pct(boundaries[i - 1]) < 28) ? 1 : 0))
  const staggered = rows.some(r => r === 1)
  const ranges = zones.map((z, i) => {
    const from = i === 0 ? null : boundaries[i - 1], to = i === zones.length - 1 ? null : boundaries[i]
    const r = from == null ? `${gfmt(to, unit)} 미만` : to == null ? `${gfmt(from, unit)} 이상` : `${gfmt(from, unit)}~${gfmt(to, unit)}`
    return `${sig(z).label} ${r}`
  })
  return (
    <div data-flip-gauge="" data-current-zone={curZone} data-origin={origin} role="img"
         aria-label={`${variable} 현재 ${gfmt(current, unit)} — ${ranges.join(', ')} (${ORIGIN_LABEL[origin] || ''})`}
         style={{ margin: '10px 0 2px' }}>
      <div style={{ ...smallCap, marginBottom: 2, display: 'flex', gap: 8, alignItems: 'baseline', flexWrap: 'wrap' }}>
        <span>{variable}{unit && unit !== '%' && unit !== '배' ? ` (${unit})` : ''}</span>
        {/* 경계 근접(task#371 서버 박제) — 현재값이 경계 폭의 10% 안: 작은 변화로 색이 바뀔 수 있다 */}
        {gauge.near_boundary === true && <span data-near-boundary="" style={{ fontSize: 10, fontWeight: 700, color: 'var(--warn)', border: '1px solid var(--warn)', borderRadius: 4, padding: '0 5px' }}>경계 근접</span>}
        {ORIGIN_LABEL[origin] && <span style={{ marginLeft: 'auto', fontSize: 10, color: 'var(--text-3)', border: '1px solid var(--border)', borderRadius: 4, padding: '0 5px' }}>{ORIGIN_LABEL[origin]}</span>}
      </div>
      <div style={{ position: 'relative', height: 44 }}>
        {/* 현재값 라벨 */}
        <span className="mono tnum" style={{ position: 'absolute', top: 0, left: `${pct(current)}%`, transform: anchor(pct(current)), fontSize: 11, fontWeight: 700, color: 'var(--text)', whiteSpace: 'nowrap' }}>
          현재 {gfmt(current, unit)}
        </span>
        {/* 색 구간 */}
        {zones.map((z, i) => (
          <span key={i} data-zone={z} style={{ position: 'absolute', top: 20, height: 8, left: `${pct(edges[i])}%`, width: `${pct(edges[i + 1]) - pct(edges[i])}%`,
                                               background: sig(z).color, opacity: z === curZone ? 0.9 : 0.35,
                                               borderRadius: i === 0 ? '4px 0 0 4px' : i === zones.length - 1 ? '0 4px 4px 0' : 0 }} />
        ))}
        {/* 경계 눈금 */}
        {boundaries.map((b, i) => (
          <span key={i} aria-hidden="true" style={{ position: 'absolute', top: 17, height: 14, width: 1.5, left: `${pct(b)}%`, background: 'var(--text-2, var(--text))' }} />
        ))}
        {/* 현재값 마커 */}
        <span aria-hidden="true" style={{ position: 'absolute', top: 17, left: `calc(${pct(current)}% - 7px)`, width: 14, height: 14, borderRadius: '50%',
                                          background: sig(signal).color, border: '2.5px solid var(--bg)', boxShadow: `0 0 0 1px ${sig(signal).color}` }} />
      </div>
      <div ref={labelsRef} style={{ position: 'relative', height: staggered ? 32 : 16 }}>
        {boundaries.map((b, i) => (
          <span key={i} data-boundary="" className="mono tnum" style={{ position: 'absolute', top: rows[i] * 16,  /* 줄 상자 15px보다 커야 위아래 라벨이 겹치지 않는다 */ left: `${pct(b)}%`, transform: anchor(pct(b)), fontSize: 10, color: 'var(--text-3)', whiteSpace: 'nowrap' }}>
            {gfmt(b, unit)}
          </span>
        ))}
      </div>
      {currentRef && <div style={{ ...smallCap, fontSize: 10 }}>현재값 출처: {currentRef}</div>}
    </div>
  )
}

// 판단 렌즈의 비수치형 바뀜 조건 — 세 색 각각의 조건(게이지의 세 구간과 같은 레벨, 사람 UAT 피드백 3).
// 지금 색의 항목은 현재 상태를 말하므로 게이지의 현재 구간처럼 강조한다. 옛 키 `to`(세 색 규칙 이전)도 읽는다.
const COLOR_ORDER = ['go', 'wait', 'stop']
function FlipConditions({ conditions, signal }) {
  const items = [...conditions].map(c => ({ ...c, color: c.color ?? c.to }))
    .sort((a, b) => COLOR_ORDER.indexOf(a.color) - COLOR_ORDER.indexOf(b.color))
  return (
    <div data-flip-conditions="" style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 8 }}>
      {items.map((c, i) => {
        const cur = c.color === signal
        return (
          <div key={i} data-condition={c.color} data-current={String(cur)}
               style={{ fontSize: 12, lineHeight: 1.5, padding: '6px 8px', borderRadius: 6,
                        borderLeft: `3px solid ${sig(c.color).color}`,
                        background: cur ? 'var(--bg-elev-2)' : 'transparent', opacity: cur ? 1 : 0.85 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
              <SignalDot signal={c.color} size={8} />
              <span style={{ color: 'var(--text)', fontWeight: 700 }}>
                {cur ? `현재 ${sig(c.color).label}` : `${sig(c.color).label}으로 바뀌는 조건`}
              </span>
              {/* 지금 색 항목은 조건이 아니라 현재 상태의 근거다 */}
              <span style={smallCap}>{cur ? '근거' : c.match === 'any' ? '하나라도 확인되면' : (c.when.length > 1 ? '모두 확인되면' : '확인되면')}</span>
            </div>
            <ul style={{ margin: '2px 0 0', paddingLeft: 22, color: 'var(--text-2, var(--text))' }}>
              {c.when.map((w, j) => <li key={j} style={{ wordBreak: 'keep-all', overflowWrap: 'break-word' }}>{w}</li>)}
            </ul>
          </div>
        )
      })}
    </div>
  )
}

// 렌즈 신호 + 바뀜 조건을 한 행에(task#369 UAT 피드백): 번호·이름·신호 → 요약 → 게이지(수치형) 또는 조건 목록(비수치형) 또는 문장(구조화 이전)
function SignalList({ lenses }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 28 }}>
      {lenses.map(l => {
        // 바뀜 조건 표시 규칙(사람 UAT 피드백 2): 수치면 게이지(계산 렌즈 = 서버, 판단 렌즈 = 루틴), 아니면 조건 목록,
        // 둘 다 없는 구조화 이전 데이터는 문장 폴백
        const g = l.computed?.gauge ?? l.gauge
        const origin = g?.origin ?? (l.computed?.gauge ? 'server' : 'routine')
        const conds = !g && l.conditions?.length ? l.conditions : null
        return (
          <div key={l.id} data-lens-cell={l.id}
               style={{ background: 'var(--bg)', border: '1px solid var(--border)', borderLeft: `3px solid ${sig(l.signal).color}`, borderRadius: 6, padding: '10px 12px' }}>
            {/* 「?」 버튼은 링크 밖에 둔다 — 링크 안의 버튼은 대화형 요소 중첩이고, 탭이 상세로 이동해 버린다 */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 2, minHeight: 32 }}>
              <a href={`#lens-${l.id}`} data-lens-name={l.id} style={{ display: 'flex', alignItems: 'center', gap: 6, textDecoration: 'none', minWidth: 0, minHeight: 32 }}>
                <span className="mono tnum" style={{ ...smallCap, fontWeight: 700 }}>{l.id}</span>
                <span style={{ color: 'var(--text)', fontSize: 13, fontWeight: 700, minWidth: 0, wordBreak: 'keep-all', overflowWrap: 'break-word' }}>{LENS_INFO[l.id]?.name}</span>
              </a>
              <LensHelp id={l.id} />
              <span style={{ marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 12, color: 'var(--text-2, var(--text))', flexShrink: 0 }}>
                <SignalDot signal={l.signal} />{sig(l.signal).label}
              </span>
            </div>
            <div style={{ color: 'var(--text-2, var(--text))', fontSize: 12.5, lineHeight: 1.55, marginTop: 4, wordBreak: 'keep-all', overflowWrap: 'break-word' }}>{l.summary}</div>
            {l.signal !== 'na' && g && <FlipGauge gauge={g} signal={l.signal} origin={origin} />}
            {l.signal !== 'na' && conds && <FlipConditions conditions={conds} signal={l.signal} />}
            {l.signal !== 'na' && l.flip && !conds && (
              <div style={{ fontSize: 12, lineHeight: 1.5, marginTop: 6, wordBreak: 'keep-all', overflowWrap: 'break-word' }}>
                <span style={smallCap}>바뀜 조건 </span><span style={{ color: 'var(--text)' }}>{l.flip}</span>
              </div>
            )}
            {l.signal === 'na' && l.na_reason && (
              <div style={{ ...smallCap, marginTop: 6 }}>미산출 사유: {l.na_reason}</div>
            )}
          </div>
        )
      })}
    </div>
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
      {BASIS_LABEL[c.basis] && <div data-lens-basis={c.basis} style={{ ...smallCap, marginBottom: 6 }}>비교 기간: <span style={{ color: 'var(--text)', fontWeight: 700 }}>{BASIS_LABEL[c.basis]}</span></div>}
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
            <Badge variant={(SOURCE_META[r.source] || SOURCE_META.disclosure).variant}>{(SOURCE_META[r.source] || SOURCE_META.disclosure).label}</Badge>{' '}
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
        <span style={{ display: 'inline-flex', alignItems: 'center' }}>
          <span data-lens-detail-name={lens.id} style={{ color: 'var(--text)', fontWeight: 700, fontSize: 14, wordBreak: 'keep-all' }}>{LENS_INFO[lens.id]?.name}</span>
          <LensHelp id={lens.id} />
        </span>
        <Badge variant={m.variant}>{m.label}</Badge>
        {lens.computed?.estimate_based && <Badge variant="warning">추정 기반</Badge>}
        {/* 애널 추정치(task#371) — 루틴 자체 추정과 별개, 둘 다면 둘 다 */}
        {lens.computed?.consensus_based && <Badge variant="info">애널 추정치</Badge>}
      </div>
      <div style={{ color: 'var(--text)', fontWeight: 600, fontSize: 13, margin: '8px 0 4px', wordBreak: 'keep-all', overflowWrap: 'break-word' }}>{lens.summary}</div>
      <Metrics metrics={lens.metrics} />
      <p style={textStyle}><GlossaryText text={lens.body} /></p>
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
      <SignalList lenses={lenses} />
      <StructureAxes structure={report.structure} />

      <SectionTitle>렌즈 상세</SectionTitle>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 30 }}>
        {lenses.map(l => <LensDetail key={l.id} lens={l} />)}
      </div>
    </>
  )
}

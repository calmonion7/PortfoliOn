import { fmtPrice as fmt } from '../../utils'
import { TH, TD } from './reportUtils.jsx'

function decodeHtml(str) {
  if (!str) return str
  const txt = document.createElement('textarea')
  txt.innerHTML = str
  return txt.value
}

export function ReportSectionText({ title, text }) {
  if (!text) return null
  return (
    <div style={{ marginBottom: 20 }}>
      <div style={{ fontWeight: 600, fontSize: 13, color: 'var(--accent)', marginBottom: 8 }}>{title}</div>
      <p style={{ fontSize: 13, color: 'var(--text)', lineHeight: 1.8, margin: 0, whiteSpace: 'pre-wrap' }}>{text}</p>
    </div>
  )
}

export function ReportSectionCompetitors({ competitors, market, ticker }) {
  if (!competitors?.length) return null
  const fmtMC = (mc) => {
    if (mc == null) return '—'
    if (market === 'KR') {
      if (mc >= 1e12) return `${(mc / 1e12).toFixed(1)}조`
      if (mc >= 1e8) return `${(mc / 1e8).toFixed(0)}억`
      return `${(mc / 1e4).toFixed(0)}만`
    }
    if (mc >= 1e12) return `${(mc / 1e12).toFixed(1)}T`
    if (mc >= 1e9) return `${(mc / 1e9).toFixed(1)}B`
    return `${(mc / 1e6).toFixed(0)}M`
  }
  return (
    <div style={{ marginBottom: 20 }}>
      <div style={{ fontWeight: 600, fontSize: 13, color: 'var(--accent)', marginBottom: 8 }}>🏢 사업영역 & 시장순위</div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 8 }}>
        {competitors.map((c, i) => {
          const isSelf = c.is_self || c.ticker === ticker
          const ytdPos = c.ytd_return != null && c.ytd_return >= 0
          const ytdColor = c.ytd_return != null ? (ytdPos ? 'var(--up)' : 'var(--down)') : 'var(--text-3)'
          const mcStr = c.market_cap ? (market === 'KR' ? `₩${fmtMC(c.market_cap)}` : `$${fmtMC(c.market_cap)}`) : '—'
          const rankColor = i === 0 ? '#F59E0B' : i === 1 ? '#94A3B8' : i === 2 ? '#C07842' : 'var(--border)'
          return (
            <div key={i} style={{
              background: isSelf ? 'var(--bg-elev-2)' : 'var(--bg-elev)',
              borderRadius: 10,
              padding: '10px 14px',
              borderLeft: `3px solid ${rankColor}`,
              display: 'flex',
              flexDirection: 'column',
              gap: 6,
            }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 7, minWidth: 0 }}>
                  <span style={{ fontSize: 11, fontWeight: 800, color: rankColor, flexShrink: 0, minWidth: 12 }}>{i + 1}</span>
                  <span style={{ fontWeight: isSelf ? 700 : 600, fontSize: 13, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {c.name || c.ticker}
                  </span>
                  {isSelf && <span style={{ fontSize: 9, color: 'var(--accent)', background: 'color-mix(in srgb, var(--accent) 15%, transparent)', padding: '2px 6px', borderRadius: 4, flexShrink: 0, fontWeight: 700, letterSpacing: '0.02em' }}>기준</span>}
                </div>
                <span style={{ fontSize: 11, color: 'var(--text-3)', flexShrink: 0, fontWeight: 500 }}>{c.ticker}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingLeft: 19 }}>
                <span style={{ fontSize: 12, color: 'var(--text-2)' }}>{fmt(c.price, market)}</span>
                <span style={{ fontSize: 11, color: 'var(--text-3)' }}>{mcStr}</span>
                <span style={{ fontSize: 12, color: ytdColor, fontWeight: 700 }}>
                  {c.ytd_return != null ? `${ytdPos ? '+' : ''}${c.ytd_return.toFixed(1)}%` : '—'}
                </span>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

export function ReportSectionNews({ disclosures, news }) {
  return (
    <div style={{ marginBottom: 20 }}>
      <div style={{ fontWeight: 600, fontSize: 13, color: 'var(--accent)', marginBottom: 8 }}>📰 최근 공시 & 뉴스</div>
      {disclosures && (
        <p style={{ fontSize: 13, color: 'var(--text)', lineHeight: 1.8, margin: '0 0 10px' }}>{disclosures}</p>
      )}
      {news?.length > 0 ? (
        <ul style={{ margin: 0, padding: '0 0 0 16px', fontSize: 12, lineHeight: 1.8 }}>
          {news.map((item, i) => (
            <li key={i}>
              <a href={item.link} target="_blank" rel="noreferrer"
                 style={{ color: 'var(--accent)', textDecoration: 'none' }}>{decodeHtml(item.title)}</a>
              <span style={{ color: 'var(--text-3)', marginLeft: 6 }}>
                — {item.publisher} ({item.published_at})
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p style={{ color: 'var(--text-3)', fontSize: 12 }}>_(뉴스 없음)_</p>
      )}
    </div>
  )
}

// ── 구조화 데이터 섹션 (신규 스키마, 레거시 string 폴백 포함) ──────────────────

const _FACTOR_LINE = { paddingLeft: 12, borderLeft: '2px solid var(--border)', marginBottom: 0 }
const _FACTOR_TITLE = { fontSize: 12, fontWeight: 600, color: 'var(--text)', marginBottom: 2 }
const _FACTOR_DESC = { fontSize: 12, color: 'var(--text-2)', lineHeight: 1.6 }
const _CHIP = (color) => ({ fontSize: 10, fontWeight: 700, padding: '1px 6px', borderRadius: 3, background: 'var(--bg-elev-2)', color })

export function MoatSection({ moat }) {
  if (!moat) return null
  if (typeof moat === 'string') return <ReportSectionText title="🏰 경제적 해자" text={moat} />

  const RATING = {
    wide:   { label: 'Wide Moat',   color: 'var(--color-success)' },
    narrow: { label: 'Narrow Moat', color: 'var(--warn)' },
    none:   { label: 'No Moat',     color: 'var(--color-error)' },
  }
  const rc = RATING[moat.rating] || { label: moat.rating || '', color: 'var(--text-3)' }

  return (
    <div style={{ marginBottom: 20 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        <span style={{ fontWeight: 600, fontSize: 13, color: 'var(--accent)' }}>🏰 경제적 해자</span>
        {moat.rating && <span style={_CHIP(rc.color)}>{rc.label}</span>}
        {moat.rating_source && <span style={{ fontSize: 10, color: 'var(--text-3)' }}>by {moat.rating_source}</span>}
      </div>
      {moat.summary && <p style={{ fontSize: 13, color: 'var(--text)', lineHeight: 1.7, margin: '0 0 10px' }}>{moat.summary}</p>}
      {moat.factors?.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {moat.factors.map((f, i) => (
            <div key={i} style={_FACTOR_LINE}>
              <div style={_FACTOR_TITLE}>{f.title}</div>
              <div style={_FACTOR_DESC}>{f.description}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

const STATUS_CFG = {
  launched:  { label: '출시',    color: 'var(--color-success)' },
  phase3:    { label: '3단계', color: 'var(--color-info)' },
  phase2:    { label: '2단계', color: 'var(--data-2)' },
  announced: { label: '발표',    color: 'var(--warn)' },
  completed: { label: '완료',    color: 'var(--text-3)' },
}

export function GrowthPlanSection({ growth_plan }) {
  if (!growth_plan) return null
  if (typeof growth_plan === 'string') return <ReportSectionText title="🌱 장기 성장 계획" text={growth_plan} />

  return (
    <div style={{ marginBottom: 20 }}>
      <div style={{ fontWeight: 600, fontSize: 13, color: 'var(--accent)', marginBottom: 8 }}>🌱 장기 성장 계획</div>
      {growth_plan.strategy && (
        <p style={{ fontSize: 13, color: 'var(--text)', lineHeight: 1.7, margin: '0 0 10px' }}>{growth_plan.strategy}</p>
      )}
      {growth_plan.initiatives?.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {growth_plan.initiatives.map((item, i) => {
            const sc = STATUS_CFG[item.status] || {}
            return (
              <div key={i} style={_FACTOR_LINE}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
                  <span style={_FACTOR_TITLE}>{item.title}</span>
                  {(item.label || item.status) && <span style={_CHIP(sc.color || 'var(--text-3)')}>{item.label || sc.label || item.status}</span>}
                  {item.timeline && <span style={{ fontSize: 10, color: 'var(--text-3)' }}>{item.timeline}</span>}
                </div>
                <div style={_FACTOR_DESC}>{item.description}</div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

const SEVERITY_CFG = {
  high:   'var(--color-error)',
  medium: 'var(--warn)',
  low:    'var(--color-info)',
}

export function RisksSection({ risks }) {
  if (!risks) return null
  if (typeof risks === 'string') return <ReportSectionText title="⚠️ 리스크" text={risks} />

  return (
    <div style={{ marginBottom: 20 }}>
      <div style={{ fontWeight: 600, fontSize: 13, color: 'var(--accent)', marginBottom: 8 }}>⚠️ 리스크</div>
      {risks.factors?.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {risks.factors.map((f, i) => {
            const borderColor = SEVERITY_CFG[f.severity] || 'var(--border)'
            return (
              <div key={i} style={{ ...(_FACTOR_LINE), borderLeft: `2px solid ${borderColor}` }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
                  {f.category && <span style={_CHIP(borderColor)}>{f.category}</span>}
                  <span style={_FACTOR_TITLE}>{f.title}</span>
                </div>
                <div style={_FACTOR_DESC}>{f.description}</div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

const IMPACT_COLOR = { positive: 'var(--color-success)', negative: 'var(--color-error)', neutral: 'var(--text-3)' }

export function RecentDisclosuresSection({ disclosures, news }) {
  if (!disclosures || typeof disclosures === 'string') {
    return <ReportSectionNews disclosures={disclosures} news={news} />
  }

  const vsColor = (s) => !s ? 'var(--text-3)' : s.startsWith('+') ? 'var(--up)' : s.startsWith('-') ? 'var(--down)' : 'var(--text-3)'

  return (
    <div style={{ marginBottom: 20 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
        <span style={{ fontWeight: 600, fontSize: 13, color: 'var(--accent)' }}>📰 최근 공시 & 뉴스</span>
        {disclosures.period && <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 4, background: 'var(--bg-elev-2)', color: 'var(--text-2)' }}>{disclosures.period}</span>}
      </div>
      {disclosures.headline && (
        <p style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)', lineHeight: 1.6, margin: '0 0 10px' }}>{disclosures.headline}</p>
      )}
      {disclosures.metrics?.length > 0 && (
        <div className="table-mobile-wrap" style={{ marginBottom: 12 }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--border)' }}>
                {['항목', '발표치', '예상치', 'vs 예상', '비고'].map(h => (
                  <th key={h} style={{ padding: '5px 8px', color: 'var(--text-3)', fontWeight: 600, textAlign: h === '항목' || h === '비고' ? 'left' : 'right', whiteSpace: 'nowrap' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {disclosures.metrics.map((m, i) => (
                <tr key={i} style={{ borderBottom: '1px solid var(--border)' }}>
                  <td style={{ padding: '6px 8px', color: 'var(--text)' }}>{m.label}</td>
                  <td style={{ padding: '6px 8px', textAlign: 'right', color: 'var(--text)', fontWeight: 700, whiteSpace: 'nowrap' }}>{m.actual}</td>
                  <td style={{ padding: '6px 8px', textAlign: 'right', color: 'var(--text-2)', whiteSpace: 'nowrap' }}>{m.consensus}</td>
                  <td style={{ padding: '6px 8px', textAlign: 'right', color: vsColor(m.vs_consensus), fontWeight: 700, whiteSpace: 'nowrap' }}>{m.vs_consensus}</td>
                  <td style={{ padding: '6px 8px', color: 'var(--text-3)' }}>{m.note || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {disclosures.events?.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 10 }}>
          {disclosures.events.map((e, i) => (
            <div key={i} style={{ ...(_FACTOR_LINE), borderLeft: `2px solid ${IMPACT_COLOR[e.impact] || 'var(--border)'}` }}>
              <div style={_FACTOR_TITLE}>{e.title}</div>
              <div style={_FACTOR_DESC}>{e.description}</div>
            </div>
          ))}
        </div>
      )}
      {disclosures.price_impact && (
        <div style={{ fontSize: 12, color: 'var(--text-2)', padding: '6px 10px', background: 'var(--bg-elev)', borderRadius: 6, marginBottom: 8 }}>
          📈 {disclosures.price_impact}
        </div>
      )}
      {disclosures.one_liner && (
        <div style={{ fontSize: 12, color: 'var(--text)', lineHeight: 1.7, padding: '8px 12px', background: 'var(--bg-elev-2)', borderRadius: 6, borderLeft: '3px solid var(--accent)', marginBottom: 10 }}>
          💡 {disclosures.one_liner}
        </div>
      )}
      {news?.length > 0 && (
        <ul style={{ margin: 0, padding: '0 0 0 16px', fontSize: 12, lineHeight: 1.8 }}>
          {news.map((item, i) => (
            <li key={i}>
              <a href={item.link} target="_blank" rel="noreferrer" style={{ color: 'var(--accent)', textDecoration: 'none' }}>{decodeHtml(item.title)}</a>
              <span style={{ color: 'var(--text-3)', marginLeft: 6 }}>— {item.publisher} ({item.published_at})</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

const STANCE_CFG = {
  진입: { label: '진입', color: 'var(--semantic-buy)' },
  관망: { label: '관망', color: 'var(--text-3)' },
  회피: { label: '회피', color: 'var(--semantic-sell)' },
}

function _insightLines(value) {
  const items = Array.isArray(value) ? value : [value]
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      {items.filter(Boolean).map((t, i) => (
        <div key={i} style={_FACTOR_DESC}>{t}</div>
      ))}
    </div>
  )
}

export function InsightsSection({ insights }) {
  if (!insights) return null
  if (typeof insights === 'string') return <ReportSectionText title="🎯 권고 인사이트" text={insights} />

  const hasEntry = insights.entry && (!Array.isArray(insights.entry) || insights.entry.length > 0)
  const hasAvoid = insights.avoid && (!Array.isArray(insights.avoid) || insights.avoid.length > 0)
  if (!insights.stance && !hasEntry && !hasAvoid && !insights.one_liner) return null

  const sc = STANCE_CFG[insights.stance] || { label: insights.stance || '', color: 'var(--text-3)' }

  return (
    <div style={{ marginBottom: 20 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        <span style={{ fontWeight: 600, fontSize: 13, color: 'var(--accent)' }}>🎯 권고 인사이트</span>
        {insights.stance && <span style={_CHIP(sc.color)}>{sc.label}</span>}
      </div>
      {insights.one_liner && (
        <p style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)', lineHeight: 1.7, margin: '0 0 10px' }}>{insights.one_liner}</p>
      )}
      {hasEntry && (
        <div style={{ ...(_FACTOR_LINE), borderLeft: '2px solid var(--semantic-buy)', marginBottom: 8 }}>
          <div style={{ ..._FACTOR_TITLE, color: 'var(--semantic-buy)' }}>📈 진입 조건</div>
          {_insightLines(insights.entry)}
        </div>
      )}
      {hasAvoid && (
        <div style={{ ...(_FACTOR_LINE), borderLeft: '2px solid var(--semantic-sell)' }}>
          <div style={{ ..._FACTOR_TITLE, color: 'var(--semantic-sell)' }}>🚫 회피 조건</div>
          {_insightLines(insights.avoid)}
        </div>
      )}
    </div>
  )
}

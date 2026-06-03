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
    if (mc == null) return 'N/A'
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
          const ytdColor = c.ytd_return != null ? (ytdPos ? '#81c784' : '#ef9a9a') : 'var(--text-3)'
          const mcStr = c.market_cap ? (market === 'KR' ? `₩${fmtMC(c.market_cap)}` : `$${fmtMC(c.market_cap)}`) : 'N/A'
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

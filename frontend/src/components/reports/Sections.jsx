import { fmtPrice as fmt } from '../../utils'
import { TH, TD } from './reportUtils.jsx'

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
    if (mc >= 1e12) return `${(mc / 1e12).toFixed(1)}T`
    if (mc >= 1e9) return `${(mc / 1e9).toFixed(1)}B`
    return `${(mc / 1e6).toFixed(0)}M`
  }
  return (
    <div style={{ marginBottom: 20 }}>
      <div style={{ fontWeight: 600, fontSize: 13, color: 'var(--accent)', marginBottom: 8 }}>🏢 사업영역 & 시장순위</div>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
          <thead>
            <tr>
              {['종목', '티커', '현재가', '시가총액', 'YTD'].map(h => (
                <th key={h} style={{ ...TH }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {competitors.map((c, i) => {
              const isSelf = c.is_self || c.ticker === ticker
              return (
                <tr key={i} style={{ background: isSelf ? 'var(--bg-elev-2)' : undefined }}>
                  <td style={{ ...TD, textAlign: 'left', fontWeight: isSelf ? 700 : undefined }}>
                    {c.name || c.ticker}
                    {isSelf && <span style={{ marginLeft: 5, fontSize: 10, color: 'var(--accent)', background: 'var(--bg-elev)', padding: '1px 5px', borderRadius: 3 }}>기준</span>}
                  </td>
                  <td style={{ ...TD, fontWeight: isSelf ? 700 : undefined }}>{c.ticker}</td>
                  <td style={TD}>{fmt(c.price, market)}</td>
                  <td style={TD}>{c.market_cap ? (market === 'KR' ? `₩${fmtMC(c.market_cap)}` : `$${fmtMC(c.market_cap)}`) : 'N/A'}</td>
                  <td style={{ ...TD, color: c.ytd_return != null ? (c.ytd_return >= 0 ? '#81c784' : '#ef9a9a') : undefined }}>
                    {c.ytd_return != null ? `${c.ytd_return >= 0 ? '+' : ''}${c.ytd_return.toFixed(1)}%` : 'N/A'}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
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
                 style={{ color: 'var(--accent)', textDecoration: 'none' }}>{item.title}</a>
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

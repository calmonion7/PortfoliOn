import { fmtPrice as fmt } from '../../utils'

export default function ReportDetailHeader({
  detail, selected, setSelected, setView, isAdmin, generating, genProgress, generateOne, guruMap, reportList,
}) {
  return (
    <div className="detail-header" style={{ marginBottom: 16 }}>
      {/* 행1: 네비 버튼 */}
      <div className="detail-header-nav">
        <button
          onClick={() => setView('list')}
          style={{ background: 'transparent', border: '1px solid var(--border)', color: 'var(--text-3)', borderRadius: 4, padding: '4px 12px', fontSize: 12, cursor: 'pointer' }}
        >
          ← 목록으로
        </button>
        {isAdmin && (
          <button
            onClick={() => generateOne(selected.ticker)}
            disabled={!!generating}
            style={{ background: 'transparent', border: '1px solid var(--border)', color: generating === selected.ticker ? 'var(--accent)' : 'var(--text-3)', borderRadius: 4, padding: '4px 12px', fontSize: 12, cursor: generating ? 'default' : 'pointer' }}
          >
            {generating === selected.ticker ? `${genProgress.done}/${genProgress.total || '?'}` : '생성'}
          </button>
        )}
      </div>
      {/* 행2: 종목명 + 뱃지 */}
      <div className="detail-header-title">
        <span style={{ color: 'var(--text)', fontWeight: 700, fontSize: 17 }}>
          {detail.summary?.name || selected.ticker}
        </span>
        <span style={{ color: 'var(--text-3)', fontSize: 13, marginLeft: 6 }}>({selected.ticker})</span>
        {detail.summary?.market === 'KR'
          ? <span style={{ fontSize: 10, marginLeft: 6, padding: '1px 5px', borderRadius: 3, background: 'var(--color-success-soft)', color: 'var(--color-success)', border: '1px solid var(--border)' }}>🇰🇷 KR</span>
          : <span style={{ fontSize: 10, marginLeft: 6, padding: '1px 5px', borderRadius: 3, background: 'var(--color-info-soft)', color: 'var(--color-info)', border: '1px solid var(--border)' }}>🇺🇸 US</span>
        }
        {guruMap[selected.ticker] && (
          <span style={{ color: 'var(--warn)', fontSize: 11, marginLeft: 6, background: 'var(--warn-soft)', padding: '2px 7px', borderRadius: 3 }}>
            구루 {guruMap[selected.ticker]}명
          </span>
        )}
      </div>
      {/* 행3: 날짜 + 현재가 + 고점대비 */}
      <div className="detail-header-price">
        {reportList[selected.ticker]?.dates?.length > 1 ? (
          <select
            value={selected.date}
            onChange={e => setSelected({ ticker: selected.ticker, date: e.target.value })}
            style={{ background: 'var(--bg-elev-2)', border: '1px solid var(--border)', color: 'var(--text-3)', borderRadius: 4, padding: '2px 6px', fontSize: 12, cursor: 'pointer' }}
          >
            {reportList[selected.ticker].dates.map(d => (
              <option key={d} value={d}>{d}</option>
            ))}
          </select>
        ) : (
          <span style={{ color: 'var(--text-3)', fontSize: 12 }}>{selected.date}</span>
        )}
        {detail.summary?.price != null && (
          <span style={{ color: 'var(--text)', fontSize: 16, fontWeight: 700 }}>
            {fmt(detail.summary.price, detail.summary.market)}
          </span>
        )}
        {detail.summary?.drop_from_high_20d != null && (
          <span style={{
            fontSize: 11, padding: '2px 7px', borderRadius: 3,
            background: detail.summary.drop_from_high_20d >= 0 ? 'var(--up-soft)' : 'var(--down-soft)',
            color: detail.summary.drop_from_high_20d >= 0 ? 'var(--up)' : 'var(--down)',
          }}>
            {detail.summary.drop_from_high_20d < -10 && '⚠ '}
            20일고점 {detail.summary.drop_from_high_20d >= 0 ? '+' : ''}{detail.summary.drop_from_high_20d.toFixed(1)}%
          </span>
        )}
      </div>
      {/* 행4: 섹터 + PER + PBR */}
      <div className="detail-header-meta">
        {detail.summary?.sector && (
          <span style={{ color: 'var(--accent)', fontSize: 11, background: 'var(--bg-elev-2)', padding: '2px 7px', borderRadius: 3 }}>
            {detail.summary.sector}{detail.summary.industry ? ` / ${detail.summary.industry}` : ''}
          </span>
        )}
        {detail.summary?.per != null && (
          <span style={{ color: 'var(--text-3)', fontSize: 11, background: 'var(--bg-elev-2)', padding: '2px 7px', borderRadius: 3 }}>
            PER {detail.summary.per.toFixed(1)}
            {detail.summary.forward_per != null && <span style={{ marginLeft: 4 }}>/ Fwd {detail.summary.forward_per.toFixed(1)}</span>}
          </span>
        )}
        {detail.summary?.pbr != null && (
          <span style={{ color: 'var(--text-3)', fontSize: 11, background: 'var(--bg-elev-2)', padding: '2px 7px', borderRadius: 3 }}>
            PBR {detail.summary.pbr.toFixed(2)}
          </span>
        )}
        {detail.summary?.psr != null && (
          <span style={{ color: 'var(--text-3)', fontSize: 11, background: 'var(--bg-elev-2)', padding: '2px 7px', borderRadius: 3 }}>
            PSR {detail.summary.psr.toFixed(2)}
          </span>
        )}
        {detail.summary?.ev_ebitda != null && (
          <span style={{ color: 'var(--text-3)', fontSize: 11, background: 'var(--bg-elev-2)', padding: '2px 7px', borderRadius: 3 }}>
            EV/EBITDA {detail.summary.ev_ebitda.toFixed(1)}
          </span>
        )}
      </div>
    </div>
  )
}

import { fmtPrice as fmt } from '../../utils'
import { fmt as fmtNum, Pencil } from '../ui/icons'
import { fmtN, rsiColor, overallWeather } from './reportUtils.jsx'

export default function TickerListItem({
  ticker, info, selected, view, pnl, guruMap, isAdmin, generating, genProgress, touchStyle,
  openDetail, generateOne, openEdit, handleDelete, setPromoteTarget,
}) {
  const isSelected = selected.ticker === ticker && view === 'detail'
  const hasReport = info.dates.length > 0
  const isBroken = hasReport && info.summary?.price == null
  const s = info.summary
  const market = s?.market || info.market
  const rsi = s?.daily_rsi?.rsi
  const targetGap = s?.target_mean && s?.price ? (s.target_mean - s.price) / s.price * 100 : null
  const buy = s?.buy ?? 0, hold = s?.hold ?? 0, sell = s?.sell ?? 0
  const total = buy + hold + sell
  return (
    <div
      key={ticker}
      onClick={() => (hasReport && !isBroken) ? openDetail(ticker, info.dates[0]) : generateOne(ticker)}
      className="report-item"
      style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', padding: '8px 10px', borderRadius: 10, cursor: 'pointer', background: isSelected ? 'var(--surface-hover)' : undefined, outline: isSelected ? '2px solid var(--accent)' : undefined, outlineOffset: -1 }}
    >
      <div style={{ minWidth: 0, flex: 1 }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap' }}>
          <span style={{ color: isSelected ? 'var(--accent)' : 'var(--text)', fontWeight: 600, fontSize: 13 }}>{ticker}</span>
          {(() => { const w = overallWeather(s); return w ? <span title={w.label} style={{ fontSize: 12, lineHeight: 1 }}>{w.icon}</span> : null })()}
          {market && (
            <span style={{ fontSize: 9, padding: '0 4px', borderRadius: 2, background: market === 'KR' ? 'var(--color-success-soft)' : 'var(--color-info-soft)', color: market === 'KR' ? 'var(--color-success)' : 'var(--color-info)', border: '1px solid var(--border)' }}>
              {market === 'KR' ? '🇰🇷 KR' : '🇺🇸 US'}
            </span>
          )}
        </span>
        {s?.name && (
          <div style={{ color: 'var(--text-3)', fontSize: 10, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.name}</div>
        )}
        {guruMap[ticker] && (
          <div style={{ color: 'var(--warn)', fontSize: 10 }}>구루 {guruMap[ticker]}명</div>
        )}
        {(!hasReport || isBroken) && <div style={{ color: isBroken ? 'var(--color-error)' : 'var(--text-3)', fontSize: 10 }}>{isBroken ? '데이터 오류 — 클릭하여 재생성' : '클릭하여 생성'}</div>}
        {hasReport && s && (
          <div style={{ marginTop: 4, display: 'flex', flexWrap: 'wrap', gap: '2px 10px' }}>
            {s.price != null && (
              <span style={{ fontSize: 11, color: 'var(--text-2)' }}>{fmt(s.price, market)}</span>
            )}
            {s.drop_from_high_20d != null && (
              <span style={{ fontSize: 11, color: s.drop_from_high_20d >= 0 ? 'var(--up)' : 'var(--down)' }}>
                고점 {s.drop_from_high_20d >= 0 ? '+' : ''}{s.drop_from_high_20d.toFixed(1)}%
              </span>
            )}
            {targetGap != null && (
              <span style={{ fontSize: 11, color: targetGap >= 0 ? 'var(--up)' : 'var(--down)' }}>
                목표 {fmt(s.target_mean, market)} ({targetGap >= 0 ? '+' : ''}{targetGap.toFixed(1)}%)
              </span>
            )}
            {rsi != null && (
              <span style={{ fontSize: 11, color: rsiColor(rsi) }}>RSI {fmtN(rsi)}</span>
            )}
            {total > 0 && (
              <span style={{ fontSize: 11 }}>
                <span style={{ color: 'var(--semantic-buy)' }}>B{buy}</span>
                <span style={{ color: 'var(--text-3)' }}>/H{hold}</span>
                <span style={{ color: 'var(--semantic-sell)' }}>/S{sell}</span>
                {total <= 10 && (
                  <span title={`애널리스트 ${total}명 — 의견 수가 적어 신뢰도가 낮을 수 있습니다`} style={{ color: 'var(--warn)', marginLeft: 3, cursor: 'help' }}>⚠{total}</span>
                )}
              </span>
            )}
          </div>
        )}
        {info.category === 'holdings' && (() => {
          const p = pnl
          if (!p) return null
          const isUp = p.pnl >= 0
          return (
            <div style={{ marginTop: 3, fontSize: 11, color: isUp ? 'var(--up)' : 'var(--down)', fontWeight: 600 }}>
              {p.quantity}주 · 평단 {p.ccy}{fmtNum(p.avg_cost, p.dec)} · {isUp ? '+' : '-'}{p.ccy}{fmtNum(Math.abs(p.pnl), p.dec)}
              {p.pnlPct != null && <span> ({p.pnlPct >= 0 ? '+' : ''}{p.pnlPct.toFixed(1)}%)</span>}
            </div>
          )
        })()}
        {generating === ticker && genProgress.total > 0 && (
          <div style={{ marginTop: 3 }}>
            <div style={{ background: 'var(--surface-hover)', borderRadius: 2, height: 3, overflow: 'hidden' }}>
              <div style={{ width: `${Math.round(genProgress.done / genProgress.total * 100)}%`, height: '100%', background: 'var(--accent)', transition: 'width 0.4s ease' }} />
            </div>
          </div>
        )}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0, marginTop: 2 }}>
        {isAdmin && (
          <button
            onClick={e => { e.stopPropagation(); generateOne(ticker) }}
            disabled={!!generating}
            style={{ background: 'transparent', border: '1px solid var(--border)', color: generating === ticker ? 'var(--accent)' : 'var(--text-3)', borderRadius: 3, padding: '1px 6px', fontSize: 11, cursor: generating ? 'default' : 'pointer' }}
          >
            {generating === ticker ? `${genProgress.done}/${genProgress.total || '?'}` : '생성'}
          </button>
        )}
        {(info.category === 'holdings' || info.category === 'watchlist') && (
          <>
            <button className="sc-act-btn" style={touchStyle} title="수정" onClick={e => { e.stopPropagation(); openEdit(ticker, info.category) }}><Pencil /></button>
            {info.category === 'watchlist' && (
              <button className="sc-act-btn" style={touchStyle} title="보유로 이동" onClick={e => { e.stopPropagation(); setPromoteTarget({ ticker, market: market || 'US' }) }}>↑</button>
            )}
            <button className="sc-act-btn" style={touchStyle} title="삭제" onClick={e => { e.stopPropagation(); handleDelete(ticker, info.category === 'watchlist') }}>×</button>
          </>
        )}
      </div>
    </div>
  )
}

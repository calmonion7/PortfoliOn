import { fmtPrice as fmt } from '../../utils'
import { fmt as fmtNum } from '../ui/icons'
import { fmtN, rsiColor, overallWeather } from './reportUtils.jsx'
import StockActions from './StockActions.jsx'
import { MarketBadge, ChangeBadge } from '../ui/Badge'

export default function TickerListItem({
  ticker, info, selected, view, pnl, guruMap, isAdmin, generating, genProgress, touchStyle,
  openDetail, generateOne, openEdit, handleDelete, handleGlobalDelete, setPromoteTarget, handlePinToggle,
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
      className="report-item anim-fade-up"
      style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', padding: '8px 10px', borderRadius: 10, cursor: 'pointer', background: isSelected ? 'var(--surface-hover)' : undefined, outline: isSelected ? '2px solid var(--accent)' : undefined, outlineOffset: -1 }}
    >
      <div style={{ minWidth: 0, flex: 1 }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap' }}>
          <span className="mono" style={{ color: isSelected ? 'var(--accent)' : 'var(--text)', fontWeight: 600, fontSize: 13 }}>{ticker}</span>
          {(() => { const w = overallWeather(s); return w ? <span title={w.label} style={{ fontSize: 12, lineHeight: 1 }}>{w.icon}</span> : null })()}
          {market && <MarketBadge market={market} exchange={info.exchange} />}
        </span>
        {s?.name && (
          <div style={{ color: 'var(--text-3)', fontSize: 10, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.name}</div>
        )}
        {guruMap[ticker] && (
          <div style={{ color: 'var(--warn)', fontSize: 10 }}>구루 {guruMap[ticker]}명</div>
        )}
        {(!hasReport || isBroken) && <div style={{ color: isBroken ? 'var(--color-error)' : 'var(--text-3)', fontSize: 10 }}>{isBroken ? '데이터 오류 — 클릭하여 재생성' : '클릭하여 생성'}</div>}
        {hasReport && s && (
          <div style={{ marginTop: 4, display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '3px 8px' }}>
            {s.price != null && (
              <span className="mono tnum" style={{ fontSize: 11, color: 'var(--text-2)' }}>{fmt(s.price, market)}</span>
            )}
            {s.drop_from_high_20d != null && (
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, fontSize: 10, color: 'var(--text-3)', whiteSpace: 'nowrap' }}>
                고점<ChangeBadge value={s.drop_from_high_20d} />
              </span>
            )}
            {targetGap != null && (
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, fontSize: 10, color: 'var(--text-3)', whiteSpace: 'nowrap' }}>
                목표 <span className="mono tnum">{fmt(s.target_mean, market)}</span><ChangeBadge value={targetGap} />
              </span>
            )}
            {rsi != null && (
              <span className="mono tnum" style={{ fontSize: 11, color: rsiColor(rsi) }}>RSI {fmtN(rsi)}</span>
            )}
            {total > 0 && (
              <span className="mono tnum" style={{ fontSize: 11 }}>
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
            <div className="mono tnum" style={{ marginTop: 3, fontSize: 11, color: isUp ? 'var(--up)' : 'var(--down)', fontWeight: 600 }}>
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
            className="mono tnum"
            style={{ background: 'transparent', border: '1px solid var(--border)', color: generating === ticker ? 'var(--accent)' : 'var(--text-3)', borderRadius: 3, padding: '1px 6px', fontSize: 11, cursor: generating ? 'default' : 'pointer' }}
          >
            {generating === ticker ? `${genProgress.done}/${genProgress.total || '?'}` : '생성'}
          </button>
        )}
        <StockActions
          info={info} ticker={ticker} market={market} touchStyle={touchStyle}
          openEdit={openEdit} handleDelete={handleDelete} handleGlobalDelete={handleGlobalDelete}
          setPromoteTarget={setPromoteTarget} handlePinToggle={handlePinToggle} layout="list"
        />
      </div>
    </div>
  )
}

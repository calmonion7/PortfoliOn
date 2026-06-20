import { fmtPrice as fmt } from '../../utils'
import { fmt as fmtNum, Pencil } from '../ui/icons'
import { fmtN, rsiColor, overallWeather } from './reportUtils.jsx'

export default function StockCard({
  ticker, info, pnl, guruMap, isAdmin, generating, genProgress, touchStyle,
  openDetail, generateOne, openEdit, handleDelete, setPromoteTarget,
}) {
  const s = info.summary
  const market = s?.market || info.market
  const dr = s?.daily_rsi
  const wr = s?.weekly_rsi
  const mr = s?.monthly_rsi
  const hasReport = info.dates.length > 0
  const isBroken = hasReport && s?.price == null
  const weather = overallWeather(s)
  const weatherAccent = !weather ? 'var(--border)'
    : weather.icon === '☀️' ? 'var(--semantic-buy)'
    : weather.icon === '⛅' ? 'var(--warn)'
    : weather.icon === '☁️' ? 'var(--text-3)'
    : 'var(--semantic-sell)'
  const buy = s?.buy ?? 0, hold = s?.hold ?? 0, sell = s?.sell ?? 0
  const total = buy + hold + sell
  const targetGap = s?.target_mean && s?.price ? (s.target_mean - s.price) / s.price * 100 : null

  const priceGap = (t) => {
    if (t == null || !s?.price) return null
    const p = (t - s.price) / s.price * 100
    return <span style={{ fontSize: 9, color: p >= 0 ? 'var(--up)' : 'var(--down)' }}>({p >= 0 ? '+' : ''}{p.toFixed(1)}%)</span>
  }

  const rsiTargetBlock = (key, color, soft) => {
    const num = key.replace('target_', '')
    const dv = dr?.[key]
    const barWidth = (t) => {
      if (t == null || !s?.price) return 0
      return Math.min(Math.abs((t - s.price) / s.price * 100), 50) / 50 * 100
    }
    return (
      <div key={key} style={{ display: 'flex', alignItems: 'flex-start', gap: 7, marginBottom: 6 }}>
        {/* 레벨 배지 */}
        <span title={`RSI ${num} 도달 시 예상 가격 (RSI 기준선)`} style={{
          fontSize: 9, fontWeight: 700, color,
          background: soft, border: `1px solid ${soft}`,
          borderRadius: 3, padding: '1px 4px',
          minWidth: 22, textAlign: 'center', flexShrink: 0, marginTop: 1, cursor: 'help',
        }}>{num}</span>
        {/* 일봉 + 게이지 */}
        <div style={{ flex: 1, minWidth: 0 }}>
          {dv != null ? <>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 4, whiteSpace: 'nowrap' }}>
              <span style={{ fontSize: 11, fontWeight: 500, color: 'var(--text)' }}>{fmt(dv, market)}</span>
              {priceGap(dv)}
            </div>
            <div style={{ height: 2, background: 'var(--bg-elev-2)', borderRadius: 1, overflow: 'hidden', marginTop: 3, marginBottom: 2 }}>
              <div style={{ height: '100%', width: `${barWidth(dv)}%`, background: color, borderRadius: 1, opacity: 0.55 }} />
            </div>
          </> : <span style={{ fontSize: 9, color: 'var(--text-3)' }}>—</span>}
        </div>
      </div>
    )
  }

  return (
    <div
      key={ticker}
      onClick={() => (hasReport && !isBroken) ? openDetail(ticker, info.dates[0]) : generateOne(ticker)}
      className="stock-card"
      style={{ borderLeft: `3px solid ${weatherAccent}` }}
    >
      {/* 종목 */}
      <div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <span style={{ fontWeight: 700, fontSize: 13, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s?.name || ticker}</span>
          {weather && <span title={weather.label} style={{ fontSize: 12, flexShrink: 0 }}>{weather.icon}</span>}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: 2, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 11, color: 'var(--text-3)' }}>{ticker}</span>
          {market && <span className={`sc-market ${market === 'KR' ? 'kr' : 'us'}`}>{market === 'KR' ? `🇰🇷 ${info.exchange === 'KS' ? 'KOSPI' : info.exchange === 'KQ' ? 'KOSDAQ' : 'KR'}` : '🇺🇸 US'}</span>}
          {guruMap[ticker] && <span style={{ fontSize: 9, color: 'var(--warn)' }}>구루{guruMap[ticker]}명</span>}
        </div>
        {s?.sector && <div style={{ fontSize: 10, color: 'var(--text-3)', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.sector}</div>}
        {s?.industry && <div style={{ fontSize: 9, color: 'var(--text-3)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.industry}</div>}
        {(!hasReport || isBroken) && <div style={{ fontSize: 10, color: isBroken ? 'var(--color-error)' : 'var(--text-3)', marginTop: 2 }}>{isBroken ? '데이터 오류' : '클릭하여 생성'}</div>}
        {info.category === 'holdings' && (() => {
          const p = pnl
          if (!p) return null
          const isUp = p.pnl >= 0
          return (
            <div style={{ fontSize: 10, color: isUp ? 'var(--up)' : 'var(--down)', marginTop: 3, fontWeight: 600 }}>
              {p.quantity}주 · 평단 {p.ccy}{fmtNum(p.avg_cost, p.dec)}<br />
              {isUp ? '+' : '-'}{p.ccy}{fmtNum(Math.abs(p.pnl), p.dec)}
              {p.pnlPct != null && <span style={{ marginLeft: 4 }}>({p.pnlPct >= 0 ? '+' : ''}{p.pnlPct.toFixed(1)}%)</span>}
            </div>
          )
        })()}
        {(info.category === 'holdings' || info.category === 'watchlist') && (
          <div style={{ display: 'flex', gap: 6, marginTop: 4 }}>
            <button className="sc-act-btn" style={touchStyle} title="수정" onClick={e => { e.stopPropagation(); openEdit(ticker, info.category) }}><Pencil /></button>
            {info.category === 'watchlist' && (
              <button className="sc-act-btn" style={touchStyle} title="보유로 이동" onClick={e => { e.stopPropagation(); setPromoteTarget({ ticker, market: market || 'US' }) }}>↑</button>
            )}
            <button className="sc-act-btn" style={touchStyle} title="삭제" onClick={e => { e.stopPropagation(); handleDelete(ticker, info.category === 'watchlist') }}>×</button>
          </div>
        )}
      </div>

      {/* 가격 / POC */}
      <div>
        {s?.price != null ? <>
          <div style={{ fontWeight: 700, fontSize: 14, color: 'var(--text)' }}>{fmt(s.price, market)}</div>
          {s.drop_from_high_20d != null && (
            <div style={{ fontSize: 11, color: s.drop_from_high_20d >= 0 ? 'var(--up)' : 'var(--down)', marginTop: 2 }}>
              {s.drop_from_high_20d < -10 && '⚠ '}{s.drop_from_high_20d >= 0 ? '+' : ''}{s.drop_from_high_20d.toFixed(1)}%
            </div>
          )}
          {s.volume_profile?.poc != null && (
            <div style={{ fontSize: 10, color: 'var(--text-3)', marginTop: 1 }}>POC {fmt(s.volume_profile.poc, market)}</div>
          )}
        </> : <span style={{ color: 'var(--text-3)', fontSize: 12 }}>—</span>}
      </div>

      {/* 목표가 / 컨센서스 */}
      <div>
        {targetGap != null && (
          <div style={{ fontSize: 12, color: targetGap >= 0 ? 'var(--up)' : 'var(--down)', fontWeight: 600 }}>
            {fmt(s.target_mean, market)} {targetGap >= 0 ? '▲' : '▼'}{Math.abs(targetGap).toFixed(1)}%
          </div>
        )}
        {total > 0 && <>
          <div style={{ display: 'flex', borderRadius: 2, overflow: 'hidden', height: 4, margin: '4px 0 3px', background: 'var(--bg-elev-2)' }}>
            <div style={{ width: `${buy / total * 100}%`, background: 'var(--semantic-buy)' }} />
            <div style={{ width: `${hold / total * 100}%`, background: 'var(--data-4)' }} />
            <div style={{ width: `${sell / total * 100}%`, background: 'var(--semantic-sell)' }} />
          </div>
          <div style={{ fontSize: 10, display: 'flex', gap: 5 }}>
            <span style={{ color: 'var(--semantic-buy)' }}>B{buy}</span>
            <span style={{ color: 'var(--text-3)' }}>H{hold}</span>
            <span style={{ color: 'var(--semantic-sell)' }}>S{sell}</span>
            {total <= 10 && <span style={{ color: 'var(--warn)' }}>⚠{total}명</span>}
          </div>
        </>}
        {s?.finviz_recom != null && <div style={{ fontSize: 10, color: 'var(--text-3)', marginTop: 2 }}>Finviz {fmtN(s.finviz_recom)}</div>}
      </div>

      {/* 밸류에이션 */}
      <div style={{ fontSize: 11 }}>
        <div>{s?.per != null ? `PER ${s.per.toFixed(1)}` : '—'}</div>
        {s?.forward_per != null && <div style={{ fontSize: 10, color: 'var(--text-3)' }}>Fwd {s.forward_per.toFixed(1)}</div>}
        {s?.pbr != null && <div style={{ marginTop: 2 }}>PBR {s.pbr.toFixed(2)}</div>}
      </div>

      {/* RSI 일/주/월 */}
      <div>
        {[{ label: '일', rsi: dr?.rsi, bold: true }, { label: '주', rsi: wr?.rsi }, { label: '월', rsi: mr?.rsi }]
          .filter(({ rsi }) => rsi != null)
          .map(({ label, rsi, bold }) => (
            <div key={label} style={{ marginBottom: 5 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 2 }}>
                <span style={{ fontSize: 8, color: 'var(--text-3)', letterSpacing: '0.3px' }}>{label}</span>
                <span style={{ fontSize: bold ? 12 : 10, fontWeight: bold ? 700 : 400, color: rsiColor(rsi) }}>{fmtN(rsi)}</span>
              </div>
              <div style={{ height: 3, background: 'var(--bg-elev-2)', borderRadius: 2, overflow: 'hidden' }}>
                <div style={{ height: '100%', width: `${rsi}%`, background: rsiColor(rsi), borderRadius: 2, opacity: bold ? 1 : 0.6 }} />
              </div>
            </div>
          ))}
      </div>

      {/* RSI 매수구간 20/25/30 */}
      <div>{['target_20', 'target_25', 'target_30'].map(k => rsiTargetBlock(k, 'var(--semantic-buy)', 'var(--semantic-buy-soft)'))}</div>

      {/* RSI 매도구간 70/75/80 */}
      <div>{['target_70', 'target_75', 'target_80'].map(k => rsiTargetBlock(k, 'var(--semantic-sell)', 'var(--semantic-sell-soft)'))}</div>

      {/* 생성 버튼 */}
      <div>
        {isAdmin && (
          <button
            onClick={e => { e.stopPropagation(); generateOne(ticker) }}
            disabled={!!generating}
            className="sc-gen-btn"
          >
            {generating === ticker ? `${genProgress.done}/${genProgress.total || '?'}` : '생성'}
          </button>
        )}
      </div>
    </div>
  )
}

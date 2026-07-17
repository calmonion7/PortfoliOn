import { useState, useEffect } from 'react'
import api from '../../api'
import InsiderBadge from '../ui/InsiderBadge'
import { SectionTitle } from './reportUtils.jsx'

// 종목 내부자 지분공시 신호 + 거래 목록 (DART). KR 전용.
// GET /api/report/{ticker}/insider-trades →
//   { trades: [{rcept_no, rcept_dt(ISO|null), report_kind('insider'|'major5'),
//               repror, rel, shares_change(int|null,+/−), shares_after, rate_after(%), dart_url}],
//     signal: {direction('buy'|'sell'|'neutral'), net_shares, count, window_days} }
// 심층분석 탭의 LatestDisclosuresSection 직후에 배치. LatestDisclosuresSection 형제 패턴(self-fetch).

// report_kind → 한글 라벨/색.
const _KIND_CFG = {
  insider: { label: '내부자', color: 'var(--color-info)' },
  major5: { label: '5%대량보유', color: 'var(--warn)' },
}

// ISO 문자열|null → YYYY.MM.DD (방어적: 파싱 실패 시 원문/빈 문자열).
function fmtDate(s) {
  if (!s) return ''
  const str = String(s)
  const d = new Date(str)
  if (!isNaN(d.getTime())) {
    const y = d.getFullYear()
    const m = String(d.getMonth() + 1).padStart(2, '0')
    const day = String(d.getDate()).padStart(2, '0')
    return `${y}.${m}.${day}`
  }
  return str
}

// 부호 포함 천단위 주식수.
function fmtShares(n) {
  if (n == null) return ''
  const sign = n > 0 ? '+' : ''
  return `${sign}${n.toLocaleString()}`
}

export default function InsiderTradesSection({ ticker, market }) {
  const [data, setData] = useState(null)   // null=로딩
  const [error, setError] = useState(false)
  useEffect(() => {
    if (market !== 'KR') return
    let cancelled = false
    setData(null)
    setError(false)
    api.get(`/api/report/${ticker}/insider-trades`)
      .then(({ data }) => { if (!cancelled) setData(data || { trades: [], signal: null }) })
      .catch(() => { if (!cancelled) setError(true) })
    return () => { cancelled = true }
  }, [ticker, market])

  if (market !== 'KR') return null

  const signal = data?.signal
  const trades = data?.trades || []
  const dirLabel = signal?.direction === 'buy' ? '순매수' : signal?.direction === 'sell' ? '순매도' : null
  const netAbs = signal?.net_shares != null ? Math.abs(signal.net_shares).toLocaleString() : null

  return (
    <div style={{ marginBottom: 20 }}>
      <SectionTitle>👤 내부자 지분공시 (DART)</SectionTitle>
      {error ? (
        <p style={{ fontSize: 12, color: 'var(--text-3)', margin: 0 }}>내부자 공시를 불러오지 못했습니다.</p>
      ) : data === null ? (
        <p style={{ fontSize: 12, color: 'var(--text-3)', margin: 0 }}>내부자 공시 불러오는 중…</p>
      ) : trades.length === 0 ? (
        <p style={{ fontSize: 12, color: 'var(--text-3)', margin: 0 }}>내부자 공시 없음</p>
      ) : (
        <>
          {signal && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
              <InsiderBadge direction={signal.direction} />
              <span style={{ fontSize: 12, color: 'var(--text-2)' }}>
                {dirLabel && netAbs != null
                  ? `최근 ${signal.window_days}일 ${dirLabel} ${netAbs}주 (${signal.count}건)`
                  : `최근 ${signal.window_days}일 신호 중립 (${signal.count}건)`}
              </span>
            </div>
          )}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {trades.map((t) => {
              const kc = _KIND_CFG[t.report_kind] || { label: t.report_kind || '', color: 'var(--text-3)' }
              const changeStr = fmtShares(t.shares_change)
              const changeColor = t.shares_change > 0 ? 'var(--semantic-buy)' : t.shares_change < 0 ? 'var(--semantic-sell)' : 'var(--text-3)'
              return (
                <a
                  key={t.rcept_no}
                  href={t.dart_url}
                  target="_blank"
                  rel="noreferrer"
                  style={{
                    display: 'flex', alignItems: 'center', gap: 8,
                    padding: '6px 8px', borderRadius: 6, textDecoration: 'none',
                    background: 'var(--bg-elev)',
                  }}
                >
                  <span className="mono" style={{ fontSize: 11, color: 'var(--text-3)', flexShrink: 0, fontVariantNumeric: 'tabular-nums', minWidth: 78 }}>
                    {fmtDate(t.rcept_dt)}
                  </span>
                  {kc.label && (
                    <span style={{ fontSize: 10, fontWeight: 700, padding: '1px 6px', borderRadius: 3, background: 'var(--bg-elev-2)', color: kc.color, flexShrink: 0 }}>
                      {kc.label}
                    </span>
                  )}
                  <span style={{ fontSize: 12, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
                    {t.repror}{t.rel ? ` · ${t.rel}` : ''}
                  </span>
                  {changeStr && (
                    <span className="mono" style={{ fontSize: 12, color: changeColor, flexShrink: 0, fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>
                      {changeStr}
                    </span>
                  )}
                  {t.rate_after != null && (
                    <span className="mono" style={{ fontSize: 11, color: 'var(--text-3)', flexShrink: 0, fontVariantNumeric: 'tabular-nums', minWidth: 48, textAlign: 'right' }}>
                      {t.rate_after}%
                    </span>
                  )}
                </a>
              )
            })}
          </div>
        </>
      )}
    </div>
  )
}

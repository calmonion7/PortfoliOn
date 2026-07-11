import { useState, useEffect } from 'react'
import api from '../../api'

// US 종목 내부자 거래 (SEC Form4). 기술·수급 탭 US 브랜치.
// GET /api/report/{ticker}/us-insider →
//   { transactions: [{insider, position, transaction, shares, value, start_date, ownership}],
//     net: {net_shares, pct_buy, pct_sell, total_held}, fetched_at }
// KR 종목 · 데이터 없음 → null 반환(렌더 없음). InsiderTradesSection.jsx 패턴 참조.

// ISO 문자열|null → YYYY.MM.DD
function fmtDate(s) {
  if (!s) return '—'
  const d = new Date(String(s))
  if (isNaN(d.getTime())) return String(s)
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}.${m}.${day}`
}

// K/M/B 축약 주수 (UsSupplySection 동일 패턴)
function fmtShares(n) {
  if (n == null) return '—'
  const v = Number(n)
  if (v >= 1e9) return `${(v / 1e9).toFixed(2)}B`
  if (v >= 1e6) return `${(v / 1e6).toFixed(2)}M`
  if (v >= 1e3) return `${(v / 1e3).toFixed(1)}K`
  return v.toLocaleString()
}

// 달러 금액 축약
function fmtValue(n) {
  if (n == null) return '—'
  const v = Number(n)
  if (v >= 1e9) return `$${(v / 1e9).toFixed(2)}B`
  if (v >= 1e6) return `$${(v / 1e6).toFixed(2)}M`
  if (v >= 1e3) return `$${(v / 1e3).toFixed(1)}K`
  return `$${v.toLocaleString()}`
}

// 거래 종류 → 방향성 색: 매수류=--up(빨강), 매도류=--down(파랑), 기타=--text-3
// KR 색 관례: --up=빨강(상승/매수), --down=파랑(하락/매도)
function txColor(tx) {
  if (!tx) return 'var(--text-3)'
  const lc = tx.toLowerCase()
  if (lc.includes('buy') || lc.includes('purchase') || lc.includes('acquisition')) return 'var(--up)'
  if (lc.includes('sell') || lc.includes('sale') || lc.includes('dispose')) return 'var(--down)'
  return 'var(--text-3)'
}

const STAT = { display: 'flex', flexDirection: 'column', background: 'var(--bg-elev)', border: '1px solid var(--border)', borderRadius: 5, padding: '6px 10px', gap: 2, minWidth: 80 }
const STAT_LABEL = { fontSize: 10, color: 'var(--text-3)' }
const STAT_VAL = { fontSize: 13, fontWeight: 700, color: 'var(--text)', fontVariantNumeric: 'tabular-nums', fontFamily: 'var(--font-mono)' }

const TH = { padding: '5px 8px', textAlign: 'right', borderBottom: '1px solid var(--border)', fontSize: 11, color: 'var(--text-3)', whiteSpace: 'nowrap' }
const TD = { padding: '5px 8px', textAlign: 'right', borderBottom: '1px solid var(--border)', fontSize: 12, fontVariantNumeric: 'tabular-nums', fontFamily: 'var(--font-mono)' }
const TDL = { ...TD, textAlign: 'left' }

export default function UsInsiderSection({ ticker, market }) {
  const [data, setData] = useState(null)   // null=로딩
  const [error, setError] = useState(false)

  useEffect(() => {
    if (market === 'KR') return
    let cancelled = false
    setData(null)
    setError(false)
    api.get(`/api/report/${ticker}/us-insider`)
      .then(({ data }) => { if (!cancelled) setData(data || { transactions: [], net: null }) })
      .catch(() => { if (!cancelled) setError(true) })
    return () => { cancelled = true }
  }, [ticker, market])

  if (market === 'KR') return null
  if (error) return null   // eco: silent — 다른 US 섹션(UsSupplySection)과 동일
  if (data === null) return null   // 로딩 중에는 숨김(UsSupplySection과 동일 처리)

  const { transactions, net } = data
  const hasNet = net && Object.keys(net).length > 0
  const hasTx = Array.isArray(transactions) && transactions.length > 0
  if (!hasNet && !hasTx) return null

  // 순매수/매도 방향 색
  const netShares = net?.net_shares
  const netColor = netShares == null ? 'var(--text)' : netShares > 0 ? 'var(--up)' : netShares < 0 ? 'var(--down)' : 'var(--text)'

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, marginTop: 18 }}>

      {/* 6개월 순매수 요약 */}
      {hasNet && (
        <div>
          <div style={{ fontWeight: 600, fontSize: 13, color: 'var(--accent)', marginBottom: 8 }}>내부자 거래 (6개월 순매수)</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {net.net_shares != null && (
              <div style={STAT}>
                <span style={STAT_LABEL}>순 주식수</span>
                <span style={{ ...STAT_VAL, color: netColor }}>
                  {net.net_shares > 0 ? '+' : ''}{fmtShares(net.net_shares)}
                </span>
              </div>
            )}
            {net.pct_buy != null && (
              <div style={STAT}>
                <span style={STAT_LABEL}>매수 비율</span>
                <span style={{ ...STAT_VAL, color: 'var(--up)' }}>{(net.pct_buy * 100).toFixed(1)}%</span>
              </div>
            )}
            {net.pct_sell != null && (
              <div style={STAT}>
                <span style={STAT_LABEL}>매도 비율</span>
                <span style={{ ...STAT_VAL, color: 'var(--down)' }}>{(net.pct_sell * 100).toFixed(1)}%</span>
              </div>
            )}
            {net.total_held != null && (
              <div style={STAT}>
                <span style={STAT_LABEL}>내부자 총 보유</span>
                <span style={STAT_VAL}>{fmtShares(net.total_held)}</span>
              </div>
            )}
          </div>
        </div>
      )}

      {/* 최근 내부자 거래 목록 */}
      {hasTx && (
        <div>
          <div style={{ fontWeight: 600, fontSize: 13, color: 'var(--accent)', marginBottom: 8 }}>최근 내부자 거래 (Form 4)</div>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <thead>
                <tr>
                  <th style={{ ...TH, textAlign: 'left' }}>내부자</th>
                  <th style={{ ...TH, textAlign: 'left' }}>직책</th>
                  <th style={TH}>거래유형</th>
                  <th style={TH}>주수</th>
                  <th style={TH}>금액</th>
                  <th style={TH}>날짜</th>
                </tr>
              </thead>
              <tbody>
                {transactions.map((t, i) => (
                  <tr key={i}>
                    <td style={TDL}>{t.insider || '—'}</td>
                    <td style={{ ...TDL, color: 'var(--text-3)', fontSize: 11 }}>{t.position || '—'}</td>
                    <td style={{ ...TD, color: txColor(t.transaction), fontWeight: 600 }}>{t.transaction || '—'}</td>
                    <td style={TD}>{fmtShares(t.shares)}</td>
                    <td style={TD}>{fmtValue(t.value)}</td>
                    <td style={{ ...TD, color: 'var(--text-3)' }}>{fmtDate(t.start_date)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

    </div>
  )
}

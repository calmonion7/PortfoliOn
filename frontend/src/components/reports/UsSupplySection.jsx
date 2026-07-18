import { useState, useEffect } from 'react'
import api from '../../api'
import { SectionTitle } from './reportUtils.jsx'
import { GlossaryText } from '../Glossary.jsx'

// US 종목 수급 — 공매도 비중 + 기관 보유 상위. 기술·수급 탭 US 브랜치.
// GET /api/report/{ticker}/us-supply → { short, institutional, fetched_at }
// KR 종목이면 null 반환(렌더 없음).

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

// 숫자 천단위 포매터 (K/M/B 축약)
function fmtShares(n) {
  if (n == null) return '—'
  const v = Number(n)
  if (v >= 1e9) return `${(v / 1e9).toFixed(2)}B`
  if (v >= 1e6) return `${(v / 1e6).toFixed(2)}M`
  if (v >= 1e3) return `${(v / 1e3).toFixed(1)}K`
  return v.toLocaleString()
}

// +/-% 색상: 양수=--up(빨강, KR 상승), 음수=--down(파랑, KR 하락)
function pctColor(v) {
  if (v == null) return 'var(--text-3)'
  return v > 0 ? 'var(--up)' : v < 0 ? 'var(--down)' : 'var(--text-3)'
}

const STAT = { display: 'flex', flexDirection: 'column', background: 'var(--bg-elev)', border: '1px solid var(--border)', borderRadius: 5, padding: '6px 10px', gap: 2, minWidth: 80 }
const STAT_LABEL = { fontSize: 10, color: 'var(--text-3)' }
const STAT_VAL = { fontSize: 13, fontWeight: 700, color: 'var(--text)', fontVariantNumeric: 'tabular-nums', fontFamily: 'var(--font-mono)' }

const TH = { padding: '5px 8px', textAlign: 'right', borderBottom: '1px solid var(--border)', fontSize: 11, color: 'var(--text-3)', whiteSpace: 'nowrap' }
const TD = { padding: '5px 8px', textAlign: 'right', borderBottom: '1px solid var(--border)', fontSize: 12, fontVariantNumeric: 'tabular-nums', fontFamily: 'var(--font-mono)' }
const TDL = { ...TD, textAlign: 'left' }

export default function UsSupplySection({ ticker, market }) {
  const [data, setData] = useState(null)   // null=로딩
  const [error, setError] = useState(false)

  useEffect(() => {
    if (market === 'KR') return
    let cancelled = false
    setData(null)
    setError(false)
    api.get(`/api/report/${ticker}/us-supply`)
      .then(({ data }) => { if (!cancelled) setData(data || { short: null, institutional: [] }) })
      .catch(() => { if (!cancelled) setError(true) })
    return () => { cancelled = true }
  }, [ticker, market])

  if (market === 'KR') return null
  if (error) return null   // eco: silent — 다른 KR 섹션들과 동일하게 오류 시 숨김
  if (data === null) return (
    <p style={{ fontSize: 12, color: 'var(--text-3)', margin: '10px 0 0' }}>미국 수급 불러오는 중…</p>
  )

  const { short, institutional } = data
  const hasShort = short != null
  const hasInst = Array.isArray(institutional) && institutional.length > 0
  if (!hasShort && !hasInst) return null

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, marginTop: 18 }}>

      {/* 공매도 통계 */}
      {hasShort && (
        <div>
          <SectionTitle>공매도 통계</SectionTitle>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {short.short_pct_float != null && (
              <div style={STAT}>
                <span style={STAT_LABEL}><GlossaryText text="유통주식 대비 공매도" /></span>
                <span style={{ ...STAT_VAL, color: 'var(--up)' }}>{(short.short_pct_float * 100).toFixed(2)}%</span>
              </div>
            )}
            {short.short_ratio != null && (
              <div style={STAT}>
                <span style={STAT_LABEL}>Days to Cover</span>
                <span style={STAT_VAL}>{short.short_ratio.toFixed(1)}일</span>
              </div>
            )}
            {short.shares_short != null && (
              <div style={STAT}>
                <span style={STAT_LABEL}><GlossaryText text="공매도 잔량" /></span>
                <span style={STAT_VAL}>{fmtShares(short.shares_short)}</span>
              </div>
            )}
            {short.date_short_interest && (
              <div style={STAT}>
                <span style={STAT_LABEL}>기준일</span>
                <span style={{ ...STAT_VAL, fontSize: 12, fontWeight: 500 }}>{fmtDate(short.date_short_interest)}</span>
              </div>
            )}
          </div>
        </div>
      )}

      {/* 기관 보유 상위 */}
      {hasInst && (
        <div>
          <SectionTitle>기관 보유 상위</SectionTitle>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <thead>
                <tr>
                  <th style={{ ...TH, textAlign: 'left' }}>기관명</th>
                  <th style={TH}>보유 비중</th>
                  <th style={TH}>보유 주수</th>
                  <th style={TH}>전분기 대비</th>
                </tr>
              </thead>
              <tbody>
                {institutional.map((row, i) => (
                  <tr key={i}>
                    <td style={TDL}>{row.holder || '—'}</td>
                    <td style={TD}>{row.pct_held != null ? `${(row.pct_held * 100).toFixed(2)}%` : '—'}</td>
                    <td style={TD}>{fmtShares(row.shares)}</td>
                    <td style={{ ...TD, color: pctColor(row.pct_change), fontWeight: row.pct_change != null ? 600 : 400 }}>
                      {row.pct_change != null
                        ? `${row.pct_change > 0 ? '+' : ''}${(row.pct_change * 100).toFixed(2)}%`
                        : '—'}
                    </td>
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

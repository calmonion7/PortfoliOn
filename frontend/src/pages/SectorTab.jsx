// frontend/src/pages/SectorTab.jsx
import { useState, useEffect } from 'react'
import axios from 'axios'

const PERIODS = ['return_1w', 'return_1mo', 'return_3mo']
const PERIOD_LABELS = { return_1w: '1주', return_1mo: '1개월', return_3mo: '3개월' }

function returnColor(v) {
  if (v === null || v === undefined) return 'transparent'
  const neutral = [42, 42, 58]
  const pos = [79, 195, 100]
  const neg = [239, 100, 100]
  const t = Math.min(Math.abs(v) / 10, 1)
  const to = v >= 0 ? pos : neg
  return `rgb(${Math.round(neutral[0] + t * (to[0] - neutral[0]))},${Math.round(neutral[1] + t * (to[1] - neutral[1]))},${Math.round(neutral[2] + t * (to[2] - neutral[2]))})`
}

export default function SectorTab() {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    axios.get('/api/analysis/sector')
      .then(r => { setData(r.data); setLoading(false) })
      .catch(e => { setError(e.message); setLoading(false) })
  }, [])

  if (loading) return <div style={{ color: 'var(--text-muted)' }}>섹터 데이터 불러오는 중...</div>
  if (error) return <div style={{ color: '#ef9a9a' }}>오류: {error}</div>
  if (!data) return null

  const { sectors, portfolio_sectors } = data
  const heldSectors = new Set(Object.values(portfolio_sectors))

  return (
    <div>
      <h2 style={{ color: 'var(--text)', marginBottom: 8 }}>섹터 모멘텀</h2>
      <p style={{ color: 'var(--text-muted)', fontSize: 12, marginBottom: 24 }}>
        S&P500 섹터 ETF 기준 수익률 · ★ 보유 종목이 있는 섹터
      </p>
      <table style={{ borderCollapse: 'separate', borderSpacing: '0 3px', fontSize: 13, width: '100%', maxWidth: 620 }}>
        <thead>
          <tr>
            <th style={{ textAlign: 'left', paddingBottom: 8, color: 'var(--text-muted)', fontWeight: 400 }}>섹터</th>
            <th style={{ textAlign: 'center', padding: '0 12px 8px', color: 'var(--text-muted)', fontWeight: 400 }}>ETF</th>
            {PERIODS.map(p => (
              <th key={p} style={{ textAlign: 'right', padding: '0 8px 8px', color: 'var(--text-muted)', fontWeight: 400, minWidth: 68 }}>
                {PERIOD_LABELS[p]}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sectors.map(s => (
            <tr key={s.etf}>
              <td style={{ padding: '4px 12px 4px 0', color: 'var(--text)' }}>
                {heldSectors.has(s.name) ? `★ ${s.name}` : s.name}
              </td>
              <td style={{ padding: '4px 12px', color: 'var(--text-muted)', textAlign: 'center', fontSize: 11 }}>{s.etf}</td>
              {PERIODS.map(p => (
                <td key={p} style={{
                  padding: '3px 8px',
                  textAlign: 'right',
                  background: returnColor(s[p]),
                  color: s[p] !== null ? 'white' : 'var(--text-muted)',
                  borderRadius: 4,
                  fontVariantNumeric: 'tabular-nums',
                }}>
                  {s[p] !== null ? `${s[p] > 0 ? '+' : ''}${s[p]}%` : '—'}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {Object.keys(portfolio_sectors).length > 0 && (
        <p style={{ marginTop: 20, fontSize: 12, color: 'var(--text-muted)' }}>
          보유 종목: {Object.entries(portfolio_sectors).map(([t, s]) => `${t}(${s})`).join(' · ')}
        </p>
      )}
    </div>
  )
}

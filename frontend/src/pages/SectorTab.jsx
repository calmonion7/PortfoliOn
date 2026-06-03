// frontend/src/pages/SectorTab.jsx
import { useState, useEffect } from 'react'
import api from '../api'
import LoadingSpinner from '../components/LoadingSpinner'
import useIsMobile from '../hooks/useIsMobile'

const PERIODS = ['return_1w', 'return_1mo', 'return_3mo']
const PERIOD_LABELS = { return_1w: '1주', return_1mo: '1개월', return_3mo: '3개월' }

function returnColor(v) {
  if (v === null || v === undefined) return 'var(--bg-elev)'
  if (v > 0) return `color-mix(in oklab, var(--up) ${Math.min(v * 8, 40)}%, var(--bg-elev))`
  if (v < 0) return `color-mix(in oklab, var(--down) ${Math.min(Math.abs(v) * 8, 40)}%, var(--bg-elev))`
  return 'var(--bg-elev)'
}

export default function SectorTab() {
  const isMobile = useIsMobile()
  const [open, setOpen] = useState(true)
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    api.get('/api/analysis/sector')
      .then(r => { setData(r.data); setLoading(false) })
      .catch(e => { setError(e.message); setLoading(false) })
  }, [])

  if (loading) return <LoadingSpinner label="섹터 데이터 불러오는 중입니다." />
  if (error) return <div style={{ color: '#ef9a9a' }}>오류: {error}</div>
  if (!data) return null

  const { sectors, portfolio_sectors } = data
  const heldSectors = new Set(Object.values(portfolio_sectors))

  return (
    <div>
      {isMobile ? (
        <button className="accordion-header" onClick={() => setOpen(o => !o)}>
          <span style={{ color: 'var(--text)', fontWeight: 600 }}>섹터 모멘텀</span>
          <span>{open ? '∧' : '∨'}</span>
        </button>
      ) : (
        <h2 style={{ color: 'var(--text)', marginBottom: 8 }}>섹터 모멘텀</h2>
      )}
      {(!isMobile || open) && (
        <>
      <p style={{ color: 'var(--text-3)', fontSize: 12, marginBottom: 8 }}>
        S&P500 섹터 ETF 기준 수익률 · ★ 보유 종목이 있는 섹터
      </p>
      <p style={{ color: 'var(--text-3)', fontSize: 11, marginBottom: 24, lineHeight: 1.7 }}>
        미국 S&P500의 11개 섹터별 ETF 수익률로 어느 섹터가 강한지 한눈에 파악합니다.<br />
        색상: <span style={{ color: 'var(--up)' }}>빨강</span> — 상승 &nbsp;·&nbsp; <span style={{ color: 'var(--down)' }}>파랑</span> — 하락 &nbsp;·&nbsp; 짙을수록 변화 폭이 큼<br />
        ★ 표시된 섹터에 내 보유 종목이 속합니다. 해당 섹터가 강하면 순풍, 약하면 역풍.
      </p>
      <table style={{ borderCollapse: 'separate', borderSpacing: '0 3px', fontSize: 13, width: '100%', maxWidth: 620 }}>
        <thead>
          <tr>
            <th style={{ textAlign: 'left', paddingBottom: 8, color: 'var(--text-3)', fontWeight: 400 }}>섹터</th>
            <th style={{ textAlign: 'center', padding: '0 12px 8px', color: 'var(--text-3)', fontWeight: 400 }}>ETF</th>
            {PERIODS.map(p => (
              <th key={p} style={{ textAlign: 'right', padding: '0 8px 8px', color: 'var(--text-3)', fontWeight: 400, minWidth: 68 }}>
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
              <td style={{ padding: '4px 12px', color: 'var(--text-3)', textAlign: 'center', fontSize: 11 }}>{s.etf}</td>
              {PERIODS.map(p => (
                <td key={p} style={{
                  padding: '3px 8px',
                  textAlign: 'right',
                  background: returnColor(s[p]),
                  color: s[p] !== null ? 'white' : 'var(--text-3)',
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
        <p style={{ marginTop: 20, fontSize: 12, color: 'var(--text-3)' }}>
          보유 종목: {Object.entries(portfolio_sectors).map(([t, s]) => `${t}(${s})`).join(' · ')}
        </p>
      )}
        </>
      )}
    </div>
  )
}

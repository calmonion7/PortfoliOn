// frontend/src/pages/SectorTab.jsx
import { useState, useEffect } from 'react'
import api from '../api'
import Skeleton from '../components/ui/Skeleton'
import useIsMobile from '../hooks/useIsMobile'

const PERIODS = ['return_1w', 'return_1mo', 'return_3mo']
const PERIOD_LABELS = { return_1w: '1주', return_1mo: '1개월', return_3mo: '3개월' }
const MARKETS = [['US', '🇺🇸 해외'], ['KR', '🇰🇷 국내']]

function returnColor(v) {
  if (v === null || v === undefined) return 'var(--bg-elev)'
  if (v > 0) return `color-mix(in oklab, var(--up) ${Math.min(v * 8, 40)}%, var(--bg-elev))`
  if (v < 0) return `color-mix(in oklab, var(--down) ${Math.min(Math.abs(v) * 8, 40)}%, var(--bg-elev))`
  return 'var(--bg-elev)'
}

export default function SectorTab() {
  const isMobile = useIsMobile()
  const [open, setOpen] = useState(true)
  const [market, setMarket] = useState('US')
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    setLoading(true)
    setError(null)
    setData(null)
    api.get('/api/analysis/sector', { params: { market } })
      .then(r => { setData(r.data); setLoading(false) })
      .catch(e => { setError(e.message); setLoading(false) })
  }, [market])

  const Toggle = (
    <div className="tabs" style={{ width: 'fit-content', marginBottom: 12 }}>
      {MARKETS.map(([val, label]) => (
        <button key={val} className={market === val ? 'is-active' : ''} onClick={() => setMarket(val)}>{label}</button>
      ))}
    </div>
  )

  const isKr = market === 'KR'
  const { sectors, portfolio_sectors } = data || {}
  const heldSectors = data ? new Set(Object.values(portfolio_sectors)) : new Set()

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
      {Toggle}
      <p style={{ color: 'var(--text-3)', fontSize: 12, marginBottom: 8 }}>
        {isKr ? 'KRX 업종 기준 수익률 · ★ 보유 종목이 있는 업종' : 'S&P500 섹터 ETF 기준 수익률 · ★ 보유 종목이 있는 섹터'}
      </p>
      <p style={{ color: 'var(--text-3)', fontSize: 11, marginBottom: 24, lineHeight: 1.7 }}>
        {isKr
          ? <>KRX 업종별 수익률로 어느 업종이 강한지 한눈에 파악합니다.<br /></>
          : <>미국 S&P500의 11개 섹터별 ETF 수익률로 어느 섹터가 강한지 한눈에 파악합니다.<br /></>}
        색상: <span style={{ color: 'var(--up)' }}>빨강</span> — 상승 &nbsp;·&nbsp; <span style={{ color: 'var(--down)' }}>파랑</span> — 하락 &nbsp;·&nbsp; 짙을수록 변화 폭이 큼<br />
        ★ 표시된 {isKr ? '업종' : '섹터'}에 내 보유 종목이 속합니다. 해당 {isKr ? '업종' : '섹터'}이 강하면 순풍, 약하면 역풍.
      </p>
      {loading ? (
        <div style={{ maxWidth: 620 }}><Skeleton variant="row" count={11} /></div>
      ) : error ? (
        <div style={{ color: 'var(--color-error)' }}>오류: {error}</div>
      ) : !data ? null : (
        <>
      <table style={{ borderCollapse: 'separate', borderSpacing: '0 3px', fontSize: 13, width: '100%', maxWidth: 620 }}>
        <thead>
          <tr>
            <th style={{ textAlign: 'left', paddingBottom: 8, color: 'var(--text-3)', fontWeight: 400 }}>{isKr ? '업종' : '섹터'}</th>
            {!isKr && <th style={{ textAlign: 'center', padding: '0 12px 8px', color: 'var(--text-3)', fontWeight: 400 }}>ETF</th>}
            {PERIODS.map(p => (
              <th key={p} style={{ textAlign: 'right', padding: '0 8px 8px', color: 'var(--text-3)', fontWeight: 400, minWidth: 68 }}>
                {PERIOD_LABELS[p]}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sectors.map(s => (
            <tr key={s.etf || s.name}>
              <td style={{ padding: '4px 12px 4px 0', color: 'var(--text)' }}>
                {heldSectors.has(s.name) ? `★ ${s.name}` : s.name}
              </td>
              {!isKr && <td style={{ padding: '4px 12px', color: 'var(--text-3)', textAlign: 'center', fontSize: 11 }}>{s.etf}</td>}
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
        </>
      )}
    </div>
  )
}

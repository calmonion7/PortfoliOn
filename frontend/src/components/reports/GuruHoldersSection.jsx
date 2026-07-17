import { useState, useEffect } from 'react'
import api from '../../api'
import { SectionTitle } from './reportUtils.jsx'

// US 13F 구루(운용역) 보유 드릴다운. 기술·수급 탭 US 브랜치.
// GET /api/guru/managers → managers[].top10[].{ ticker, weight_pct, name, rank }
// 클라이언트에서 ticker → [{guruName, weightPct}] 역인덱스 빌드.
// KR 종목 · 보유 구루 없음 → null 반환(렌더 없음).

const STAT = { display: 'flex', flexDirection: 'column', background: 'var(--bg-elev)', border: '1px solid var(--border)', borderRadius: 5, padding: '6px 10px', gap: 2, minWidth: 80 }
const STAT_LABEL = { fontSize: 10, color: 'var(--text-3)' }
const STAT_VAL = { fontSize: 13, fontWeight: 700, color: 'var(--text)', fontVariantNumeric: 'tabular-nums', fontFamily: 'var(--font-mono)' }

const TH = { padding: '5px 8px', textAlign: 'right', borderBottom: '1px solid var(--border)', fontSize: 11, color: 'var(--text-3)', whiteSpace: 'nowrap' }
const TD = { padding: '5px 8px', textAlign: 'right', borderBottom: '1px solid var(--border)', fontSize: 12, fontVariantNumeric: 'tabular-nums', fontFamily: 'var(--font-mono)' }
const TDL = { ...TD, textAlign: 'left' }

export default function GuruHoldersSection({ ticker, market }) {
  const [holders, setHolders] = useState(null)   // null=로딩, []=없음
  const [error, setError] = useState(false)

  useEffect(() => {
    if (market === 'KR') return
    let cancelled = false
    setHolders(null)
    setError(false)
    api.get('/api/guru/managers')
      .then(({ data }) => {
        if (cancelled) return
        const target = (ticker || '').toUpperCase()
        // eco: 역인덱스 — top10만 순회(전체 holdings 아님, top10에 없으면 비중 미미)
        const found = []
        for (const m of (data.managers || [])) {
          for (const h of (m.top10 || [])) {
            if (h.ticker.toUpperCase() === target) {
              found.push({
                name: m.name.split(' - ')[0],
                firm: m.firm || null,
                rank: h.rank,
                weightPct: h.weight_pct,
              })
            }
          }
        }
        // 비중 내림차순 정렬
        found.sort((a, b) => (b.weightPct ?? 0) - (a.weightPct ?? 0))
        setHolders(found)
      })
      .catch(() => { if (!cancelled) setError(true) })
    return () => { cancelled = true }
  }, [ticker, market])

  if (market === 'KR') return null
  if (error) return null   // eco: silent — UsSupplySection과 동일
  if (holders === null) return null   // 로딩 중 숨김 — UsInsiderSection과 동일
  if (holders.length === 0) return null

  const maxWeight = Math.max(...holders.map(h => h.weightPct ?? 0))

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 18 }}>
      <SectionTitle>보유 구루 (13F)</SectionTitle>

      {/* 요약 통계 */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        <div style={STAT}>
          <span style={STAT_LABEL}>보유 구루 수</span>
          <span style={STAT_VAL}>{holders.length}명</span>
        </div>
        {maxWeight > 0 && (
          <div style={STAT}>
            <span style={STAT_LABEL}>최고 포트폴리오 비중</span>
            <span style={STAT_VAL}>{maxWeight.toFixed(2)}%</span>
          </div>
        )}
      </div>

      {/* 구루별 목록 */}
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
          <thead>
            <tr>
              <th style={{ ...TH, textAlign: 'left' }}>운용역</th>
              <th style={{ ...TH, textAlign: 'left' }}>운용사</th>
              <th style={TH}>포트폴리오 비중</th>
              <th style={TH}>Top10 순위</th>
            </tr>
          </thead>
          <tbody>
            {holders.map((h, i) => (
              <tr key={i}>
                <td style={TDL}>{h.name}</td>
                <td style={{ ...TDL, color: 'var(--text-3)', fontSize: 11 }}>{h.firm || '—'}</td>
                <td style={{ ...TD, fontWeight: 600 }}>
                  {h.weightPct != null ? `${Number(h.weightPct).toFixed(2)}%` : '—'}
                </td>
                <td style={{ ...TD, color: 'var(--text-3)' }}>
                  {h.rank != null ? `#${h.rank}` : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

import { useState, useEffect } from 'react'
import axios from 'axios'

const WEIGHT_LEGEND = [1,2,3,4,5,6,7,8,9,10].map(r => ({ rank: r, score: (1/r).toFixed(3) }))
const thStyle = { padding: '8px 12px', textAlign: 'left', fontWeight: 600, fontSize: 12 }
const tdStyle = { padding: '8px 12px', color: '#e0e0e0' }

export default function GuruStats() {
  const [popularity, setPopularity] = useState([])
  const [top3, setTop3]             = useState([])
  const [weighted, setWeighted]     = useState([])
  const [loading, setLoading]       = useState(true)

  useEffect(() => {
    Promise.all([
      axios.get('/api/guru/stats/popularity'),
      axios.get('/api/guru/stats/manager-top3'),
      axios.get('/api/guru/stats/weighted'),
    ]).then(([p, t, w]) => {
      setPopularity(p.data)
      setTop3(t.data)
      setWeighted(w.data)
    }).finally(() => setLoading(false))
  }, [])

  if (loading) return <p style={{ color: '#aaa' }}>로딩 중...</p>
  if (!popularity.length) return (
    <p style={{ color: '#888', fontSize: 14 }}>데이터 없음 — 크롤링을 먼저 실행하세요.</p>
  )

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 32 }}>

      {/* ① 전체 인기순 */}
      <section>
        <h3 style={{ color: '#80cbc4', fontSize: 14, marginBottom: 12 }}>① 전체 종목 인기순 (카운트)</h3>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ borderBottom: '1px solid #333', color: '#80cbc4' }}>
              <th style={thStyle}>#</th>
              <th style={thStyle}>티커</th>
              <th style={thStyle}>영문명</th>
              <th style={thStyle}>한글명</th>
              <th style={{ ...thStyle, textAlign: 'right' }}>매니저 수</th>
            </tr>
          </thead>
          <tbody>
            {popularity.map((row, i) => (
              <tr key={row.ticker} style={{ borderBottom: '1px solid #222' }}>
                <td style={tdStyle}>{i + 1}</td>
                <td style={{ ...tdStyle, fontWeight: 600, color: '#4fc3f7' }}>{row.ticker}</td>
                <td style={{ ...tdStyle, color: '#aaa' }}>{row.name}</td>
                <td style={tdStyle}>{row.name_kr || '-'}</td>
                <td style={{ ...tdStyle, textAlign: 'right' }}>{row.count}명</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {/* ② 매니저별 탑3 */}
      <section>
        <h3 style={{ color: '#80cbc4', fontSize: 14, marginBottom: 12 }}>② 매니저별 탑3 인기순</h3>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ borderBottom: '1px solid #333', color: '#80cbc4' }}>
              <th style={thStyle}>Manager</th>
              {[1, 2, 3].map(r => <th key={r} style={thStyle}>{r}위 (전체보유)</th>)}
            </tr>
          </thead>
          <tbody>
            {top3.map(m => (
              <tr key={m.manager_name} style={{ borderBottom: '1px solid #222' }}>
                <td style={tdStyle}>{m.manager_name}</td>
                {[0, 1, 2].map(i => {
                  const h = m.top3[i]
                  return (
                    <td key={i} style={tdStyle}>
                      {h ? (
                        <>
                          <span style={{ color: '#4fc3f7', fontWeight: 600 }}>{h.ticker}</span>
                          {h.name_kr && <span style={{ color: '#aaa', fontSize: 11 }}> {h.name_kr}</span>}
                          <span style={{ color: '#666', fontSize: 11 }}> ({h.count}명)</span>
                        </>
                      ) : '-'}
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {/* ③ 가중치 통계 */}
      <section>
        <h3 style={{ color: '#80cbc4', fontSize: 14, marginBottom: 8 }}>③ 전체 종목 가중치 통계 (역수 합산)</h3>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 12 }}>
          {WEIGHT_LEGEND.map(({ rank, score }) => (
            <span key={rank} style={{ fontSize: 11, color: '#666', background: '#1e1e2e', padding: '2px 6px', borderRadius: 3 }}>
              {rank}위={score}
            </span>
          ))}
        </div>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ borderBottom: '1px solid #333', color: '#80cbc4' }}>
              <th style={thStyle}>#</th>
              <th style={thStyle}>티커</th>
              <th style={thStyle}>한글명</th>
              <th style={{ ...thStyle, textAlign: 'right' }}>가중치 합계</th>
            </tr>
          </thead>
          <tbody>
            {weighted.map((row, i) => (
              <tr key={row.ticker} style={{ borderBottom: '1px solid #222' }}>
                <td style={tdStyle}>{i + 1}</td>
                <td style={{ ...tdStyle, fontWeight: 600, color: '#4fc3f7' }}>{row.ticker}</td>
                <td style={tdStyle}>{row.name_kr || row.name || '-'}</td>
                <td style={{ ...tdStyle, textAlign: 'right', fontWeight: 600 }}>{row.score.toFixed(3)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

    </div>
  )
}

// frontend/src/pages/MacroTab.jsx
import { useState, useEffect } from 'react'
import axios from 'axios'
import {
  ScatterChart, Scatter, XAxis, YAxis, CartesianGrid,
  ReferenceLine, Tooltip, ResponsiveContainer, Label,
} from 'recharts'

const INDICATOR_LABELS = {
  'TLT': '미국 10년물 금리',
  'UUP': '달러 인덱스',
  'USO': '유가',
  '^VIX': '공포 지수',
}

function corrColor(v) {
  if (v === null || v === undefined) return 'var(--text-muted)'
  const neutral = [69, 90, 100]
  const pos = [79, 195, 247]
  const neg = [239, 154, 154]
  const t = Math.min(Math.abs(v), 1)
  const to = v >= 0 ? pos : neg
  return `rgb(${Math.round(neutral[0] + t * (to[0] - neutral[0]))},${Math.round(neutral[1] + t * (to[1] - neutral[1]))},${Math.round(neutral[2] + t * (to[2] - neutral[2]))})`
}

export default function MacroTab() {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [selected, setSelected] = useState(null)

  useEffect(() => {
    axios.get('/api/analysis/macro-correlation')
      .then(r => {
        setData(r.data)
        setLoading(false)
        if (r.data.correlations.length) setSelected(r.data.correlations[0].ticker)
      })
      .catch(e => { setError(e.message); setLoading(false) })
  }, [])

  if (loading) return <div style={{ color: 'var(--text-muted)' }}>매크로 데이터 불러오는 중...</div>
  if (error) return <div style={{ color: '#ef9a9a' }}>오류: {error}</div>
  if (!data || !data.correlations.length) return (
    <div style={{ color: 'var(--text-muted)' }}>보유종목 없음 또는 데이터 부족</div>
  )

  const { correlations, scatter } = data
  const scatterData = scatter.filter(d => d.indicator === selected)

  return (
    <div>
      <h2 style={{ color: 'var(--text)', marginBottom: 8 }}>매크로 상관관계</h2>
      <p style={{ color: 'var(--text-muted)', fontSize: 12, marginBottom: 24 }}>
        매크로 지표 일별 변동률 vs 포트폴리오 가중평균 수익률 · 90일 Pearson 상관계수 · 행 클릭 시 산점도 표시
      </p>

      <table style={{ borderCollapse: 'collapse', fontSize: 13, marginBottom: 32 }}>
        <thead>
          <tr>
            <th style={{ textAlign: 'left', padding: '4px 20px 8px 0', color: 'var(--text-muted)', fontWeight: 400 }}>지표</th>
            <th style={{ textAlign: 'center', padding: '4px 16px 8px', color: 'var(--text-muted)', fontWeight: 400 }}>티커</th>
            <th style={{ textAlign: 'right', padding: '4px 0 8px', color: 'var(--text-muted)', fontWeight: 400 }}>상관계수</th>
          </tr>
        </thead>
        <tbody>
          {correlations.map(c => (
            <tr
              key={c.ticker}
              onClick={() => setSelected(c.ticker)}
              style={{
                cursor: 'pointer',
                background: selected === c.ticker ? 'var(--bg-card)' : 'transparent',
                borderRadius: 4,
              }}
            >
              <td style={{ padding: '7px 20px 7px 0', color: 'var(--text)' }}>{c.indicator}</td>
              <td style={{ padding: '7px 16px', color: 'var(--text-muted)', textAlign: 'center', fontSize: 11 }}>{c.ticker}</td>
              <td style={{ padding: '7px 0', textAlign: 'right' }}>
                <span style={{
                  color: corrColor(c.corr_90d),
                  fontVariantNumeric: 'tabular-nums',
                  fontWeight: 600,
                }}>
                  {c.corr_90d !== null ? c.corr_90d.toFixed(3) : '—'}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {scatterData.length > 0 && (
        <div>
          <h3 style={{ color: 'var(--text)', marginBottom: 8, fontSize: 14 }}>
            {INDICATOR_LABELS[selected] || selected} vs 포트폴리오 수익률 (90일)
          </h3>
          <ResponsiveContainer width="100%" height={360}>
            <ScatterChart margin={{ top: 16, right: 24, bottom: 32, left: 24 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
              <XAxis type="number" dataKey="macro_delta" name="매크로 변동" unit="%" stroke="var(--text-muted)" tick={{ fontSize: 11 }}>
                <Label value="매크로 변동 %" position="insideBottom" offset={-16} fill="var(--text-muted)" fontSize={11} />
              </XAxis>
              <YAxis type="number" dataKey="portfolio_return" name="포트폴리오 수익률" unit="%" stroke="var(--text-muted)" tick={{ fontSize: 11 }}>
                <Label value="수익률 %" angle={-90} position="insideLeft" offset={10} fill="var(--text-muted)" fontSize={11} />
              </YAxis>
              <ReferenceLine x={0} stroke="var(--text-muted)" strokeDasharray="4 2" />
              <ReferenceLine y={0} stroke="var(--text-muted)" strokeDasharray="4 2" />
              <Tooltip
                content={({ payload }) => {
                  if (!payload?.length) return null
                  const d = payload[0].payload
                  return (
                    <div style={{
                      background: 'var(--bg-card)', border: '1px solid var(--border)',
                      padding: '8px 12px', borderRadius: 6, fontSize: 12,
                    }}>
                      <div style={{ color: 'var(--text-muted)', marginBottom: 4 }}>{d.date}</div>
                      <div style={{ color: 'var(--text-muted)' }}>
                        매크로: <span style={{ color: 'var(--text)' }}>{d.macro_delta}%</span>
                      </div>
                      <div style={{ color: 'var(--text-muted)' }}>
                        수익률: <span style={{ color: 'var(--text)' }}>{d.portfolio_return}%</span>
                      </div>
                    </div>
                  )
                }}
              />
              <Scatter data={scatterData} fill="var(--accent)" fillOpacity={0.6} />
            </ScatterChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  )
}

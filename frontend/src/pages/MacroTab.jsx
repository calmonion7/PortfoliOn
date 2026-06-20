// frontend/src/pages/MacroTab.jsx
import { useState, useEffect } from 'react'
import api from '../api'
import Skeleton from '../components/ui/Skeleton'
import useIsMobile from '../hooks/useIsMobile'
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
  if (v === null || v === undefined) return 'var(--text-3)'
  const t = Math.round(Math.min(Math.abs(v), 1) * 100)
  const to = v >= 0 ? 'var(--corr-pos)' : 'var(--corr-neg)'
  return `color-mix(in oklab, ${to} ${t}%, var(--corr-zero))`
}

export default function MacroTab() {
  const isMobile = useIsMobile()
  const [open, setOpen] = useState(true)
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [selected, setSelected] = useState(null)

  useEffect(() => {
    api.get('/api/analysis/macro-correlation')
      .then(r => {
        setData(r.data)
        setLoading(false)
        if (r.data.correlations.length) setSelected(r.data.correlations[0].ticker)
      })
      .catch(e => { setError(e.message); setLoading(false) })
  }, [])

  if (loading) return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      <div style={{ maxWidth: 360 }}><Skeleton variant="row" count={4} /></div>
      <Skeleton variant="chart" height={360} />
    </div>
  )
  if (error) return <div style={{ color: 'var(--color-error)' }}>오류: {error}</div>
  if (!data || !data.correlations.length) return (
    <div style={{ color: 'var(--text-3)' }}>보유종목 없음 또는 데이터 부족</div>
  )

  const { correlations, scatter } = data
  const scatterData = scatter.filter(d => d.indicator === selected)

  return (
    <div>
      {isMobile ? (
        <button className="accordion-header" onClick={() => setOpen(o => !o)}>
          <span style={{ color: 'var(--text)', fontWeight: 600 }}>매크로 상관관계</span>
          <span>{open ? '∧' : '∨'}</span>
        </button>
      ) : (
        <h2 style={{ color: 'var(--text)', marginBottom: 8 }}>매크로 상관관계</h2>
      )}
      {(!isMobile || open) && (
        <>
      <p style={{ color: 'var(--text-3)', fontSize: 12, marginBottom: 24 }}>
        매크로 지표 일별 변동률 vs 포트폴리오 가중평균 수익률 · 90일 Pearson 상관계수
      </p>

      <table style={{ borderCollapse: 'collapse', fontSize: 13, marginBottom: 12 }}>
        <thead>
          <tr>
            <th style={{ textAlign: 'left', padding: '4px 20px 8px 0', color: 'var(--text-3)', fontWeight: 400 }}>지표</th>
            <th style={{ textAlign: 'center', padding: '4px 16px 8px', color: 'var(--text-3)', fontWeight: 400 }}>티커</th>
            <th style={{ textAlign: 'right', padding: '4px 0 8px', color: 'var(--text-3)', fontWeight: 400 }}>상관계수</th>
          </tr>
        </thead>
        <tbody>
          {correlations.map(c => (
            <tr
              key={c.ticker}
              onClick={() => setSelected(c.ticker)}
              style={{
                cursor: 'pointer',
              }}
            >
              <td style={{ padding: isMobile ? '14px 20px 14px 0' : '7px 20px 7px 0', color: 'var(--text)', background: selected === c.ticker ? 'var(--bg-elev)' : 'transparent' }}>{c.indicator}</td>
              <td style={{ padding: isMobile ? '14px 16px' : '7px 16px', color: 'var(--text-3)', textAlign: 'center', fontSize: 11, background: selected === c.ticker ? 'var(--bg-elev)' : 'transparent' }}>{c.ticker}</td>
              <td style={{ padding: isMobile ? '14px 0' : '7px 0', textAlign: 'right', background: selected === c.ticker ? 'var(--bg-elev)' : 'transparent' }}>
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

      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16, fontSize: 11, color: 'var(--text-3)' }}>
        <span>−1.0</span>
        <div style={{ flex: '0 0 140px', height: 8, borderRadius: 4, background: 'linear-gradient(to right, var(--corr-neg), var(--corr-zero), var(--corr-pos))' }} />
        <span>+1.0</span>
      </div>

      <p style={{ color: 'var(--text-3)', fontSize: 12, marginBottom: 16 }}>
        👆 지표를 클릭하면 산점도를 확인할 수 있습니다.
      </p>
      <p style={{ color: 'var(--text-3)', fontSize: 11, marginBottom: 32, lineHeight: 1.7 }}>
        상관계수는 −1 ~ +1 범위로, 두 지표가 얼마나 같은 방향으로 움직이는지를 나타냅니다.<br />
        <span style={{ color: 'var(--text-2)' }}>양수(+)</span>: 매크로 지표가 오를 때 포트폴리오도 오르는 경향 &nbsp;·&nbsp;
        <span style={{ color: 'var(--text-2)' }}>음수(−)</span>: 반대 방향으로 움직이는 경향<br />
        절댓값 기준: 0.2 미만 — 거의 무관 &nbsp;·&nbsp; 0.2 ~ 0.5 — 약한 상관 &nbsp;·&nbsp; 0.5 이상 — 강한 상관
      </p>

      {scatterData.length > 0 && (
        <div>
          <h3 style={{ color: 'var(--text)', marginBottom: 4, fontSize: 14 }}>
            {INDICATOR_LABELS[selected] || selected} vs 포트폴리오 수익률 (최근 90일)
          </h3>
          <p style={{ color: 'var(--text-3)', fontSize: 11, marginBottom: 12 }}>
            각 점 = 하루의 데이터. X축: 해당 매크로 지표의 일별 변동%, Y축: 내 포트폴리오의 가중평균 수익률%.
            점이 우상향으로 기울면 양의 상관, 우하향이면 음의 상관을 의미합니다.
          </p>
          <ResponsiveContainer width="100%" height={360}>
            <ScatterChart margin={{ top: 16, right: 24, bottom: 32, left: 24 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
              <XAxis type="number" dataKey="macro_delta" name="매크로 변동" unit="%" stroke="var(--text-3)" tick={{ fontSize: 11 }}>
                <Label value="매크로 지표 일별 변동 (%)" position="insideBottom" offset={-16} fill="var(--text-3)" fontSize={11} />
              </XAxis>
              <YAxis type="number" dataKey="portfolio_return" name="포트폴리오 수익률" unit="%" stroke="var(--text-3)" tick={{ fontSize: 11 }}>
                <Label value="포트폴리오 수익률 (%)" angle={-90} position="insideLeft" offset={10} fill="var(--text-3)" fontSize={11} />
              </YAxis>
              <ReferenceLine x={0} stroke="var(--text-3)" strokeDasharray="4 2" />
              <ReferenceLine y={0} stroke="var(--text-3)" strokeDasharray="4 2" />
              <Tooltip
                content={({ payload }) => {
                  if (!payload?.length) return null
                  const d = payload[0].payload
                  return (
                    <div style={{
                      background: 'var(--bg-elev)', border: '1px solid var(--border)',
                      padding: '8px 12px', borderRadius: 6, fontSize: 12,
                    }}>
                      <div style={{ color: 'var(--text-3)', marginBottom: 4 }}>{d.date}</div>
                      <div style={{ color: 'var(--text-3)' }}>
                        매크로: <span style={{ color: 'var(--text)' }}>{d.macro_delta}%</span>
                      </div>
                      <div style={{ color: 'var(--text-3)' }}>
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
        </>
      )}
    </div>
  )
}

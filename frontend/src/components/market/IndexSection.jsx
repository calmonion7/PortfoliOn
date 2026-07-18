import { useState, useEffect } from 'react'
import api from '../../api'
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts'
import { DESC_STYLE, SectionCard, SectionCardLoading, SectionCardError } from './marketUtils.jsx'
import { GlossaryText } from '../Glossary.jsx'

const INDEX_LABELS = { gspc: 'S&P 500', ks11: 'KOSPI', kq11: 'KOSDAQ' }

export default function IndexSection() {
  const [open, setOpen] = useState(false)
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    api.get('/api/market/indices')
      .then(r => setData(r.data))
      .catch(() => setError(true))
      .finally(() => setLoading(false))
  }, [])

  if (loading) return <SectionCardLoading title="주요 지수" />
  if (error || !data) return <SectionCardError title="주요 지수" />

  const indices = data.indices || {}
  const cape = data.valuation?.sp500_cape

  const gspc = indices.gspc
  const summary = gspc ? gspc.current.toLocaleString(undefined, { maximumFractionDigits: 2 }) : ''

  return (
    <SectionCard title="주요 지수" summary={summary} change={gspc?.change_pct ?? null} changeSuffix="%" open={open} onToggle={() => setOpen(o => !o)}>
      <p style={DESC_STYLE}>글로벌 벤치마크 지수의 현재 레벨과 단기 추이입니다. S&P 500은 미국 대형주 500종의 시가총액 가중 지수이며, CAPE(주가수익비율 경기조정)는 10년 평균 실질이익 기준 밸류에이션을 나타냅니다.</p>

      <div style={{ display: 'flex', gap: 12, marginBottom: 20, flexWrap: 'wrap' }}>
        {['gspc', 'ks11', 'kq11'].map(key => {
          const idx = indices[key]
          const up = idx?.change_pct > 0
          const down = idx?.change_pct < 0
          return (
            <div key={key} className="metric-tile" style={{ minWidth: 110, flex: 1 }}>
              <div className="lbl">{INDEX_LABELS[key]}</div>
              <div className="v">{idx ? idx.current.toLocaleString(undefined, { maximumFractionDigits: 2 }) : '-'}</div>
              {idx && (
                <div className="d" style={{ color: up ? 'var(--up)' : down ? 'var(--down)' : 'var(--text-3)' }}>
                  {up ? '▲' : down ? '▼' : '─'} {Math.abs(idx.change_pct).toFixed(2)}%
                </div>
              )}
            </div>
          )
        })}
      </div>

      {gspc?.history?.length > 0 && (
        <div className="chartbox" style={{ marginBottom: 16 }}>
          <div className="sub">S&P 500 추이 (1년)</div>
          <ResponsiveContainer width="100%" height={180}>
            <LineChart data={gspc.history.slice(-252)} margin={{ top: 4, right: 16, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
              <XAxis dataKey="date" tick={{ fontSize: 10, fill: 'var(--text-3)' }}
                     tickFormatter={v => v.slice(5)} interval={Math.floor(Math.min(gspc.history.length, 252) / 6)} />
              <YAxis tick={{ fontSize: 10, fill: 'var(--text-3)' }} domain={['auto', 'auto']} width={52} />
              <Tooltip contentStyle={{ background: 'var(--bg-elev)', border: '1px solid var(--border)', fontSize: 12 }}
                       labelStyle={{ color: 'var(--text-3)' }} />
              <Line type="monotone" dataKey="value" name="S&P 500" stroke="var(--data-2)" dot={false} strokeWidth={1.5} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}

      {cape && (
        <div className="metric-tile" style={{ display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'center' }}>
          <div>
            <div className="lbl"><GlossaryText text="S&P 500 CAPE (실러 PER)" /></div>
            <div className="v">{cape.current}</div>
          </div>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', fontSize: 12, color: 'var(--text-3)' }}>
            <span>역사 평균 <strong style={{ color: 'var(--text-2)' }}>{cape.mean}</strong></span>
            <span>중앙값 <strong style={{ color: 'var(--text-2)' }}>{cape.median}</strong></span>
            <span>최저 <strong style={{ color: 'var(--text-2)' }}>{cape.min}</strong></span>
            <span>최고 <strong style={{ color: 'var(--text-2)' }}>{cape.max}</strong></span>
          </div>
        </div>
      )}
    </SectionCard>
  )
}

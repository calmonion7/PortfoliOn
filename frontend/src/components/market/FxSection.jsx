import { useState, useEffect } from 'react'
import api from '../../api'
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts'
import { CARD_STYLE, DESC_STYLE, SectionCard, SectionCardLoading, SectionCardError } from './marketUtils.jsx'

export default function FxSection() {
  const [open, setOpen] = useState(false)
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    api.get('/api/market/fx')
      .then(r => setData(r.data))
      .catch(() => setError(true))
      .finally(() => setLoading(false))
  }, [])

  if (loading) return <SectionCardLoading title="환율" />
  if (error || !data) return <SectionCardError title="환율" />

  const FX_LABELS = { usdkrw: 'USD/KRW', usdjpy: 'USD/JPY', eurusd: 'EUR/USD' }
  const rates = data.rates || {}
  const usdkrwHistory = (data.history?.usdkrw || []).slice(-252)

  const r = rates.usdkrw
  const summary = r ? r.current.toLocaleString() : ''

  return (
    <SectionCard title="환율" summary={summary} change={r?.change_pct ?? null} changeSuffix="%" open={open} onToggle={() => setOpen(o => !o)}>
      <p style={DESC_STYLE}>원/달러 환율은 수출 기업 수익성과 외국인 자금 흐름에 직접 영향을 미칩니다. 달러 강세(원화 약세)는 수출 채산성 개선 요인이지만 수입 물가 상승을 유발합니다. 엔화·위안화는 경쟁국 통화 동향 파악에 활용합니다.</p>
      <div style={{ display: 'flex', gap: 12, marginBottom: 20, flexWrap: 'wrap' }}>
        {['usdkrw', 'usdjpy', 'eurusd'].map(key => {
          const r = rates[key]
          const up = r?.change_pct > 0
          const down = r?.change_pct < 0
          return (
            <div key={key} style={{ ...CARD_STYLE, minWidth: 110, flex: 1 }}>
              <div style={{ fontSize: 11, color: 'var(--text-3)', marginBottom: 4 }}>{FX_LABELS[key]}</div>
              <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--text)' }}>
                {r ? r.current.toLocaleString() : '-'}
              </div>
              {r && (
                <div style={{ fontSize: 12, color: up ? 'var(--up)' : down ? 'var(--down)' : 'var(--text-3)', marginTop: 2 }}>
                  {up ? '▲' : down ? '▼' : '─'} {Math.abs(r.change_pct).toFixed(2)}%
                </div>
              )}
            </div>
          )
        })}
      </div>
      {usdkrwHistory.length > 0 && (
        <div style={CARD_STYLE}>
          <div style={{ fontSize: 12, color: 'var(--text-3)', marginBottom: 8 }}>USD/KRW 추이 (1년)</div>
          <ResponsiveContainer width="100%" height={180}>
            <LineChart data={usdkrwHistory} margin={{ top: 4, right: 16, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
              <XAxis dataKey="date" tick={{ fontSize: 10, fill: 'var(--text-3)' }}
                     tickFormatter={v => v.slice(5)} interval={Math.floor(usdkrwHistory.length / 6)} />
              <YAxis tick={{ fontSize: 10, fill: 'var(--text-3)' }} domain={['auto', 'auto']} width={48} />
              <Tooltip contentStyle={{ background: 'var(--bg-elev)', border: '1px solid var(--border)', fontSize: 12 }}
                       labelStyle={{ color: 'var(--text-3)' }} />
              <Line type="monotone" dataKey="value" name="USD/KRW" stroke="var(--data-2)" dot={false} strokeWidth={1.5} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
    </SectionCard>
  )
}

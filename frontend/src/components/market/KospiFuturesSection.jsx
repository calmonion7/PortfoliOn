import { useState, useEffect } from 'react'
import api from '../../api'
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts'
import { CARD_STYLE, DESC_STYLE, SectionCard, SectionCardLoading, SectionCardError } from './marketUtils.jsx'

export default function KospiFuturesSection() {
  const [open, setOpen] = useState(false)
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    api.get('/api/market/kospi-futures')
      .then(r => setData(r.data))
      .catch(() => setError(true))
      .finally(() => setLoading(false))
  }, [])

  if (loading) return <SectionCardLoading title="코스피200 선물" />
  if (error) return <SectionCardError title="코스피200 선물" />

  const cur = data?.current
  const history = data?.history || []

  if (!cur) {
    return (
      <SectionCard title="코스피200 선물" open={open} onToggle={() => setOpen(o => !o)}>
        <p style={DESC_STYLE}>코스피200 선물 데이터를 사용할 수 없습니다. (KIS 연동 미설정)</p>
      </SectionCard>
    )
  }

  const up = cur.change_pct > 0
  const down = cur.change_pct < 0
  const lineColor = up ? 'var(--up)' : down ? 'var(--down)' : 'var(--data-2)'
  const basisLabel = cur.basis > 0 ? '콘탱고' : cur.basis < 0 ? '백워데이션' : null

  return (
    <SectionCard title="코스피200 선물" summary={cur.price?.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                 change={cur.change_pct ?? null} changeSuffix="%" open={open} onToggle={() => setOpen(o => !o)}>
      <p style={DESC_STYLE}>코스피200 최근월물 선물의 현재가와 추이입니다. 베이시스(선물가-현물가)가 양수면 콘탱고(선물 고평가), 음수면 백워데이션(선물 저평가)을 의미합니다.</p>

      <div style={{ display: 'flex', gap: 12, marginBottom: 20, flexWrap: 'wrap' }}>
        <div style={{ ...CARD_STYLE, minWidth: 110, flex: 1 }}>
          <div style={{ fontSize: 11, color: 'var(--text-3)', marginBottom: 4 }}>{cur.contract || '최근월물'}</div>
          <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--text)' }}>
            {cur.price != null ? cur.price.toLocaleString(undefined, { maximumFractionDigits: 2 }) : '-'}
          </div>
          {cur.change_pct != null && (
            <div style={{ fontSize: 12, color: up ? 'var(--up)' : down ? 'var(--down)' : 'var(--text-3)', marginTop: 2 }}>
              {up ? '▲' : down ? '▼' : '─'} {Math.abs(cur.change_pct).toFixed(2)}%
            </div>
          )}
        </div>
        <div style={{ ...CARD_STYLE, minWidth: 110, flex: 1 }}>
          <div style={{ fontSize: 11, color: 'var(--text-3)', marginBottom: 4 }}>베이시스{basisLabel ? ` (${basisLabel})` : ''}</div>
          <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--text)' }}>
            {cur.basis != null ? cur.basis.toFixed(2) : '-'}
          </div>
        </div>
      </div>

      {history.length > 0 && (
        <div style={CARD_STYLE}>
          <div style={{ fontSize: 12, color: 'var(--text-3)', marginBottom: 8 }}>일봉 종가 추이</div>
          <ResponsiveContainer width="100%" height={180}>
            <LineChart data={history} margin={{ top: 4, right: 16, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
              <XAxis dataKey="date" tick={{ fontSize: 10, fill: 'var(--text-3)' }}
                     tickFormatter={v => v.slice(5)} interval={Math.floor(history.length / 6)} />
              <YAxis tick={{ fontSize: 10, fill: 'var(--text-3)' }} domain={['auto', 'auto']} width={52} />
              <Tooltip contentStyle={{ background: 'var(--bg-elev)', border: '1px solid var(--border)', fontSize: 12 }}
                       labelStyle={{ color: 'var(--text-3)' }} />
              <Line type="monotone" dataKey="close" name="종가" stroke={lineColor} dot={false} strokeWidth={1.5} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
    </SectionCard>
  )
}

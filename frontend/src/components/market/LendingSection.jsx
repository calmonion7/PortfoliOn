import { useState, useEffect } from 'react'
import api from '../../api'
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, Legend, ResponsiveContainer,
} from 'recharts'
import { CARD_STYLE, DESC_STYLE, SectionCard, SectionCardLoading, SectionCardError } from './marketUtils.jsx'

export default function LendingSection() {
  const [open, setOpen] = useState(false)
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    api.get('/api/market/lending')
      .then(r => setData(r.data))
      .catch(() => setError(true))
      .finally(() => setLoading(false))
  }, [])

  if (loading) return <SectionCardLoading title="대차잔고 추이" />
  if (error)   return <SectionCardError title="대차잔고 추이" />

  const history = data?.history ?? []
  const latest  = data?.latest

  const xFmt = (d) => d ? d.slice(0, 7) : ''

  return (
    <SectionCard
      title="대차잔고 추이 (내외국인)"
      open={open}
      onToggle={() => setOpen(o => !o)}
      badge={
        latest ? (
          <span style={{ fontSize: 12, color: '#888', marginLeft: 8 }}>
            외국인 차입 {latest.foreign_borrow?.toFixed(1)}조 · 내국인 차입 {latest.domestic_borrow?.toFixed(1)}조
          </span>
        ) : null
      }
    >
      <p style={DESC_STYLE}>
        한국증권금융 내외국인 대차잔고 비교 (월별, 단위: 조원). 외국인 차입잔액 증가는 공매도 압력 신호입니다.
      </p>

      {history.length > 0 ? (
        <ResponsiveContainer width="100%" height={280}>
          <LineChart data={history} margin={{ top: 4, right: 16, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#2a2a2a" />
            <XAxis
              dataKey="date"
              tickFormatter={xFmt}
              tick={{ fontSize: 11, fill: '#888' }}
              interval="preserveStartEnd"
            />
            <YAxis
              tick={{ fontSize: 11, fill: '#888' }}
              tickFormatter={v => `${v.toFixed(0)}조`}
              width={48}
            />
            <Tooltip
              contentStyle={{ background: '#1a1a1a', border: '1px solid #333', fontSize: 12 }}
              formatter={(v, name) => [`${Number(v).toFixed(1)}조원`, name]}
              labelFormatter={xFmt}
            />
            <Legend wrapperStyle={{ fontSize: 12 }} />
            <Line type="monotone" dataKey="foreign_borrow" name="외국인 차입" stroke="#ef4444" dot={false} strokeWidth={2} />
            <Line type="monotone" dataKey="domestic_borrow" name="내국인 차입" stroke="#3b82f6" dot={false} strokeWidth={2} />
            <Line type="monotone" dataKey="foreign_lend" name="외국인 대여" stroke="#f97316" dot={false} strokeWidth={1.5} strokeDasharray="4 2" />
            <Line type="monotone" dataKey="domestic_lend" name="내국인 대여" stroke="#6366f1" dot={false} strokeWidth={1.5} strokeDasharray="4 2" />
          </LineChart>
        </ResponsiveContainer>
      ) : (
        <p style={{ color: '#666', fontSize: 13 }}>데이터 없음 — 관리자 메뉴에서 동기화하세요.</p>
      )}
    </SectionCard>
  )
}

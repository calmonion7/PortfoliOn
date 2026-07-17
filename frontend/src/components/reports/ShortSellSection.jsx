import { useState, useEffect } from 'react'
import { ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts'
import api from '../../api'
import { krFmt } from '../market/marketUtils.jsx'
import { SectionTitle } from './reportUtils.jsx'

// 종목 공매도 추이 차트 (거래량 막대 + 비중% 라인, 잔고·거래대금은 툴팁/헤더). KR 전용.
// 키움 ka10014 → /api/stocks/{ticker}/short-sell. 수급 추이(InvestorTrendSection) 옆에 배치.

// 주식 수량(주) 컴팩트 포매터 — krFmt는 '억원' 입력 가정이라 주 단위엔 부적합.
const fmtShares = (v) => {
  if (v == null) return '—'
  const n = Math.abs(Number(v))
  if (n >= 1e8) return `${(n / 1e8).toFixed(1)}억`
  if (n >= 1e4) return `${Math.round(n / 1e4)}만`
  return String(Math.round(n))
}

// 거래대금(원) → krFmt(억 입력)용으로 원/1e8 변환 후 '원' 부착.
const wonFmt = (v) => `${krFmt((Number(v) || 0) / 1e8)}원`

function ShortTooltip({ active, payload }) {
  if (!active || !payload || !payload.length) return null
  const r = payload[0].payload
  const row = (label, val) => (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
      <span style={{ color: 'var(--text-3)' }}>{label}</span><span className="mono tnum">{val}</span>
    </div>
  )
  return (
    <div style={{ background: 'var(--bg-elev)', border: '1px solid var(--border)', fontSize: 12, padding: '6px 8px' }}>
      <div style={{ marginBottom: 4 }}>{r.date}</div>
      {row('공매도 비중', r.ratio != null ? `${r.ratio.toFixed(2)}%` : '—')}
      {row('공매도 거래량', `${Number(r.vol).toLocaleString('ko-KR')}주`)}
      {row('공매도 거래대금', wonFmt(r.value))}
      {row('공매도 잔량', `${Number(r.balance).toLocaleString('ko-KR')}주`)}
    </div>
  )
}

export default function ShortSellSection({ ticker }) {
  const [data, setData] = useState(null)   // null=로딩, []=없음
  const [error, setError] = useState(false)
  useEffect(() => {
    let cancelled = false
    setData(null)
    setError(false)
    api.get(`/api/stocks/${ticker}/short-sell`, { params: { days: 252 } })
      .then(({ data }) => { if (!cancelled) setData(data.items || []) })
      .catch(() => { if (!cancelled) setError(true) })
    return () => { cancelled = true }
  }, [ticker])

  let chart = []
  if (Array.isArray(data)) {
    chart = data.map(r => ({
      date: r.base_date ? r.base_date.slice(5) : r.base_date,  // MM-DD
      vol: r.short_volume,
      ratio: r.short_ratio,
      value: r.short_value,
      balance: r.short_balance,
    }))
  }
  const latest = chart.length ? chart[chart.length - 1] : null

  return (
    <div style={{ marginTop: 18 }}>
      <SectionTitle>공매도 추이</SectionTitle>
      {error ? (
        <p style={{ fontSize: 12, color: 'var(--text-3)', margin: 0 }}>공매도 추이를 불러오지 못했습니다.</p>
      ) : data === null ? (
        <p style={{ fontSize: 12, color: 'var(--text-3)', margin: 0 }}>공매도 추이 불러오는 중…</p>
      ) : chart.length === 0 ? (
        <p style={{ fontSize: 12, color: 'var(--text-3)', margin: 0 }}>공매도 데이터가 없습니다.</p>
      ) : (
        <>
          <div style={{ fontSize: 11, color: 'var(--text-3)', marginBottom: 6 }}>
            공매도 거래량(주, 막대) + 비중(%, 라인)
            {latest && <> · 최신 잔량 {Number(latest.balance).toLocaleString('ko-KR')}주 · 거래대금 {wonFmt(latest.value)}</>}
          </div>
          <ResponsiveContainer width="100%" height={240}>
            <ComposedChart data={chart} margin={{ top: 8, right: 4, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
              <XAxis dataKey="date" tick={{ fontSize: 10, fill: 'var(--text-3)' }} minTickGap={24} />
              <YAxis yAxisId="left" tick={{ fontSize: 10, fill: 'var(--text-3)' }} domain={['auto', 'auto']} width={52}
                     tickFormatter={v => fmtShares(v)} />
              <YAxis yAxisId="right" orientation="right" domain={['auto', 'auto']} tick={{ fontSize: 10, fill: 'var(--data-3)' }}
                     tickFormatter={v => `${v}%`} width={40} />
              <Tooltip content={<ShortTooltip />} />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Bar yAxisId="left" dataKey="vol" name="공매도 거래량" fill="var(--data-4)" />
              <Line yAxisId="right" type="monotone" dataKey="ratio" name="공매도 비중(%)" stroke="var(--data-3)" dot={false} strokeWidth={2} />
            </ComposedChart>
          </ResponsiveContainer>
        </>
      )}
    </div>
  )
}

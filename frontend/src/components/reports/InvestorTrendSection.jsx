import { useState, useEffect } from 'react'
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts'
import api from '../../api'
import { krFmt } from '../market/marketUtils.jsx'

// 종목 수급 추이 차트 (외국인/기관/개인 누적 순매수 + 외국인 보유율). KR 전용.
// 랭킹 모달과 리포트 상세에서 공유.
export default function InvestorTrendSection({ ticker }) {
  const [data, setData] = useState(null)   // null=로딩, []=없음
  const [error, setError] = useState(false)
  useEffect(() => {
    let cancelled = false
    setData(null)
    setError(false)
    api.get(`/api/stocks/${ticker}/investor-trend`, { params: { days: 252 } })
      .then(({ data }) => { if (!cancelled) setData(data.items || []) })
      .catch(() => { if (!cancelled) setError(true) })
    return () => { cancelled = true }
  }, [ticker])

  // 누적 순매수 계산 (base_date 오름차순 시계열).
  let chart = []
  if (Array.isArray(data)) {
    let f = 0, o = 0, ind = 0
    chart = data.map(r => {
      f += r.foreign_net || 0
      o += r.organ_net || 0
      ind += r.individual_net || 0
      return {
        date: r.base_date ? r.base_date.slice(5) : r.base_date,  // MM-DD
        foreign: f, organ: o, individual: ind,
        hold: r.foreign_hold_ratio,
      }
    })
  }

  return (
    <div style={{ marginTop: 18 }}>
      <div style={{ fontWeight: 600, fontSize: 13, color: 'var(--accent)', marginBottom: 8 }}>수급 추이</div>
      {error ? (
        <p style={{ fontSize: 12, color: 'var(--text-3)', margin: 0 }}>수급 추이를 불러오지 못했습니다.</p>
      ) : data === null ? (
        <p style={{ fontSize: 12, color: 'var(--text-3)', margin: 0 }}>수급 추이 불러오는 중…</p>
      ) : chart.length === 0 ? (
        <p style={{ fontSize: 12, color: 'var(--text-3)', margin: 0 }}>수급 데이터가 없습니다.</p>
      ) : (
        <>
          <div style={{ fontSize: 11, color: 'var(--text-3)', marginBottom: 6 }}>누적 순매수(수량) 외국인·기관·개인 + 외국인 보유율(%)</div>
          <ResponsiveContainer width="100%" height={240}>
            <LineChart data={chart} margin={{ top: 8, right: 4, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
              <XAxis dataKey="date" tick={{ fontSize: 10, fill: 'var(--text-3)' }} minTickGap={24} />
              <YAxis yAxisId="left" tick={{ fontSize: 10, fill: 'var(--text-3)' }} domain={['auto', 'auto']} width={52}
                     tickFormatter={v => krFmt(v)} />
              <YAxis yAxisId="right" orientation="right" domain={['auto', 'auto']} tick={{ fontSize: 10, fill: '#ffb74d' }}
                     tickFormatter={v => `${v}%`} width={40} />
              <Tooltip contentStyle={{ background: 'var(--bg-elev)', border: '1px solid var(--border)', fontSize: 12 }}
                       formatter={(v, n) => n === '외국인 보유율' ? [`${v?.toFixed(2)}%`, n] : [Number(v).toLocaleString('ko-KR'), n]} />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Line yAxisId="left" type="monotone" dataKey="foreign" name="외국인" stroke="#4fc3f7" dot={false} strokeWidth={2} />
              <Line yAxisId="left" type="monotone" dataKey="organ" name="기관" stroke="#81c784" dot={false} strokeWidth={2} />
              <Line yAxisId="left" type="monotone" dataKey="individual" name="개인" stroke="#ef9a9a" dot={false} strokeWidth={2} />
              <Line yAxisId="right" type="monotone" dataKey="hold" name="외국인 보유율" stroke="#ffb74d" dot={false} strokeWidth={1.5} strokeDasharray="4 2" />
            </LineChart>
          </ResponsiveContainer>
        </>
      )}
    </div>
  )
}

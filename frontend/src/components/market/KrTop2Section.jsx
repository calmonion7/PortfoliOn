import { useState, useEffect } from 'react'
import api from '../../api'
import { LineChart, Line, LabelList, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts'
import { CARD_STYLE, SECTION_STYLE, SECTION_HEADER_STYLE, DESC_STYLE, LoadingBox, ErrorBox, krFmt, isEstimated } from './marketUtils.jsx'
import useIsMobile from '../../hooks/useIsMobile'

export default function KrTop2Section() {
  const isMobile = useIsMobile()
  const [open, setOpen] = useState(false)
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    api.get('/api/market/kr-top2-earnings')
      .then(r => setData(r.data))
      .catch(() => setError(true))
      .finally(() => setLoading(false))
  }, [])

  if (loading) return <div style={SECTION_STYLE}><h3 style={SECTION_HEADER_STYLE}>삼성전자+SK하이닉스 vs KOSPI 나머지 전체 순이익</h3><LoadingBox /></div>
  if (error || !data) return <div style={SECTION_STYLE}><h3 style={SECTION_HEADER_STYLE}>삼성전자+SK하이닉스 vs KOSPI 나머지 전체 순이익</h3><ErrorBox /></div>

  const lastActIdx = data.quarters.reduce((acc, q, i) => (!q.estimated ? i : acc), -1)
  const qs = data.quarters.map((q, i) => ({
    ...q,
    top2share: q.top2 != null && q.rest != null ? q.top2 / (q.top2 + q.rest) * 100 : null,
    top2_act: q.estimated ? null : q.top2,
    top2_est: (q.estimated || i === lastActIdx) ? q.top2 : null,
  }))
  const latest = qs[lastActIdx] ?? qs[qs.length - 1]
  const prev = qs[lastActIdx - 1] ?? null
  const [latestYear2, latestQNum2] = latest?.q?.split('Q') || []
  const yoy2 = qs.find(q => q.q === `${parseInt(latestYear2) - 1}Q${latestQNum2}` && !q.estimated)
  const chg2 = (cur, base) => base ? ((cur - base) / Math.abs(base) * 100) : null
  const top2Share = latest ? (latest.top2 / (latest.top2 + latest.rest) * 100) : null
  const top2SharePrev = yoy2 ? (yoy2.top2 / (yoy2.top2 + yoy2.rest) * 100) : null

  return (
    <div style={SECTION_STYLE}>
      {isMobile ? (
        <button className="accordion-header" onClick={() => setOpen(o => !o)}>
          <span style={SECTION_HEADER_STYLE}>삼성전자+SK하이닉스 vs KOSPI 나머지 전체 순이익</span>
          <span>{open ? '▲' : '▼'}</span>
        </button>
      ) : (
        <h3 style={SECTION_HEADER_STYLE}>삼성전자+SK하이닉스 vs KOSPI 나머지 전체 순이익</h3>
      )}
      {(!isMobile || open) && (
        <>
      <p style={DESC_STYLE}>삼성전자·SK하이닉스 두 반도체 대장주의 분기 순이익과 KOSPI 전체 나머지 종목을 비교합니다. 비중이 높을수록 한국 증시가 반도체 업황에 구조적으로 집중되어 있음을 나타냅니다. <span style={{ opacity: 0.7 }}>(E) = 네이버 컨센서스 추정치</span></p>
      <div style={{ display: 'flex', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
        {[
          { label: '삼성+하이닉스', value: latest?.top2, qoq: chg2(latest?.top2, prev?.top2), yoy: chg2(latest?.top2, yoy2?.top2), color: '#4fc3f7' },
          { label: 'KOSPI 나머지 전체', value: latest?.rest, qoq: chg2(latest?.rest, prev?.rest), yoy: chg2(latest?.rest, yoy2?.rest), color: '#80cbc4' },
        ].map(({ label, value, qoq, yoy: yoyChg, color }) => (
          <div key={label} style={{ ...CARD_STYLE, minWidth: 140, flex: 1 }}>
            <div style={{ fontSize: 11, color: 'var(--text-3)', marginBottom: 4 }}>{label} 순이익 ({latest?.q})</div>
            <div style={{ fontSize: 20, fontWeight: 700, color }}>
              {krFmt(value)} <span style={{ fontSize: 11, fontWeight: 400 }}>원</span>
            </div>
            {qoq != null && (
              <div style={{ fontSize: 12, color: qoq > 0 ? '#81c784' : '#e57373', marginTop: 3 }}>
                {qoq > 0 ? '▲' : '▼'} {Math.abs(qoq).toFixed(1)}% <span style={{ color: 'var(--text-3)' }}>QoQ</span>
              </div>
            )}
            {yoyChg != null && (
              <div style={{ fontSize: 12, color: yoyChg > 0 ? '#81c784' : '#e57373', marginTop: 2 }}>
                {yoyChg > 0 ? '▲' : '▼'} {Math.abs(yoyChg).toFixed(1)}% <span style={{ color: 'var(--text-3)' }}>YoY</span>
              </div>
            )}
          </div>
        ))}
        <div style={{ ...CARD_STYLE, minWidth: 120, flex: 1 }}>
          <div style={{ fontSize: 11, color: 'var(--text-3)', marginBottom: 4 }}>삼성+하이닉스 순이익 비중</div>
          <div style={{ fontSize: 20, fontWeight: 700, color: '#ffb74d' }}>
            {top2Share != null ? top2Share.toFixed(1) : '-'}<span style={{ fontSize: 13 }}>%</span>
          </div>
          {top2Share != null && top2SharePrev != null && (
            <div style={{ fontSize: 12, color: top2Share > top2SharePrev ? '#81c784' : '#e57373', marginTop: 3 }}>
              {top2Share > top2SharePrev ? '▲' : '▼'} {Math.abs(top2Share - top2SharePrev).toFixed(1)}%p <span style={{ color: 'var(--text-3)' }}>YoY</span>
            </div>
          )}
          <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 2 }}>삼성+하이닉스 / KOSPI 전체</div>
        </div>
      </div>
      <div style={CARD_STYLE}>
        <div style={{ fontSize: 12, color: 'var(--text-3)', marginBottom: 8 }}>
          분기별 순이익 추이 — 삼성전자(005930) + SK하이닉스(000660) vs KOSPI 나머지 전체 &nbsp;·&nbsp; 점선=(E) 컨센서스
        </div>
        <ResponsiveContainer width="100%" height={240}>
          <LineChart data={qs} margin={{ top: 16, right: 40, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
            <XAxis dataKey="q" tick={{ fontSize: 10, fill: 'var(--text-3)' }} tickFormatter={v => isEstimated(v) ? `${v}(E)` : v} />
            <YAxis yAxisId="left" tick={{ fontSize: 10, fill: 'var(--text-3)' }} domain={['auto', 'auto']} tickFormatter={krFmt} />
            <YAxis yAxisId="right" orientation="right" domain={[0, 100]} tick={{ fontSize: 10, fill: '#ffb74d' }} tickFormatter={v => `${v}%`} />
            <Tooltip contentStyle={{ background: 'var(--bg-elev)', border: '1px solid var(--border)', fontSize: 12 }}
                     formatter={(v, n) => n === '삼성+하이닉스 비중' ? [`${v?.toFixed(1)}%`, n] : [v != null ? `${krFmt(v)}원` : '-', n]} />
            <Legend wrapperStyle={{ fontSize: 12 }} />
            <Line yAxisId="left" type="monotone" dataKey="top2_act" name="삼성+하이닉스" stroke="#4fc3f7" dot={{ r: 3 }} strokeWidth={2} connectNulls={false}>
              <LabelList dataKey="top2_act" position="top" style={{ fontSize: 9, fill: '#4fc3f7' }} formatter={krFmt} />
            </Line>
            <Line yAxisId="left" type="monotone" dataKey="top2_est" name="삼성+하이닉스 (E)" stroke="#4fc3f7" dot={{ r: 3 }} strokeWidth={1.5} strokeDasharray="5 3" connectNulls={false} legendType="none" />
            <Line yAxisId="left" type="monotone" dataKey="rest" name="KOSPI 나머지 전체" stroke="#80cbc4" dot={{ r: 3 }} strokeWidth={2}>
              <LabelList dataKey="rest" position="bottom" style={{ fontSize: 9, fill: '#80cbc4' }} formatter={krFmt} />
            </Line>
            <Line yAxisId="right" type="monotone" dataKey="top2share" name="삼성+하이닉스 비중" stroke="#ffb74d" dot={false} strokeWidth={1.5} strokeDasharray="4 2" />
          </LineChart>
        </ResponsiveContainer>
      </div>
        </>
      )}
    </div>
  )
}

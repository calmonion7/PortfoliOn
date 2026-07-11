import { useState, useEffect } from 'react'
import api from '../../api'
import { LineChart, Line, LabelList, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts'
import { DESC_STYLE, SectionCard, SectionCardLoading, SectionCardError, krFmt, isEstimated } from './marketUtils.jsx'

export default function KrTop2Section() {
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

  if (loading) return <SectionCardLoading title="삼성전자+SK하이닉스 vs KOSPI 나머지 전체 순이익" />
  if (error || !data) return <SectionCardError title="삼성전자+SK하이닉스 vs KOSPI 나머지 전체 순이익" />

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

  const summary = top2Share != null ? `Top2 ${top2Share.toFixed(1)}%` : ''
  const shareChg = (top2Share != null && top2SharePrev != null) ? (top2Share - top2SharePrev) : null

  return (
    <SectionCard title="삼성전자+SK하이닉스 vs KOSPI 나머지 전체 순이익" summary={summary} change={shareChg} changeSuffix="%p" open={open} onToggle={() => setOpen(o => !o)}>
      <p style={DESC_STYLE}>삼성전자·SK하이닉스 두 반도체 대장주의 분기 순이익과 KOSPI 전체 나머지 종목을 비교합니다. 비중이 높을수록 한국 증시가 반도체 업황에 구조적으로 집중되어 있음을 나타냅니다. <span style={{ opacity: 0.7 }}>(E) = 네이버 컨센서스 추정치</span></p>
      <div style={{ display: 'flex', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
        {[
          { label: '삼성+하이닉스', value: latest?.top2, qoq: chg2(latest?.top2, prev?.top2), yoy: chg2(latest?.top2, yoy2?.top2), prevVal: prev?.top2, prevQ: prev?.q, yoyVal: yoy2?.top2, yoyQ: yoy2?.q, color: 'var(--data-2)' },
          { label: 'KOSPI 나머지 전체', value: latest?.rest, qoq: chg2(latest?.rest, prev?.rest), yoy: chg2(latest?.rest, yoy2?.rest), prevVal: prev?.rest, prevQ: prev?.q, yoyVal: yoy2?.rest, yoyQ: yoy2?.q, color: 'var(--data-5)' },
        ].map(({ label, value, qoq, yoy: yoyChg, prevVal, prevQ, yoyVal, yoyQ, color }) => (
          <div key={label} className="metric-tile" style={{ minWidth: 140, flex: 1 }}>
            <div className="lbl">{label} 순이익 ({latest?.q})</div>
            <div className="v" style={{ color }}>
              {krFmt(value)} <span style={{ fontSize: 11, fontWeight: 400 }}>원</span>
            </div>
            {qoq != null && (
              <>
                <div className="d" style={{ color: qoq > 0 ? 'var(--up)' : 'var(--down)' }}>
                  {qoq > 0 ? '▲' : '▼'} {Math.abs(qoq).toFixed(1)}% <span style={{ color: 'var(--text-3)' }}>QoQ</span>
                </div>
                {prevVal != null && <div style={{ fontSize: 10, color: 'var(--text-3)', marginTop: 1 }}>전분기 {krFmt(prevVal)}원 ({prevQ})</div>}
              </>
            )}
            {yoyChg != null && (
              <>
                <div className="d" style={{ color: yoyChg > 0 ? 'var(--up)' : 'var(--down)' }}>
                  {yoyChg > 0 ? '▲' : '▼'} {Math.abs(yoyChg).toFixed(1)}% <span style={{ color: 'var(--text-3)' }}>YoY</span>
                </div>
                {yoyVal != null && <div style={{ fontSize: 10, color: 'var(--text-3)', marginTop: 1 }}>전년동기 {krFmt(yoyVal)}원 ({yoyQ})</div>}
              </>
            )}
          </div>
        ))}
        <div className="metric-tile" style={{ minWidth: 120, flex: 1 }}>
          <div className="lbl">삼성+하이닉스 순이익 비중</div>
          <div className="v" style={{ color: 'var(--data-3)' }}>
            {top2Share != null ? top2Share.toFixed(1) : '-'}<span style={{ fontSize: 13 }}>%</span>
          </div>
          {top2Share != null && top2SharePrev != null && (
            <>
              <div className="d" style={{ color: top2Share > top2SharePrev ? 'var(--up)' : 'var(--down)' }}>
                {top2Share > top2SharePrev ? '▲' : '▼'} {Math.abs(top2Share - top2SharePrev).toFixed(1)}%p <span style={{ color: 'var(--text-3)' }}>YoY</span>
              </div>
              <div style={{ fontSize: 10, color: 'var(--text-3)', marginTop: 1 }}>전년동기 {top2SharePrev.toFixed(1)}% ({yoy2?.q})</div>
            </>
          )}
          <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 2 }}>삼성+하이닉스 / KOSPI 전체</div>
        </div>
      </div>
      <div className="chartbox">
        <div className="sub">
          분기별 순이익 추이 — 삼성전자(005930) + SK하이닉스(000660) vs KOSPI 나머지 전체 &nbsp;·&nbsp; 점선=(E) 컨센서스
        </div>
        <ResponsiveContainer width="100%" height={240}>
          <LineChart data={qs} margin={{ top: 16, right: 4, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
            <XAxis dataKey="q" tick={{ fontSize: 10, fill: 'var(--text-3)' }} tickFormatter={v => isEstimated(v) ? `${v}(E)` : v} />
            <YAxis yAxisId="left" tick={{ fontSize: 10, fill: 'var(--text-3)' }} domain={['auto', 'auto']} tickFormatter={krFmt} width={44} />
            <YAxis yAxisId="right" orientation="right" domain={[0, 100]} tick={{ fontSize: 10, fill: 'var(--data-3)' }} tickFormatter={v => `${v}%`} width={36} />
            <Tooltip contentStyle={{ background: 'var(--bg-elev)', border: '1px solid var(--border)', fontSize: 12 }}
                     formatter={(v, n) => n === '삼성+하이닉스 비중' ? [`${v?.toFixed(1)}%`, n] : [v != null ? `${krFmt(v)}원` : '-', n]} />
            <Legend wrapperStyle={{ fontSize: 12 }} />
            <Line yAxisId="left" type="monotone" dataKey="top2_act" name="삼성+하이닉스" stroke="var(--data-2)" dot={{ r: 3 }} strokeWidth={2} connectNulls={false}>
              <LabelList dataKey="top2_act" position="top" style={{ fontSize: 9, fill: 'var(--data-2)' }} formatter={krFmt} />
            </Line>
            <Line yAxisId="left" type="monotone" dataKey="top2_est" name="삼성+하이닉스 (E)" stroke="var(--data-2)" dot={{ r: 3 }} strokeWidth={1.5} strokeDasharray="5 3" connectNulls={false} legendType="none" />
            <Line yAxisId="left" type="monotone" dataKey="rest" name="KOSPI 나머지 전체" stroke="var(--data-5)" dot={{ r: 3 }} strokeWidth={2}>
              <LabelList dataKey="rest" position="bottom" style={{ fontSize: 9, fill: 'var(--data-5)' }} formatter={krFmt} />
            </Line>
            <Line yAxisId="right" type="monotone" dataKey="top2share" name="삼성+하이닉스 비중" stroke="var(--data-3)" dot={false} strokeWidth={1.5} strokeDasharray="4 2" />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </SectionCard>
  )
}

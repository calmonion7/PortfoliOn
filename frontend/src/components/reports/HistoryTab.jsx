import { useState, useEffect } from 'react'
import api from '../../api'
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine, Legend } from 'recharts'
import { fmtPrice as fmt } from '../../utils'
import { TH, TD } from './reportUtils.jsx'

export default function HistoryTab({ ticker, market }) {
  const [history, setHistory] = useState([])
  const [histLoading, setHistLoading] = useState(false)
  const [histError, setHistError] = useState(null)
  const [trendTab, setTrendTab] = useState('target')
  const [compareA, setCompareA] = useState(null)
  const [compareB, setCompareB] = useState(null)
  const [snapshotA, setSnapshotA] = useState(null)
  const [snapshotB, setSnapshotB] = useState(null)

  // ⚠️ 레이스 성립 조건 (B49) — **아래 세 이펙트는 모두 같은 마운트에서 재실행된다.**
  // 비교 날짜 select를 빠르게 두 번 바꾸면 같은 상태(`snapshotA`/`snapshotB`)를 쓰는
  // 비동기 호출이 2개 이상 겹치고, 먼저 보낸 요청이 늦게 도착하면 **낡은 날짜의 수치가
  // 사용자가 고른 날짜 칼럼에 렌더된다**(표 헤더는 새 날짜, 값은 옛 날짜 — 조용한 오표시).
  // 티커 전환은 부모가 `key={ticker}`로 재마운트해 구조적으로 차단되지만(Reports.jsx·
  // Ranking.jsx) 그 `key`를 떼는 리팩터 한 번으로 되살아나므로 여기서 직접 막는다.
  // 세대 가드 관용구는 §9.4 — `.then`뿐 아니라 **`.finally`도 게이트**한다.
  useEffect(() => {
    if (!ticker) return
    let cancelled = false
    setHistLoading(true)
    setHistError(null)
    api.get(`/api/report/${ticker}/history`)
      .then(({ data }) => {
        if (cancelled) return
        setHistory(data)
        const snapDates = data.filter(h => h.has_snapshot)
        if (snapDates.length > 0) setCompareA(snapDates[snapDates.length - 1].date)
        if (snapDates.length > 1) setCompareB(snapDates[snapDates.length - 2].date)
      })
      .catch(() => { if (!cancelled) setHistError('히스토리 데이터를 불러올 수 없습니다.') })
      // 낡은 응답이 로딩 플래그를 열면 그 사이 도착한 새 응답과 겹쳐 화면이 깜빡인다.
      .finally(() => { if (!cancelled) setHistLoading(false) })
    return () => { cancelled = true }
  }, [ticker])

  useEffect(() => {
    if (!ticker || !compareA) return
    let cancelled = false
    api.get(`/api/report/${ticker}/${compareA}`)
      .then(({ data }) => { if (!cancelled) setSnapshotA(data.summary) })
      .catch(() => { if (!cancelled) setSnapshotA(null) })
    return () => { cancelled = true }
  }, [ticker, compareA])

  useEffect(() => {
    if (!ticker || !compareB) return
    let cancelled = false
    api.get(`/api/report/${ticker}/${compareB}`)
      .then(({ data }) => { if (!cancelled) setSnapshotB(data.summary) })
      .catch(() => { if (!cancelled) setSnapshotB(null) })
    return () => { cancelled = true }
  }, [ticker, compareB])

  if (histLoading) return <p style={{ color: 'var(--text-3)', fontSize: 13 }}>로딩 중...</p>
  if (histError) return <p style={{ color: 'var(--color-error)', fontSize: 13 }}>{histError}</p>
  if (history.length === 0) return <p style={{ color: 'var(--text-3)', fontSize: 13 }}>히스토리 데이터가 없습니다.</p>

  const xTickFormatter = (date) => date?.slice(5) ?? ''
  const snapDates = history.filter(h => h.has_snapshot)

  return (
    <div className="anim-fade-up" style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {/* 트렌드 섹션 */}
      <div>
        <div style={{ display: 'flex', gap: 0, marginBottom: 12 }}>
          {[{ key: 'target', label: '목표가' }, { key: 'rsi', label: 'RSI' }].map(({ key, label }) => (
            <button key={key} onClick={() => setTrendTab(key)}
              className={`tab-btn sm${trendTab === key ? ' active' : ''}`}
              style={{ marginBottom: -1, padding: '4px 14px' }}
            >{label}</button>
          ))}
        </div>

        {trendTab === 'target' && (
          <ResponsiveContainer width="100%" height={220}>
            <LineChart data={history} margin={{ top: 4, right: 12, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
              <XAxis dataKey="date" tickFormatter={xTickFormatter} tick={{ fontSize: 10, fill: 'var(--text-3)' }} />
              <YAxis tick={{ fontSize: 10, fill: 'var(--text-3)' }} width={60} tickFormatter={(v) => v != null ? fmt(v, market) : ''} />
              <Tooltip
                contentStyle={{ background: 'var(--bg-elev)', border: '1px solid var(--border)', fontSize: 11 }}
                formatter={(v, name) => [v != null ? fmt(v, market) : 'N/A', name]}
              />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Line type="monotone" dataKey="target_high" name="최고" stroke="var(--data-2)" strokeWidth={1} dot={false} connectNulls={false} />
              <Line type="monotone" dataKey="target_mean" name="평균" stroke="var(--accent)" strokeWidth={2} dot={false} connectNulls={false} />
              <Line type="monotone" dataKey="target_low" name="최저" stroke="var(--data-3)" strokeWidth={1} dot={false} connectNulls={false} />
              <Line type="monotone" dataKey="price" name="현재가" stroke="var(--data-4)" strokeWidth={1} strokeDasharray="4 2" dot={false} connectNulls={false} />
            </LineChart>
          </ResponsiveContainer>
        )}

        {trendTab === 'rsi' && (
          <ResponsiveContainer width="100%" height={220}>
            <LineChart data={history} margin={{ top: 4, right: 12, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
              <XAxis dataKey="date" tickFormatter={xTickFormatter} tick={{ fontSize: 10, fill: 'var(--text-3)' }} />
              <YAxis domain={[0, 100]} tick={{ fontSize: 10, fill: 'var(--text-3)' }} width={30} />
              <Tooltip contentStyle={{ background: 'var(--bg-elev)', border: '1px solid var(--border)', fontSize: 11 }} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <ReferenceLine y={70} stroke="var(--semantic-sell)" strokeDasharray="4 2" label={{ value: '과매수', fill: 'var(--semantic-sell)', fontSize: 10 }} />
              <ReferenceLine y={30} stroke="var(--semantic-buy)" strokeDasharray="4 2" label={{ value: '과매도', fill: 'var(--semantic-buy)', fontSize: 10 }} />
              <Line type="monotone" dataKey="rsi_daily" name="일" stroke="var(--accent)" strokeWidth={2} dot={false} connectNulls={false} />
              <Line type="monotone" dataKey="rsi_weekly" name="주" stroke="var(--data-2)" strokeWidth={1.5} dot={false} connectNulls={false} />
              <Line type="monotone" dataKey="rsi_monthly" name="월" stroke="var(--data-3)" strokeWidth={1.5} dot={false} connectNulls={false} />
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>

      {/* 날짜 비교 섹션 */}
      <div>
        <div style={{ display: 'flex', gap: 12, marginBottom: 12, alignItems: 'center' }}>
          <select value={compareA ?? ''} onChange={e => setCompareA(e.target.value)}
            className="mono"
            style={{ background: 'var(--bg-elev)', color: 'var(--text)', border: '1px solid var(--border)', borderRadius: 4, padding: '3px 8px', fontSize: 12 }}>
            {snapDates.map(h => <option key={h.date} value={h.date}>{h.date}</option>)}
          </select>
          <span style={{ color: 'var(--text-3)', fontSize: 12 }}>vs</span>
          <select value={compareB ?? ''} onChange={e => setCompareB(e.target.value)}
            className="mono"
            style={{ background: 'var(--bg-elev)', color: 'var(--text)', border: '1px solid var(--border)', borderRadius: 4, padding: '3px 8px', fontSize: 12 }}>
            {snapDates.map(h => <option key={h.date} value={h.date}>{h.date}</option>)}
          </select>
        </div>

        {snapDates.length < 2
          ? <p style={{ color: 'var(--text-3)', fontSize: 12 }}>비교할 날짜가 없습니다.</p>
          : (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                <thead>
                  <tr>
                    <th style={{ ...TH, textAlign: 'left' }}>항목</th>
                    <th className="mono" style={TH}>{compareA}</th>
                    <th className="mono" style={TH}>{compareB}</th>
                    <th style={TH}>변화</th>
                  </tr>
                </thead>
                <tbody>
                  {[
                    { label: '현재가', keyA: snapshotA?.price, keyB: snapshotB?.price, fmt: (v) => v == null ? fmt(v, market) : Number.isFinite(v) ? fmt(v, market) : '—' },
                    { label: '목표가(평균)', keyA: snapshotA?.target_mean, keyB: snapshotB?.target_mean, fmt: (v) => v == null ? fmt(v, market) : Number.isFinite(v) ? fmt(v, market) : '—' },
                    { label: '목표가(최고)', keyA: snapshotA?.target_high, keyB: snapshotB?.target_high, fmt: (v) => v == null ? fmt(v, market) : Number.isFinite(v) ? fmt(v, market) : '—' },
                    { label: '목표가(최저)', keyA: snapshotA?.target_low, keyB: snapshotB?.target_low, fmt: (v) => v == null ? fmt(v, market) : Number.isFinite(v) ? fmt(v, market) : '—' },
                    { label: 'Buy', keyA: snapshotA?.buy, keyB: snapshotB?.buy, fmt: (v) => v ?? 'N/A' },
                    { label: 'Hold', keyA: snapshotA?.hold, keyB: snapshotB?.hold, fmt: (v) => v ?? 'N/A' },
                    { label: 'Sell', keyA: snapshotA?.sell, keyB: snapshotB?.sell, fmt: (v) => v ?? 'N/A' },
                    { label: 'RSI(일)', keyA: snapshotA?.daily_rsi?.rsi, keyB: snapshotB?.daily_rsi?.rsi, fmt: (v) => v == null ? 'N/A' : Number.isFinite(v) ? v.toFixed(1) : '—' },
                    { label: 'RSI(주)', keyA: snapshotA?.weekly_rsi?.rsi, keyB: snapshotB?.weekly_rsi?.rsi, fmt: (v) => v == null ? 'N/A' : Number.isFinite(v) ? v.toFixed(1) : '—' },
                    { label: 'RSI(월)', keyA: snapshotA?.monthly_rsi?.rsi, keyB: snapshotB?.monthly_rsi?.rsi, fmt: (v) => v == null ? 'N/A' : Number.isFinite(v) ? v.toFixed(1) : '—' },
                  ].map(({ label, keyA, keyB, fmt: fmtFn }) => {
                    const rawDelta = (keyA != null && keyB != null)
                      ? ((keyA - keyB) / Math.abs(keyB) * 100)
                      : null
                    const delta = Number.isFinite(rawDelta) ? rawDelta : null
                    return (
                      <tr key={label}>
                        <td style={{ ...TD, textAlign: 'left', color: 'var(--text-3)' }}>{label}</td>
                        <td style={TD}>{fmtFn(keyA)}</td>
                        <td style={TD}>{fmtFn(keyB)}</td>
                        <td style={{ ...TD, color: delta == null ? 'var(--text-3)' : delta >= 0 ? 'var(--up)' : 'var(--down)' }}>
                          {delta != null ? `${delta >= 0 ? '+' : ''}${delta.toFixed(1)}%` : '—'}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
          )
        }
      </div>
    </div>
  )
}

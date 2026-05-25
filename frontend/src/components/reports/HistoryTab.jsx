import { useState, useEffect } from 'react'
import api from '../../api'
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine, Legend } from 'recharts'
import { fmtPrice as fmt } from '../../utils'
import { TH, TD } from './reportUtils.jsx'

export default function HistoryTab({ ticker, dates, market }) {
  const [history, setHistory] = useState([])
  const [histLoading, setHistLoading] = useState(false)
  const [histError, setHistError] = useState(null)
  const [trendTab, setTrendTab] = useState('target')
  const [compareA, setCompareA] = useState(null)
  const [compareB, setCompareB] = useState(null)
  const [snapshotA, setSnapshotA] = useState(null)
  const [snapshotB, setSnapshotB] = useState(null)

  useEffect(() => {
    if (!ticker) return
    setHistLoading(true)
    setHistError(null)
    api.get(`/api/report/${ticker}/history`)
      .then(({ data }) => {
        setHistory(data)
        if (data.length > 0) setCompareA(data[data.length - 1].date)
        if (data.length > 1) setCompareB(data[data.length - 2].date)
      })
      .catch(() => setHistError('히스토리 데이터를 불러올 수 없습니다.'))
      .finally(() => setHistLoading(false))
  }, [ticker])

  useEffect(() => {
    if (!ticker || !compareA) return
    api.get(`/api/report/${ticker}/${compareA}`)
      .then(({ data }) => setSnapshotA(data.summary))
      .catch(() => setSnapshotA(null))
  }, [ticker, compareA])

  useEffect(() => {
    if (!ticker || !compareB) return
    api.get(`/api/report/${ticker}/${compareB}`)
      .then(({ data }) => setSnapshotB(data.summary))
      .catch(() => setSnapshotB(null))
  }, [ticker, compareB])

  if (histLoading) return <p style={{ color: 'var(--text-3)', fontSize: 13 }}>로딩 중...</p>
  if (histError) return <p style={{ color: '#ef9a9a', fontSize: 13 }}>{histError}</p>
  if (history.length === 0) return <p style={{ color: 'var(--text-3)', fontSize: 13 }}>히스토리 데이터가 없습니다.</p>

  const xTickFormatter = (date) => date?.slice(5) ?? ''

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {/* 트렌드 섹션 */}
      <div>
        <div style={{ display: 'flex', gap: 0, marginBottom: 12 }}>
          {[{ key: 'target', label: '목표가' }, { key: 'rsi', label: 'RSI' }].map(({ key, label }) => (
            <button key={key} onClick={() => setTrendTab(key)} style={{
              background: 'transparent', border: 'none', cursor: 'pointer', fontSize: 12,
              padding: '4px 14px',
              borderBottom: trendTab === key ? '2px solid var(--accent)' : '2px solid transparent',
              color: trendTab === key ? 'var(--accent)' : 'var(--text-3)',
              fontWeight: trendTab === key ? 600 : 400,
              marginBottom: -1,
            }}>{label}</button>
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
              <Line type="monotone" dataKey="target_high" name="최고" stroke="#81c784" strokeWidth={1} dot={false} connectNulls={false} />
              <Line type="monotone" dataKey="target_mean" name="평균" stroke="var(--accent)" strokeWidth={2} dot={false} connectNulls={false} />
              <Line type="monotone" dataKey="target_low" name="최저" stroke="#ef9a9a" strokeWidth={1} dot={false} connectNulls={false} />
              <Line type="monotone" dataKey="price" name="현재가" stroke="#90caf9" strokeWidth={1} strokeDasharray="4 2" dot={false} connectNulls={false} />
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
              <ReferenceLine y={70} stroke="#ef9a9a" strokeDasharray="4 2" label={{ value: '과매수', fill: '#ef9a9a', fontSize: 10 }} />
              <ReferenceLine y={30} stroke="#81c784" strokeDasharray="4 2" label={{ value: '과매도', fill: '#81c784', fontSize: 10 }} />
              <Line type="monotone" dataKey="rsi_daily" name="일" stroke="var(--accent)" strokeWidth={2} dot={false} connectNulls={false} />
              <Line type="monotone" dataKey="rsi_weekly" name="주" stroke="#90caf9" strokeWidth={1.5} dot={false} connectNulls={false} />
              <Line type="monotone" dataKey="rsi_monthly" name="월" stroke="#ce93d8" strokeWidth={1.5} dot={false} connectNulls={false} />
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>

      {/* 날짜 비교 섹션 */}
      <div>
        <div style={{ display: 'flex', gap: 12, marginBottom: 12, alignItems: 'center' }}>
          <select value={compareA ?? ''} onChange={e => setCompareA(e.target.value)}
            style={{ background: 'var(--bg-elev)', color: 'var(--text)', border: '1px solid var(--border)', borderRadius: 4, padding: '3px 8px', fontSize: 12 }}>
            {history.map(h => <option key={h.date} value={h.date}>{h.date}</option>)}
          </select>
          <span style={{ color: 'var(--text-3)', fontSize: 12 }}>vs</span>
          <select value={compareB ?? ''} onChange={e => setCompareB(e.target.value)}
            style={{ background: 'var(--bg-elev)', color: 'var(--text)', border: '1px solid var(--border)', borderRadius: 4, padding: '3px 8px', fontSize: 12 }}>
            {history.map(h => <option key={h.date} value={h.date}>{h.date}</option>)}
          </select>
        </div>

        {history.length < 2
          ? <p style={{ color: 'var(--text-3)', fontSize: 12 }}>비교할 날짜가 없습니다.</p>
          : (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                <thead>
                  <tr>
                    <th style={{ ...TH, textAlign: 'left' }}>항목</th>
                    <th style={TH}>{compareA}</th>
                    <th style={TH}>{compareB}</th>
                    <th style={TH}>변화</th>
                  </tr>
                </thead>
                <tbody>
                  {[
                    { label: '현재가', keyA: snapshotA?.price, keyB: snapshotB?.price, fmt: (v) => fmt(v, market) },
                    { label: '목표가(평균)', keyA: snapshotA?.target_mean, keyB: snapshotB?.target_mean, fmt: (v) => fmt(v, market) },
                    { label: '목표가(최고)', keyA: snapshotA?.target_high, keyB: snapshotB?.target_high, fmt: (v) => fmt(v, market) },
                    { label: '목표가(최저)', keyA: snapshotA?.target_low, keyB: snapshotB?.target_low, fmt: (v) => fmt(v, market) },
                    { label: 'Buy', keyA: snapshotA?.buy, keyB: snapshotB?.buy, fmt: (v) => v ?? 'N/A' },
                    { label: 'Hold', keyA: snapshotA?.hold, keyB: snapshotB?.hold, fmt: (v) => v ?? 'N/A' },
                    { label: 'Sell', keyA: snapshotA?.sell, keyB: snapshotB?.sell, fmt: (v) => v ?? 'N/A' },
                    { label: 'RSI(일)', keyA: snapshotA?.daily_rsi?.rsi, keyB: snapshotB?.daily_rsi?.rsi, fmt: (v) => v != null ? v.toFixed(1) : 'N/A' },
                    { label: 'RSI(주)', keyA: snapshotA?.weekly_rsi?.rsi, keyB: snapshotB?.weekly_rsi?.rsi, fmt: (v) => v != null ? v.toFixed(1) : 'N/A' },
                    { label: 'RSI(월)', keyA: snapshotA?.monthly_rsi?.rsi, keyB: snapshotB?.monthly_rsi?.rsi, fmt: (v) => v != null ? v.toFixed(1) : 'N/A' },
                  ].map(({ label, keyA, keyB, fmt: fmtFn }) => {
                    const delta = (keyA != null && keyB != null)
                      ? ((keyA - keyB) / Math.abs(keyB) * 100)
                      : null
                    return (
                      <tr key={label}>
                        <td style={{ ...TD, textAlign: 'left', color: 'var(--text-3)' }}>{label}</td>
                        <td style={TD}>{fmtFn(keyA)}</td>
                        <td style={TD}>{fmtFn(keyB)}</td>
                        <td style={{ ...TD, color: delta == null ? 'var(--text-3)' : delta >= 0 ? '#81c784' : '#ef9a9a' }}>
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

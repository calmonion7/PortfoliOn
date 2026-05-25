import { useState, useEffect, useCallback, useMemo } from 'react'
import api from '../../api'
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts'
import { fmtPrice as fmt } from '../../utils'
import { _weather } from './reportUtils.jsx'

export default function ConsensusChart({ ticker, market }) {
  const [data, setData] = useState([])
  const [collecting, setCollecting] = useState(false)
  const [backfilling, setBackfilling] = useState(false)
  const [error, setError] = useState(null)
  const [tab, setTab] = useState(0)

  const fetchData = useCallback(() => {
    if (!ticker) return
    api.get(`/api/consensus/${ticker}`)
      .then(({ data }) => setData(data))
      .catch(() => setError('데이터 조회 실패'))
  }, [ticker])

  useEffect(() => { fetchData() }, [fetchData])

  const collect = async () => {
    setCollecting(true)
    setError(null)
    try {
      await api.post(`/api/consensus/${ticker}`)
      fetchData()
    } catch (e) {
      setError(e.response?.data?.detail || '수집 실패')
    } finally {
      setCollecting(false)
    }
  }

  const backfill = async () => {
    setBackfilling(true)
    setError(null)
    try {
      const { data: result } = await api.post(`/api/consensus/${ticker}/backfill`)
      if (result.added > 0) fetchData()
    } catch (e) {
      setError(e.response?.data?.detail || '백필 실패')
    } finally {
      setBackfilling(false)
    }
  }

  const ascData = useMemo(() => [...data].reverse(), [data])

  const trendWeather = useMemo(() => {
    const pts = ascData.filter(d => d.target_mean != null)
    if (pts.length < 2) return null
    const recent = pts.slice(-5)
    const pct = (recent[recent.length - 1].target_mean - recent[0].target_mean) / Math.abs(recent[0].target_mean) * 100
    if (pct > 2) return _weather(0)
    if (pct > 0) return _weather(1)
    if (pct > -2) return _weather(2)
    return _weather(3)
  }, [ascData])

  // 평균목표가: 연속 동일 구간은 첫 날짜만 유지 → 오른쪽 끝 = 현재값이 처음 시작된 날짜
  const targetData = useMemo(() => {
    if (ascData.length === 0) return []
    const result = [ascData[0]]
    for (let i = 1; i < ascData.length; i++) {
      const curr = ascData[i], prev = result[result.length - 1]
      if (curr.target_mean !== prev.target_mean) result.push(curr)
    }
    return result
  }, [ascData])

  const opinionData = useMemo(() => {
    if (ascData.length === 0) return []
    const result = [ascData[0]]
    for (let i = 1; i < ascData.length; i++) {
      const curr = ascData[i], prev = result[result.length - 1]
      if (curr.buy !== prev.buy || curr.hold !== prev.hold || curr.sell !== prev.sell)
        result.push(curr)
    }
    return result
  }, [ascData])

  const overlayData = useMemo(() => {
    if (ascData.length === 0) return []
    const result = [ascData[0]]
    for (let i = 1; i < ascData.length; i++) {
      const curr = ascData[i], prev = result[result.length - 1]
      if (
        curr.target_mean !== prev.target_mean ||
        curr.buy !== prev.buy || curr.hold !== prev.hold || curr.sell !== prev.sell
      ) result.push(curr)
    }
    return result
  }, [ascData])

  const opinionAllSame = opinionData.length === 1

  const axisStyle = { fontSize: 10, fill: 'var(--text-3)' }
  const chartMargin = { top: 22, right: 16, left: 0, bottom: 0 }

  const anchor = (index, total) =>
    index === 0 ? 'start' : index === total - 1 ? 'end' : 'middle'

  const targetDot = (props) => {
    const { cx, cy, index, value } = props
    if (value == null) return <g key={index} />
    const prev = targetData.slice(0, index).reverse().find(d => d.target_mean != null)
    const delta = prev != null ? value - prev.target_mean : null
    const pct = delta != null ? (delta / prev.target_mean * 100) : null
    const up = delta >= 0
    const color = delta === null ? '#ffcc80' : up ? '#81c784' : '#ef9a9a'
    const label = delta != null
      ? `${fmt(value, market)} ${up ? '↑' : '↓'}${Math.abs(pct).toFixed(1)}%`
      : fmt(value, market)
    return (
      <g key={index}>
        <circle cx={cx} cy={cy} r={3} fill="#ffcc80" />
        {label && (
          <text x={cx} y={up ? cy - 8 : cy + 14} textAnchor={anchor(index, targetData.length)} fontSize={8} fill={color}>{label}</text>
        )}
      </g>
    )
  }

  const bgLabel = (cx, cy, label, color, ta, yOff) => {
    const w = label.length * 5 + 4
    const xOff = ta === 'start' ? 0 : ta === 'end' ? -w : -w / 2
    return (
      <g>
        <rect x={cx + xOff} y={cy + yOff - 9} width={w} height={11} fill="var(--bg-elev)" opacity={0.85} rx={2} />
        <text x={cx} y={cy + yOff} textAnchor={ta} fontSize={8} fill={color}>{label}</text>
      </g>
    )
  }

  const overlayTargetDot = (props) => {
    const { cx, cy, index, value } = props
    if (value == null) return <g key={index} />
    const prev = overlayData.slice(0, index).reverse().find(d => d.target_mean != null)
    const delta = prev != null ? value - prev.target_mean : null
    const pct = delta != null ? (delta / prev.target_mean * 100) : null
    const up = delta >= 0
    const color = delta === null ? '#ffcc80' : up ? '#81c784' : '#ef9a9a'
    const label = delta != null
      ? `${fmt(value, market)} ${up ? '↑' : '↓'}${Math.abs(pct).toFixed(1)}%`
      : fmt(value, market)
    return (
      <g key={index}>
        <circle cx={cx} cy={cy} r={3} fill="#ffcc80" />
        {bgLabel(cx, cy, label, color, anchor(index, overlayData.length), -10)}
      </g>
    )
  }

  const overlayBuyDot = (props) => {
    const { cx, cy, index, value } = props
    if (value == null) return <g key={index} />
    const prev = overlayData[index - 1]
    const delta = prev != null ? value - prev.buy : null
    const up = delta > 0
    const labelColor = delta == null || delta === 0 ? '#43a047' : up ? '#81c784' : '#ef9a9a'
    const label = delta == null
      ? String(value)
      : delta !== 0
        ? `${value} ${up ? '↑' : '↓'}${Math.abs((delta / prev.buy) * 100).toFixed(0)}%`
        : null
    return (
      <g key={index}>
        <circle cx={cx} cy={cy} r={3} fill="#43a047" />
        {label && bgLabel(cx, cy, label, labelColor, anchor(index, overlayData.length), 14)}
      </g>
    )
  }

  const makeDot = (color, dataKey) => (props) => {
    const { cx, cy, index, value } = props
    if (value == null) return <g key={index} />
    const prev = opinionData[index - 1]
    const delta = prev != null ? value - prev[dataKey] : null
    const up = delta > 0
    const labelColor = delta == null || delta === 0 ? color : up ? '#81c784' : '#ef9a9a'
    const label = delta == null
      ? String(value)
      : delta !== 0
        ? `${value} ${up ? '↑' : '↓'}${Math.abs((delta / prev[dataKey]) * 100).toFixed(0)}%`
        : null
    return (
      <g key={index}>
        <circle cx={cx} cy={cy} r={3} fill={color} />
        {label && (
          <text x={cx} y={up ? cy - 8 : cy + 14} textAnchor={anchor(index, opinionData.length)} fontSize={8} fill={labelColor}>{label}</text>
        )}
      </g>
    )
  }

  const deltaStr = (delta, pct, isPrice) =>
    delta == null ? '' : ` ${delta >= 0 ? '▲' : '▼'} ${isPrice ? fmt(Math.abs(delta), market) : Math.abs(delta)} (${Math.abs(pct).toFixed(1)}%)`

  const targetTooltip = ({ active, payload, label }) => {
    if (!active || !payload?.length) return null
    const value = payload[0].value
    const idx = targetData.findIndex(d => d.date === label)
    const prev = idx > 0 ? targetData.slice(0, idx).reverse().find(d => d.target_mean != null) : null
    const delta = prev != null && value != null ? value - prev.target_mean : null
    const pct = delta != null ? delta / prev.target_mean * 100 : null
    const dColor = delta == null ? '#ffcc80' : delta >= 0 ? '#81c784' : '#ef9a9a'
    return (
      <div style={{ background: 'var(--bg-elev)', border: '1px solid var(--border)', borderRadius: 6, padding: '8px 12px', fontSize: 11 }}>
        <div style={{ color: 'var(--accent)', fontWeight: 700, marginBottom: 4 }}>{label}</div>
        <div style={{ color: '#ffcc80' }}>평균목표가: {fmt(value, market)}</div>
        {delta != null && <div style={{ color: dColor, fontSize: 10 }}>{deltaStr(delta, pct, true)}</div>}
      </div>
    )
  }

  const opinionTooltip = ({ active, payload, label }) => {
    if (!active || !payload?.length) return null
    const total = payload.reduce((s, p) => s + (p.value ?? 0), 0)
    const idx = opinionData.findIndex(d => d.date === label)
    const prev = idx > 0 ? opinionData[idx - 1] : null
    return (
      <div style={{ background: 'var(--bg-elev)', border: '1px solid var(--border)', borderRadius: 6, padding: '8px 12px', fontSize: 11 }}>
        <div style={{ color: 'var(--accent)', fontWeight: 700, marginBottom: 4 }}>{label}</div>
        {payload.map(p => {
          const delta = prev != null ? (p.value ?? 0) - prev[p.dataKey] : null
          const pct = delta != null && prev[p.dataKey] !== 0 ? delta / prev[p.dataKey] * 100 : null
          const dColor = delta == null || delta === 0 ? p.fill : delta > 0 ? '#81c784' : '#ef9a9a'
          return (
            <div key={p.dataKey} style={{ color: p.fill, marginBottom: 2 }}>
              {p.name}: {p.value ?? 0}{total > 0 ? ` (${Math.round((p.value ?? 0) / total * 100)}%)` : ''}
              {delta != null && delta !== 0 && pct != null && <span style={{ color: dColor, fontSize: 10 }}>{deltaStr(delta, pct, false)}</span>}
            </div>
          )
        })}
      </div>
    )
  }

  return (
    <div style={{ background: 'var(--bg-elev)', borderRadius: 6, padding: '8px 10px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <div style={{ color: 'var(--accent)', fontWeight: 700, fontSize: 12, letterSpacing: '0.3px', display: 'flex', alignItems: 'center', gap: 6 }}>
          <span>📈 컨센서스 추이</span>
          {trendWeather && <span title={trendWeather.label} style={{ fontSize: 14, lineHeight: 1 }}>{trendWeather.icon}</span>}
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          <button
            onClick={backfill}
            disabled={backfilling}
            style={{
              background: 'transparent', border: '1px solid var(--border)',
              color: backfilling ? 'var(--accent)' : 'var(--text-3)',
              borderRadius: 3, padding: '2px 8px', fontSize: 11,
              cursor: backfilling ? 'default' : 'pointer',
            }}
          >
            {backfilling ? '백필 중...' : '백필'}
          </button>
          <button
            onClick={collect}
            disabled={collecting}
            style={{
              background: 'transparent', border: '1px solid var(--border)',
              color: collecting ? 'var(--accent)' : 'var(--text-3)',
              borderRadius: 3, padding: '2px 8px', fontSize: 11,
              cursor: collecting ? 'default' : 'pointer',
            }}
          >
            {collecting ? '수집 중...' : '수집'}
          </button>
        </div>
      </div>
      {error && <div style={{ color: '#ef9a9a', fontSize: 11, marginBottom: 6 }}>{error}</div>}
      {ascData.length === 0 ? (
        <div style={{ color: 'var(--text-3)', fontSize: 12, textAlign: 'center', padding: '16px 0' }}>
          아직 수집된 데이터가 없습니다. 수집 버튼을 눌러주세요.
        </div>
      ) : (
        <>
          <div style={{ display: 'flex', gap: 0, borderBottom: '1px solid var(--border)', marginBottom: 8 }}>
            {['평균목표가', '애널리스트 의견', '추이 비교'].map((t, i) => (
              <button key={i} onClick={() => setTab(i)} style={{
                background: 'transparent', border: 'none',
                borderBottom: tab === i ? '2px solid var(--accent)' : '2px solid transparent',
                color: tab === i ? 'var(--accent)' : 'var(--text-3)',
                fontWeight: tab === i ? 600 : 400,
                fontSize: 11, padding: '4px 10px', cursor: 'pointer',
              }}>{t}</button>
            ))}
          </div>
          {tab === 0 && (
            <ResponsiveContainer width="100%" height={140}>
              <LineChart data={targetData} margin={chartMargin}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--chart-grid)" />
                <XAxis dataKey="date" tick={axisStyle} axisLine={false} tickLine={false} />
                <YAxis tickFormatter={(v) => fmt(v, market)} tick={axisStyle} axisLine={false} tickLine={false} width={60} />
                <Tooltip content={targetTooltip} />
                <Line type="monotone" dataKey="target_mean" name="평균목표가" stroke="#ffcc80" strokeWidth={2} dot={targetDot} activeDot={{ r: 5 }} connectNulls />
              </LineChart>
            </ResponsiveContainer>
          )}
          {tab === 1 && (
            <>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                {opinionAllSame && (
                  <span style={{ fontSize: 9, color: 'var(--text-3)', background: 'var(--bg-elev-2)', border: '1px solid var(--border)', borderRadius: 3, padding: '0 5px', lineHeight: '16px' }}>변동 없음</span>
                )}
              </div>
              <ResponsiveContainer width="100%" height={140}>
                <LineChart data={opinionData} margin={chartMargin}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--chart-grid)" />
                  <XAxis dataKey="date" tick={axisStyle} axisLine={false} tickLine={false} />
                  <YAxis tick={axisStyle} axisLine={false} tickLine={false} width={20} />
                  <Tooltip content={opinionTooltip} />
                  <Line type="monotone" dataKey="buy" name="매수" stroke="#43a047" strokeWidth={2} dot={makeDot('#43a047', 'buy')} activeDot={{ r: 5 }} connectNulls />
                  <Line type="monotone" dataKey="hold" name="중립" stroke="#616161" strokeWidth={2} dot={makeDot('#616161', 'hold')} activeDot={{ r: 5 }} connectNulls />
                  <Line type="monotone" dataKey="sell" name="매도" stroke="#ef9a9a" strokeWidth={2} dot={makeDot('#ef9a9a', 'sell')} activeDot={{ r: 5 }} connectNulls />
                </LineChart>
              </ResponsiveContainer>
              <div style={{ display: 'flex', gap: 12, fontSize: 10, color: 'var(--text-3)', marginTop: 4 }}>
                {[['#43a047', '매수'], ['#616161', '중립'], ['#ef9a9a', '매도']].map(([color, label]) => (
                  <span key={label} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                    <span style={{ width: 8, height: 8, background: color, display: 'inline-block', borderRadius: 2 }} />
                    {label}
                  </span>
                ))}
              </div>
            </>
          )}
          {tab === 2 && (
            <ResponsiveContainer width="100%" height={140}>
              <LineChart data={overlayData} margin={chartMargin}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--chart-grid)" />
                <XAxis dataKey="date" tick={axisStyle} axisLine={false} tickLine={false} />
                <YAxis yAxisId="left" tickFormatter={(v) => fmt(v, market)} tick={axisStyle} axisLine={false} tickLine={false} width={60} />
                <YAxis yAxisId="right" orientation="right" tick={axisStyle} axisLine={false} tickLine={false} width={24} />
                <Tooltip content={({ active, payload, label }) => {
                  if (!active || !payload?.length) return null
                  const idx = overlayData.findIndex(d => d.date === label)
                  const prev = idx > 0 ? overlayData[idx - 1] : null
                  return (
                    <div style={{ background: 'var(--bg-elev)', border: '1px solid var(--border)', borderRadius: 6, padding: '8px 12px', fontSize: 11 }}>
                      <div style={{ color: 'var(--accent)', fontWeight: 700, marginBottom: 4 }}>{label}</div>
                      {payload.map(p => {
                        const val = p.value
                        const prevVal = prev?.[p.dataKey]
                        const delta = prevVal != null && val != null ? val - prevVal : null
                        const pct = delta != null && prevVal !== 0 ? delta / prevVal * 100 : null
                        const isPrice = p.dataKey === 'target_mean'
                        const dColor = delta == null || delta === 0 ? p.stroke : delta > 0 ? '#81c784' : '#ef9a9a'
                        return (
                          <div key={p.dataKey} style={{ color: p.stroke, marginBottom: 2 }}>
                            {p.name}: {val ?? 'N/A'}
                            {delta != null && delta !== 0 && pct != null && <span style={{ color: dColor, fontSize: 10 }}>{deltaStr(delta, pct, isPrice)}</span>}
                          </div>
                        )
                      })}
                    </div>
                  )
                }} />
                <Line yAxisId="left" type="monotone" dataKey="target_mean" name="목표가" stroke="#ffcc80" strokeWidth={2} dot={overlayTargetDot} activeDot={{ r: 5 }} connectNulls />
                <Line yAxisId="right" type="monotone" dataKey="buy" name="매수" stroke="#43a047" strokeWidth={2} dot={overlayBuyDot} activeDot={{ r: 5 }} connectNulls />
              </LineChart>
            </ResponsiveContainer>
          )}
        </>
      )}
    </div>
  )
}

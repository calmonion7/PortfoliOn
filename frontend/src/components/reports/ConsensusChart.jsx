import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import api from '../../api'
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts'
import { fmtPrice as fmt } from '../../utils'
import { _weather, SectionTitle } from './reportUtils.jsx'
import { useToast } from '../Toast'
import useIsMobile from '../../hooks/useIsMobile'

export default function ConsensusChart({ ticker, market }) {
  const { showToast } = useToast()
  const isMobile = useIsMobile()
  // 모바일: 툴팁이 차트 우측 뷰포트를 벗어나지 않도록 폭 제한 + 뷰박스 내 고정
  const tooltipWrapperStyle = isMobile ? { maxWidth: '60vw', zIndex: 10 } : undefined
  const [data, setData] = useState([])
  const [backfilling, setBackfilling] = useState(false)
  const [error, setError] = useState(null)
  const [fetchFailed, setFetchFailed] = useState(false)  // 조회 실패 — '데이터 없음'과 구분
  const [tab, setTab] = useState(0)
  const [period, setPeriod] = useState('3M')
  const retriedRef = useRef(false)     // 무음 auto-retry 1회 제한
  const retryTimerRef = useRef(null)   // 예약된 재시도 핸들 — 종목 전환/언마운트 시 취소

  const fetchData = useCallback(() => {
    if (!ticker) return
    api.get(`/api/consensus/${ticker}`)
      .then(({ data }) => { setData(data); setFetchFailed(false); retriedRef.current = false })
      .catch(() => {
        // 일시적 오류(터널 520 등)는 대부분 즉시 재시도로 해소 — 1회 무음 재시도 후 실패 표시.
        if (!retriedRef.current) {
          retriedRef.current = true
          retryTimerRef.current = setTimeout(() => fetchData(), 1500)
        } else {
          setFetchFailed(true)
        }
      })
  }, [ticker])

  const retryFetch = () => {
    if (retryTimerRef.current) clearTimeout(retryTimerRef.current)
    retriedRef.current = false; setFetchFailed(false); fetchData()
  }

  // 종목 전환/언마운트 시 재시도 상태 리셋 + 예약된 재시도 취소 — 이전 종목의 소진된 retry가
  // 새 종목 auto-retry를 막거나, 스테일 fetch가 다른 종목 화면에 이전 종목 데이터를 쓰는 것 방지.
  useEffect(() => {
    retriedRef.current = false; setFetchFailed(false); fetchData()
    return () => { if (retryTimerRef.current) clearTimeout(retryTimerRef.current) }
  }, [fetchData])

  const backfill = async () => {
    setBackfilling(true)
    setError(null)
    try {
      const { data: result } = await api.post(`/api/consensus/${ticker}/backfill`)
      if (result.added > 0) { fetchData(); showToast(`백필 완료 (+${result.added}건)`) }
      else showToast('추가할 데이터 없음')
    } catch (e) {
      const msg = e.response?.data?.detail || '백필 실패'
      setError(msg); showToast(msg, 'error')
    } finally {
      setBackfilling(false)
    }
  }

  const ascData = useMemo(() => [...data].reverse(), [data])

  const filteredData = useMemo(() => {
    if (period === 'ALL') return ascData
    const days = period === '1M' ? 30 : period === '3M' ? 90 : period === '6M' ? 180 : 365
    const cutoff = new Date()
    cutoff.setDate(cutoff.getDate() - days)
    const cutStr = cutoff.toISOString().slice(0, 10)
    return ascData.filter(d => d.date >= cutStr)
  }, [ascData, period])

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

  const opinionAllSame = useMemo(() => {
    if (ascData.length < 2) return true
    return ascData.every(d => d.buy === ascData[0].buy && d.hold === ascData[0].hold && d.sell === ascData[0].sell)
  }, [ascData])

  // 겹침 방지: 처음·끝·최대·최소 + 충분히 이격된 변화 포인트만 레이블 표시
  const targetLabelSet = useMemo(() => {
    const changed = []
    let prevVal = null
    for (let i = 0; i < filteredData.length; i++) {
      const val = filteredData[i].target_mean
      if (val == null) continue
      if (val !== prevVal) { changed.push(i); prevVal = val }
    }
    if (changed.length <= 4) return new Set(changed)

    const allVals = filteredData.map((d, i) => ({ i, val: d.target_mean })).filter(p => p.val != null)
    const maxI = allVals.reduce((a, b) => b.val > a.val ? b : a).i
    const minI = allVals.reduce((a, b) => b.val < a.val ? b : a).i
    const show = new Set([changed[0], changed[changed.length - 1], maxI, minI])

    const minGap = Math.max(4, Math.floor(filteredData.length / 6))
    for (const idx of changed) {
      if (show.has(idx)) continue
      if (![...show].some(s => Math.abs(s - idx) < minGap)) show.add(idx)
    }
    return show
  }, [filteredData])

  const axisStyle = { fontSize: 10, fill: 'var(--text-3)' }
  const chartMargin = { top: 22, right: 16, left: 0, bottom: 4 }

  const fmtYAxis = (v) => {
    if (v == null) return ''
    if (market === 'KR') {
      if (Math.abs(v) >= 100000000) return `₩${(v / 100000000).toFixed(0)}억`
      if (Math.abs(v) >= 10000) return `₩${Math.round(v / 10000)}만`
      return `₩${v}`
    }
    if (Math.abs(v) >= 1000) return `$${(v / 1000).toFixed(0)}K`
    return `$${v}`
  }

  // recharts가 틱을 서브샘플링하므로 index=0(첫 번째 렌더 틱) 기준으로 연도 표시
  const yearChangeDates = useMemo(() => {
    const s = new Set()
    let prev = null
    for (const d of filteredData) {
      const y = d.date.slice(0, 4)
      if (y !== prev) { s.add(d.date); prev = y }
    }
    return s
  }, [filteredData])

  const xTick = ({ x, y, payload, index }) => {
    const date = payload.value
    if (!date) return null
    const mmdd = date.slice(5)
    const year = date.slice(0, 4)
    const showYear = index === 0 || yearChangeDates.has(date)
    return (
      <g transform={`translate(${x},${y})`}>
        <text textAnchor="middle" fontSize={10} fill="var(--text-3)" dy={12}>{mmdd}</text>
        {showYear && (
          <g>
            <rect x={-19} y={18} width={38} height={14} rx={7}
              fill="none" stroke="var(--border)" strokeWidth={0.8} />
            <text textAnchor="middle" dominantBaseline="central" fontSize={8.5} fill="var(--text-3)" y={25}>{year}</text>
          </g>
        )}
      </g>
    )
  }

  const anchor = (index, total) =>
    index === 0 ? 'start' : index === total - 1 ? 'end' : 'middle'

  // 값이 바뀐 지점에서만 도트+레이블 렌더링
  const targetDot = (props) => {
    const { cx, cy, index, value } = props
    if (value == null) return <g key={index} />
    const prevEntry = index > 0 ? filteredData.slice(0, index).reverse().find(d => d.target_mean != null) : null
    const prevValue = prevEntry?.target_mean ?? null
    if (prevValue === value) return <g key={index} />
    const delta = prevValue != null ? value - prevValue : null
    const pct = delta != null ? (delta / Math.abs(prevValue) * 100) : null
    const up = delta == null || delta >= 0
    const color = delta === null ? 'var(--data-3)' : up ? 'var(--up)' : 'var(--down)'
    const label = delta != null
      ? `${fmt(value, market)} ${up ? '↑' : '↓'}${Math.abs(pct).toFixed(1)}%`
      : fmt(value, market)
    return (
      <g key={index}>
        <circle cx={cx} cy={cy} r={3} fill="var(--data-3)" />
        {targetLabelSet.has(index) && label && bgLabel(cx, cy, label, color, anchor(index, filteredData.length), up ? -10 : 14)}
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
    const prevEntry = index > 0 ? filteredData.slice(0, index).reverse().find(d => d.target_mean != null) : null
    const prevValue = prevEntry?.target_mean ?? null
    if (prevValue === value) return <g key={index} />
    const delta = prevValue != null ? value - prevValue : null
    const pct = delta != null ? (delta / Math.abs(prevValue) * 100) : null
    const up = delta == null || delta >= 0
    const color = delta === null ? 'var(--data-3)' : up ? 'var(--up)' : 'var(--down)'
    const label = delta != null
      ? `${fmt(value, market)} ${up ? '↑' : '↓'}${Math.abs(pct).toFixed(1)}%`
      : fmt(value, market)
    return (
      <g key={index}>
        <circle cx={cx} cy={cy} r={3} fill="var(--data-3)" />
        {targetLabelSet.has(index) && bgLabel(cx, cy, label, color, anchor(index, filteredData.length), -10)}
      </g>
    )
  }

  const pctLabel = (delta, prevVal, up) => {
    if (delta == null || prevVal == null || prevVal === 0) return ''
    return ` ${up ? '↑' : '↓'}${Math.abs((delta / prevVal) * 100).toFixed(0)}%`
  }

  const overlayBuyDot = (props) => {
    const { cx, cy, index, value } = props
    if (value == null) return <g key={index} />
    const prev = index > 0 ? filteredData[index - 1] : null
    const prevVal = prev?.buy ?? null
    if (prevVal === value) return <g key={index} />
    const delta = prevVal != null ? value - prevVal : null
    const up = delta > 0
    const labelColor = delta == null || delta === 0 ? 'var(--semantic-buy)' : up ? 'var(--up)' : 'var(--down)'
    const label = delta == null
      ? String(value)
      : delta !== 0 ? `${value}${pctLabel(delta, prevVal, up)}` : null
    return (
      <g key={index}>
        <circle cx={cx} cy={cy} r={3} fill="var(--semantic-buy)" />
        {label && bgLabel(cx, cy, label, labelColor, anchor(index, filteredData.length), 14)}
      </g>
    )
  }

  const makeDot = (color, dataKey) => (props) => {
    const { cx, cy, index, value } = props
    if (value == null) return <g key={index} />
    const prev = index > 0 ? filteredData[index - 1] : null
    const prevVal = prev?.[dataKey] ?? null
    if (prevVal === value) return <g key={index} />
    const delta = prevVal != null ? value - prevVal : null
    const up = delta > 0
    const labelColor = delta == null || delta === 0 ? color : up ? 'var(--up)' : 'var(--down)'
    const label = delta == null
      ? String(value)
      : delta !== 0 ? `${value}${pctLabel(delta, prevVal, up)}` : null
    return (
      <g key={index}>
        <circle cx={cx} cy={cy} r={3} fill={color} />
        {label && bgLabel(cx, cy, label, labelColor, anchor(index, filteredData.length), up ? -10 : 14)}
      </g>
    )
  }

  const deltaStr = (delta, pct, isPrice) =>
    delta == null ? '' : ` ${delta >= 0 ? '▲' : '▼'} ${isPrice ? fmt(Math.abs(delta), market) : Math.abs(delta)} (${Math.abs(pct).toFixed(1)}%)`

  const targetTooltip = ({ active, payload, label }) => {
    if (!active || !payload?.length) return null
    const value = payload[0].value
    const idx = filteredData.findIndex(d => d.date === label)
    const prev = idx > 0 ? filteredData.slice(0, idx).reverse().find(d => d.target_mean != null && d.target_mean !== value) : null
    const delta = prev != null && value != null ? value - prev.target_mean : null
    const pct = delta != null ? delta / prev.target_mean * 100 : null
    const dColor = delta == null ? 'var(--data-3)' : delta >= 0 ? 'var(--up)' : 'var(--down)'
    return (
      <div style={{ background: 'var(--bg-elev)', border: '1px solid var(--border)', borderRadius: 6, padding: '8px 12px', fontSize: 11 }}>
        <div style={{ color: 'var(--accent)', fontWeight: 700, marginBottom: 4 }}>{label}</div>
        <div style={{ color: 'var(--data-3)' }}>평균목표가: {fmt(value, market)}</div>
        {delta != null && <div style={{ color: dColor, fontSize: 10 }}>{deltaStr(delta, pct, true)}</div>}
      </div>
    )
  }

  const opinionTooltip = ({ active, payload, label }) => {
    if (!active || !payload?.length) return null
    const total = payload.reduce((s, p) => s + (p.value ?? 0), 0)
    const idx = filteredData.findIndex(d => d.date === label)
    const prev = idx > 0 ? filteredData[idx - 1] : null
    return (
      <div style={{ background: 'var(--bg-elev)', border: '1px solid var(--border)', borderRadius: 6, padding: '8px 12px', fontSize: 11 }}>
        <div style={{ color: 'var(--accent)', fontWeight: 700, marginBottom: 4 }}>{label}</div>
        {payload.map(p => {
          const delta = prev != null ? (p.value ?? 0) - prev[p.dataKey] : null
          const pct = delta != null && prev[p.dataKey] !== 0 ? delta / prev[p.dataKey] * 100 : null
          const dColor = delta == null || delta === 0 ? p.fill : delta > 0 ? 'var(--up)' : 'var(--down)'
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
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <SectionTitle weather={trendWeather}>📈 컨센서스 추이</SectionTitle>
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
        </div>
      </div>
      {error && <div style={{ color: 'var(--color-error)', fontSize: 11, marginBottom: 6 }}>{error}</div>}
      {fetchFailed ? (
        <div style={{ color: 'var(--text-3)', fontSize: 12, textAlign: 'center', padding: '16px 0', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
          <span>일시적 연결 오류로 컨센서스를 불러오지 못했습니다.</span>
          <button onClick={retryFetch} style={{
            background: 'transparent', border: '1px solid var(--border)', color: 'var(--text-3)',
            borderRadius: 3, padding: '2px 10px', fontSize: 11, cursor: 'pointer',
          }}>다시 시도</button>
        </div>
      ) : ascData.length === 0 ? (
        <div style={{ color: 'var(--text-3)', fontSize: 12, textAlign: 'center', padding: '16px 0' }}>
          아직 수집된 데이터가 없습니다. 수집 버튼을 눌러주세요.
        </div>
      ) : (
        <>
          <div style={{ borderBottom: '1px solid var(--border)', marginBottom: 8 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              {/* 컨센서스 내부 뷰 전환 — 바깥 서브탭(.tab-btn.sm 언더라인)과 다른 세그먼트 토글로
                  시각 구분해 "탭 6개" 착시 제거(task#145). 위계: 도메인 탭 아래 뷰 스위처. */}
              <div style={{ display: 'inline-flex', gap: 2, background: 'var(--bg-elev-2)', borderRadius: 6, padding: 2, marginBottom: 4 }}>
                {['목표가', '의견', '비교'].map((t, i) => (
                  <button key={i} onClick={() => setTab(i)} style={{
                    background: tab === i ? 'var(--bg-elev)' : 'transparent',
                    border: 0, borderRadius: 4, padding: '3px 10px', fontSize: 11,
                    fontWeight: tab === i ? 600 : 500,
                    color: tab === i ? 'var(--text)' : 'var(--text-3)',
                    cursor: 'pointer',
                  }}>{t}</button>
                ))}
              </div>
              <div style={{ display: 'flex', gap: 2, paddingBottom: 2 }}>
                {['1M', '3M', '6M', '1Y', 'ALL'].map(p => (
                  <button key={p} onClick={() => setPeriod(p)} style={{
                    background: period === p ? 'var(--accent)' : 'transparent',
                    border: '1px solid var(--border)',
                    color: period === p ? 'var(--bg)' : 'var(--text-3)',
                    borderRadius: 3, padding: '1px 6px', fontSize: 10,
                    cursor: 'pointer',
                  }}>{p}</button>
                ))}
              </div>
            </div>
          </div>
          {tab === 0 && (
            <ResponsiveContainer width="100%" height={155}>
              <LineChart data={filteredData} margin={chartMargin}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--chart-grid)" />
                <XAxis dataKey="date" tick={xTick} height={40} axisLine={false} tickLine={false} />
                <YAxis tickFormatter={fmtYAxis} tick={axisStyle} axisLine={false} tickLine={false} width={42} />
                <Tooltip content={targetTooltip} allowEscapeViewBox={{ x: false, y: false }} wrapperStyle={tooltipWrapperStyle} />
                <Line type="monotone" dataKey="target_mean" name="평균목표가" stroke="var(--data-3)" strokeWidth={2} dot={targetDot} activeDot={{ r: 5 }} connectNulls />
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
              <ResponsiveContainer width="100%" height={155}>
                <LineChart data={filteredData} margin={chartMargin}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--chart-grid)" />
                  <XAxis dataKey="date" tick={xTick} height={40} axisLine={false} tickLine={false} />
                  <YAxis tick={axisStyle} axisLine={false} tickLine={false} width={20} />
                  <Tooltip content={opinionTooltip} allowEscapeViewBox={{ x: false, y: false }} wrapperStyle={tooltipWrapperStyle} />
                  <Line type="monotone" dataKey="buy" name="매수" stroke="var(--semantic-buy)" strokeWidth={2} dot={makeDot('var(--semantic-buy)', 'buy')} activeDot={{ r: 5 }} connectNulls />
                  <Line type="monotone" dataKey="hold" name="중립" stroke="var(--data-4)" strokeWidth={2} dot={makeDot('var(--data-4)', 'hold')} activeDot={{ r: 5 }} connectNulls />
                  <Line type="monotone" dataKey="sell" name="매도" stroke="var(--semantic-sell)" strokeWidth={2} dot={makeDot('var(--semantic-sell)', 'sell')} activeDot={{ r: 5 }} connectNulls />
                </LineChart>
              </ResponsiveContainer>
              <div style={{ display: 'flex', gap: 12, fontSize: 10, color: 'var(--text-3)', marginTop: 4 }}>
                {[['var(--semantic-buy)', '매수'], ['var(--data-4)', '중립'], ['var(--semantic-sell)', '매도']].map(([color, label]) => (
                  <span key={label} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                    <span style={{ width: 8, height: 8, background: color, display: 'inline-block', borderRadius: 2 }} />
                    {label}
                  </span>
                ))}
              </div>
            </>
          )}
          {tab === 2 && (
            <ResponsiveContainer width="100%" height={155}>
              <LineChart data={filteredData} margin={chartMargin}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--chart-grid)" />
                <XAxis dataKey="date" tick={xTick} height={40} axisLine={false} tickLine={false} />
                <YAxis yAxisId="left" tickFormatter={fmtYAxis} tick={axisStyle} axisLine={false} tickLine={false} width={42} />
                <YAxis yAxisId="right" orientation="right" tick={axisStyle} axisLine={false} tickLine={false} width={24} />
                <Tooltip allowEscapeViewBox={{ x: false, y: false }} wrapperStyle={tooltipWrapperStyle} content={({ active, payload, label }) => {
                  if (!active || !payload?.length) return null
                  const idx = filteredData.findIndex(d => d.date === label)
                  const prev = idx > 0 ? filteredData[idx - 1] : null
                  return (
                    <div style={{ background: 'var(--bg-elev)', border: '1px solid var(--border)', borderRadius: 6, padding: '8px 12px', fontSize: 11 }}>
                      <div style={{ color: 'var(--accent)', fontWeight: 700, marginBottom: 4 }}>{label}</div>
                      {payload.map(p => {
                        const val = p.value
                        const prevVal = prev?.[p.dataKey]
                        const delta = prevVal != null && val != null ? val - prevVal : null
                        const pct = delta != null && prevVal !== 0 ? delta / prevVal * 100 : null
                        const isPrice = p.dataKey === 'target_mean'
                        const dColor = delta == null || delta === 0 ? p.stroke : delta > 0 ? 'var(--up)' : 'var(--down)'
                        return (
                          <div key={p.dataKey} style={{ color: p.stroke, marginBottom: 2 }}>
                            {p.name}: {val ?? '—'}
                            {delta != null && delta !== 0 && pct != null && <span style={{ color: dColor, fontSize: 10 }}>{deltaStr(delta, pct, isPrice)}</span>}
                          </div>
                        )
                      })}
                    </div>
                  )
                }} />
                <Line yAxisId="left" type="monotone" dataKey="target_mean" name="목표가" stroke="var(--data-3)" strokeWidth={2} dot={overlayTargetDot} activeDot={{ r: 5 }} connectNulls />
                <Line yAxisId="right" type="monotone" dataKey="buy" name="매수" stroke="var(--semantic-buy)" strokeWidth={2} dot={overlayBuyDot} activeDot={{ r: 5 }} connectNulls />
              </LineChart>
            </ResponsiveContainer>
          )}
        </>
      )}
    </div>
  )
}

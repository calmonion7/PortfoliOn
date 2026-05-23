import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import axios from 'axios'

import { LineChart, Line, BarChart, Bar, Cell, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine, LabelList, Legend } from 'recharts'
import { TAB_STYLE, fmtPrice as fmt } from '../utils'
import ConsensusChart from '../components/reports/ConsensusChart'
import FinancialsChart from '../components/reports/FinancialsChart'
import DetailSummaryTab, { RsiTable } from '../components/reports/DetailTab'

const TH = { padding: '6px 10px', textAlign: 'right', borderBottom: '1px solid var(--border)', whiteSpace: 'nowrap', fontSize: 11, color: 'var(--text-muted)', position: 'sticky', top: 0, zIndex: 2, background: 'var(--bg-surface)' }
const TD = { padding: '5px 10px', textAlign: 'right', borderBottom: '1px solid var(--border)', fontSize: 12 }
const fmtN = (val) => val != null ? val : 'N/A'
const rsiColor = (rsi) => {
  if (rsi == null) return 'var(--text-muted)'
  const hue = Math.round(120 - (rsi / 100) * 120)
  return `hsl(${hue}, 60%, 60%)`
}

const fmtGap = (target, price) => {
  if (target == null || !price) return null
  const pct = (target - price) / price * 100
  return { text: `${pct >= 0 ? '+' : ''}${pct.toFixed(1)}%`, positive: pct >= 0 }
}

function TargetTooltip({ s }) {
  const [visible, setVisible] = useState(false)
  const ref = useRef(null)
  const [pos, setPos] = useState({ top: 0, left: 0 })

  const total = (s?.buy ?? 0) + (s?.hold ?? 0) + (s?.sell ?? 0)
  const pct = (n) => total > 0 ? ` (${Math.round(n / total * 100)}%)` : ''
  const gap = s?.target_mean != null && s?.price != null
    ? ((s.target_mean - s.price) / s.price * 100)
    : null

  const handleMouseEnter = (e) => {
    const rect = e.currentTarget.getBoundingClientRect()
    setPos({ top: rect.bottom + 4, left: rect.left })
    setVisible(true)
  }

  return (
    <div ref={ref} style={{ display: 'inline-block', position: 'relative' }}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={() => setVisible(false)}
    >
      {s ? fmt(s.target_mean, s.market) : 'N/A'}
      {gap != null && <div style={{ color: gap >= 0 ? '#81c784' : '#ef9a9a', fontSize: 10 }}>{gap >= 0 ? '+' : ''}{gap.toFixed(1)}%</div>}
      {visible && s?.target_mean != null && (
        <div style={{
          position: 'fixed',
          top: pos.top,
          left: pos.left,
          zIndex: 9999,
          background: 'var(--bg-card)',
          border: '1px solid var(--border)',
          borderRadius: 6,
          padding: '10px 14px',
          minWidth: 200,
          fontSize: 12,
          color: 'var(--text)',
          boxShadow: '0 4px 16px rgba(0,0,0,0.6)',
          pointerEvents: 'none',
          lineHeight: 1.8,
        }}>
          <div style={{ color: 'var(--accent)', fontWeight: 700, marginBottom: 6, fontSize: 11 }}>목표가 근거</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '2px 10px' }}>
            <span style={{ color: 'var(--text-muted)' }}>평균</span>
            <span style={{ color: 'var(--text)', fontWeight: 600 }}>{fmt(s.target_mean, s.market)}{gap != null && <span style={{ color: gap >= 0 ? '#81c784' : '#ef9a9a', marginLeft: 4 }}>{gap >= 0 ? '+' : ''}{gap.toFixed(1)}%</span>}</span>
            <span style={{ color: 'var(--text-muted)' }}>최고</span>
            <span style={{ color: '#81c784' }}>{fmt(s.target_high, s.market)}</span>
            <span style={{ color: 'var(--text-muted)' }}>최저</span>
            <span style={{ color: '#ef9a9a' }}>{fmt(s.target_low, s.market)}</span>
            <span style={{ color: 'var(--text-muted)' }}>애널리스트</span>
            <span>{total > 0 ? `${total}명` : 'N/A'}</span>
            <span style={{ color: 'var(--text-muted)' }}>Buy</span>
            <span style={{ color: '#81c784' }}>{s.buy ?? 0}{pct(s.buy ?? 0)}</span>
            <span style={{ color: 'var(--text-muted)' }}>Hold</span>
            <span>{s.hold ?? 0}{pct(s.hold ?? 0)}</span>
            <span style={{ color: 'var(--text-muted)' }}>Sell</span>
            <span style={{ color: '#ef9a9a' }}>{s.sell ?? 0}{pct(s.sell ?? 0)}</span>
            {s.finviz_recom != null && <>
              <span style={{ color: 'var(--text-muted)' }}>Finviz</span>
              <span>{s.finviz_recom} <span style={{ color: 'var(--text-muted)', fontSize: 10 }}>(1=강매수)</span></span>
            </>}
          </div>
        </div>
      )}
    </div>
  )
}

const GapCell = ({ target, price, baseColor, highlight, market }) => {
  const gap = fmtGap(target, price)
  return (
    <td style={{ ...TD, color: baseColor, background: highlight ? 'var(--bg-hover)' : undefined, border: highlight ? '2px solid var(--accent)' : undefined, fontWeight: highlight ? 700 : undefined }}>
      {target != null ? <>{fmt(target, market)}{gap && <span style={{ color: gap.positive ? '#81c784' : '#ef9a9a' }}>({gap.text})</span>}</> : 'N/A'}
    </td>
  )
}




function ReportSectionText({ title, text }) {
  if (!text) return null
  return (
    <div style={{ marginBottom: 20 }}>
      <div style={{ fontWeight: 600, fontSize: 13, color: 'var(--accent)', marginBottom: 8 }}>{title}</div>
      <p style={{ fontSize: 13, color: 'var(--text)', lineHeight: 1.8, margin: 0, whiteSpace: 'pre-wrap' }}>{text}</p>
    </div>
  )
}

function ReportSectionCompetitors({ competitors, market }) {
  if (!competitors?.length) return null
  const fmtMC = (mc) => {
    if (mc == null) return 'N/A'
    if (mc >= 1e12) return `${(mc / 1e12).toFixed(1)}T`
    if (mc >= 1e9) return `${(mc / 1e9).toFixed(1)}B`
    return `${(mc / 1e6).toFixed(0)}M`
  }
  return (
    <div style={{ marginBottom: 20 }}>
      <div style={{ fontWeight: 600, fontSize: 13, color: 'var(--accent)', marginBottom: 8 }}>1️⃣ 사업영역 & 시장순위</div>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
          <thead>
            <tr>
              {['종목', '티커', '현재가', '시가총액', 'YTD'].map(h => (
                <th key={h} style={{ ...TH }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {competitors.map((c, i) => (
              <tr key={i}>
                <td style={{ ...TD, textAlign: 'left' }}>{c.name || c.ticker}</td>
                <td style={TD}>{c.ticker}</td>
                <td style={TD}>{fmt(c.price, market)}</td>
                <td style={TD}>{c.market_cap ? (market === 'KR' ? `₩${fmtMC(c.market_cap)}` : `$${fmtMC(c.market_cap)}`) : 'N/A'}</td>
                <td style={{ ...TD, color: c.ytd_return >= 0 ? '#81c784' : '#ef9a9a' }}>
                  {c.ytd_return != null ? `${c.ytd_return >= 0 ? '+' : ''}${c.ytd_return.toFixed(1)}%` : 'N/A'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function ReportSectionNews({ disclosures, news }) {
  return (
    <div style={{ marginBottom: 20 }}>
      <div style={{ fontWeight: 600, fontSize: 13, color: 'var(--accent)', marginBottom: 8 }}>5️⃣ 최근 공시 & 뉴스</div>
      {disclosures && (
        <p style={{ fontSize: 13, color: 'var(--text)', lineHeight: 1.8, margin: '0 0 10px' }}>{disclosures}</p>
      )}
      {news?.length > 0 ? (
        <ul style={{ margin: 0, padding: '0 0 0 16px', fontSize: 12, lineHeight: 1.8 }}>
          {news.map((item, i) => (
            <li key={i}>
              <a href={item.link} target="_blank" rel="noreferrer"
                 style={{ color: 'var(--accent)', textDecoration: 'none' }}>{item.title}</a>
              <span style={{ color: 'var(--text-muted)', marginLeft: 6 }}>
                — {item.publisher} ({item.published_at})
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p style={{ color: 'var(--text-muted)', fontSize: 12 }}>_(뉴스 없음)_</p>
      )}
    </div>
  )
}

function HistoryTab({ ticker, dates, market }) {
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
    axios.get(`/api/report/${ticker}/history`)
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
    axios.get(`/api/report/${ticker}/${compareA}`)
      .then(({ data }) => setSnapshotA(data.summary))
      .catch(() => setSnapshotA(null))
  }, [ticker, compareA])

  useEffect(() => {
    if (!ticker || !compareB) return
    axios.get(`/api/report/${ticker}/${compareB}`)
      .then(({ data }) => setSnapshotB(data.summary))
      .catch(() => setSnapshotB(null))
  }, [ticker, compareB])

  if (histLoading) return <p style={{ color: 'var(--text-muted)', fontSize: 13 }}>로딩 중...</p>
  if (histError) return <p style={{ color: '#ef9a9a', fontSize: 13 }}>{histError}</p>
  if (history.length === 0) return <p style={{ color: 'var(--text-muted)', fontSize: 13 }}>히스토리 데이터가 없습니다.</p>

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
              color: trendTab === key ? 'var(--accent)' : 'var(--text-muted)',
              fontWeight: trendTab === key ? 600 : 400,
              marginBottom: -1,
            }}>{label}</button>
          ))}
        </div>

        {trendTab === 'target' && (
          <ResponsiveContainer width="100%" height={220}>
            <LineChart data={history} margin={{ top: 4, right: 12, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
              <XAxis dataKey="date" tickFormatter={xTickFormatter} tick={{ fontSize: 10, fill: 'var(--text-muted)' }} />
              <YAxis tick={{ fontSize: 10, fill: 'var(--text-muted)' }} width={60} tickFormatter={(v) => v != null ? fmt(v, market) : ''} />
              <Tooltip
                contentStyle={{ background: 'var(--bg-card)', border: '1px solid var(--border)', fontSize: 11 }}
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
              <XAxis dataKey="date" tickFormatter={xTickFormatter} tick={{ fontSize: 10, fill: 'var(--text-muted)' }} />
              <YAxis domain={[0, 100]} tick={{ fontSize: 10, fill: 'var(--text-muted)' }} width={30} />
              <Tooltip contentStyle={{ background: 'var(--bg-card)', border: '1px solid var(--border)', fontSize: 11 }} />
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
            style={{ background: 'var(--bg-card)', color: 'var(--text)', border: '1px solid var(--border)', borderRadius: 4, padding: '3px 8px', fontSize: 12 }}>
            {history.map(h => <option key={h.date} value={h.date}>{h.date}</option>)}
          </select>
          <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>vs</span>
          <select value={compareB ?? ''} onChange={e => setCompareB(e.target.value)}
            style={{ background: 'var(--bg-card)', color: 'var(--text)', border: '1px solid var(--border)', borderRadius: 4, padding: '3px 8px', fontSize: 12 }}>
            {history.map(h => <option key={h.date} value={h.date}>{h.date}</option>)}
          </select>
        </div>

        {history.length < 2
          ? <p style={{ color: 'var(--text-muted)', fontSize: 12 }}>비교할 날짜가 없습니다.</p>
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
                        <td style={{ ...TD, textAlign: 'left', color: 'var(--text-muted)' }}>{label}</td>
                        <td style={TD}>{fmtFn(keyA)}</td>
                        <td style={TD}>{fmtFn(keyB)}</td>
                        <td style={{ ...TD, color: delta == null ? 'var(--text-muted)' : delta >= 0 ? '#81c784' : '#ef9a9a' }}>
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

export default function Reports() {
  const [reportList, setReportList] = useState({})
  const [selected, setSelected] = useState({ ticker: null, date: null })
  const [detail, setDetail] = useState({ summary: null })
  const [loading, setLoading] = useState(false)
  const [generating, setGenerating] = useState(null)
  const [genProgress, setGenProgress] = useState({ done: 0, total: 0 })
  const pollRef = useRef(null)
  const [consensusBatch, setConsensusBatch] = useState({ running: false, done: 0, total: 0, current: '' })
  const consensusPollRef = useRef(null)
  const [activeTab, setActiveTab] = useState('holdings')
  const [watchlistSub, setWatchlistSub] = useState('low')
  const [view, setView] = useState('list')
  const [detailRefreshKey, setDetailRefreshKey] = useState(0)
  const [activeDetailTab, setActiveDetailTab] = useState('summary')
  const [marketFilter, setMarketFilter] = useState('ALL')
  const [guruMap, setGuruMap] = useState({})  // ticker -> count

  useEffect(() => {
    axios.get('/api/guru/stats/popularity')
      .then(({ data }) => {
        const map = {}
        data.forEach(r => { if (r.count > 0) map[r.ticker] = r.count })
        setGuruMap(map)
      })
      .catch(() => {})
  }, [])

const fetchList = useCallback(() => {
    axios.get('/api/report/list').then(({ data }) => setReportList(data))
  }, [])

  useEffect(() => { fetchList() }, [])

  useEffect(() => {
    if (!selected.ticker || !selected.date) return
    setLoading(true)
    axios.get(`/api/report/${selected.ticker}/${selected.date}`)
      .then(({ data }) => setDetail({ summary: data.summary }))
      .finally(() => setLoading(false))
  }, [selected, detailRefreshKey])

  const openDetail = (ticker, date) => {
    setSelected({ ticker, date })
    setView('detail')
    setActiveDetailTab('summary')
  }

  const generateOne = async (ticker) => {
    setGenerating(ticker)
    setGenProgress({ done: 0, total: 0 })
    clearInterval(pollRef.current)
    try {
      await axios.post(`/api/report/generate/${ticker}`)
      pollRef.current = setInterval(async () => {
        try {
          const { data } = await axios.get('/api/report/progress')
          setGenProgress({ done: data.done, total: data.total })
          if (!data.running && data.total > 0 && data.done >= data.total) {
            clearInterval(pollRef.current)
            fetchList()
            setGenerating(null)
            if (view === 'detail' && selected.ticker === ticker) {
              setDetailRefreshKey(k => k + 1)
            }
          }
        } catch {}
      }, 1500)
    } catch {
      setGenerating(null)
    }
  }

  useEffect(() => () => clearInterval(pollRef.current), [])

  const runConsensusBatch = async () => {
    setConsensusBatch({ running: true, done: 0, total: 0, current: '' })
    clearInterval(consensusPollRef.current)
    try {
      await axios.post('/api/consensus/batch')
      consensusPollRef.current = setInterval(async () => {
        try {
          const { data } = await axios.get('/api/consensus/batch/progress')
          setConsensusBatch({ running: data.running, done: data.done, total: data.total, current: data.current })
          if (!data.running && data.total > 0 && data.done >= data.total) {
            clearInterval(consensusPollRef.current)
          }
        } catch {}
      }, 1500)
    } catch {
      setConsensusBatch(p => ({ ...p, running: false }))
    }
  }

  useEffect(() => () => clearInterval(consensusPollRef.current), [])

  const holdingsCount = Object.values(reportList).filter(v => v.category === 'holdings').length
  const watchlistAll = Object.entries(reportList).filter(([, v]) => v.category === 'watchlist')
  const watchlistLowCount = watchlistAll.filter(([, v]) => (v.summary?.daily_rsi?.rsi ?? 999) <= 45).length
  const watchlistHighCount = watchlistAll.filter(([, v]) => (v.summary?.daily_rsi?.rsi ?? -1) > 45).length
  const watchlistCount = watchlistAll.length

  const currentTabBaseEntries = Object.entries(reportList).filter(([, v]) =>
    activeTab === 'holdings' ? v.category === 'holdings' : v.category === 'watchlist'
  )
  const mCountKR = currentTabBaseEntries.filter(([, v]) => (v.summary?.market || v.market) === 'KR').length
  const mCountUS = currentTabBaseEntries.filter(([, v]) => (v.summary?.market || v.market) === 'US').length
  const mCountAll = currentTabBaseEntries.length

  const tabEntries = Object.entries(reportList)
    .filter(([, v]) => {
      if (activeTab === 'holdings') return v.category === 'holdings'
      if (activeTab === 'watchlist') {
        if (v.category !== 'watchlist') return false
        const rsi = v.summary?.daily_rsi?.rsi ?? null
        return watchlistSub === 'low' ? (rsi === null || rsi <= 45) : (rsi !== null && rsi > 45)
      }
      return false
    })
    .filter(([, v]) => {
      if (marketFilter === 'ALL') return true
      const m = v.summary?.market || v.market
      return m === marketFilter
    })
    .sort(([, a], [, b]) => {
      const gapOf = (s) => {
        const t = s.summary?.target_mean, p = s.summary?.price
        return t != null && p ? (t - p) / p * 100 : null
      }
      if (activeTab === 'holdings') {
        // 1차 평균목표가 비율 낮은순, 2차 RSI 일봉 높은순
        const gapA = gapOf(a), gapB = gapOf(b)
        if (gapA !== gapB) {
          if (gapA === null) return 1
          if (gapB === null) return -1
          return gapA - gapB
        }
        const rsiA = a.summary?.daily_rsi?.rsi ?? null
        const rsiB = b.summary?.daily_rsi?.rsi ?? null
        if (rsiA === null && rsiB === null) return 0
        if (rsiA === null) return 1
        if (rsiB === null) return -1
        return rsiB - rsiA
      }
      // 관심종목: 1차 평균목표가 비율 높은순, 2차 RSI 일봉 낮은순
      const gapA = gapOf(a), gapB = gapOf(b)
      if (gapA !== gapB) {
        if (gapA === null) return 1
        if (gapB === null) return -1
        return gapB - gapA
      }
      const rsiA = a.summary?.daily_rsi?.rsi ?? null
      const rsiB = b.summary?.daily_rsi?.rsi ?? null
      if (rsiA === null && rsiB === null) return 0
      if (rsiA === null) return 1
      if (rsiB === null) return -1
      return rsiA - rsiB
    })

  const renderTickerItem = (ticker, info) => {
    const isSelected = selected.ticker === ticker && view === 'detail'
    const hasReport = info.dates.length > 0
    return (
      <div
        key={ticker}
        onClick={() => hasReport ? openDetail(ticker, info.dates[0]) : generateOne(ticker)}
        style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 2, padding: '5px 6px', borderRadius: 4, cursor: 'pointer', background: isSelected ? 'var(--bg-hover)' : 'transparent', borderLeft: isSelected ? '2px solid var(--accent)' : '2px solid transparent' }}
      >
        <div style={{ minWidth: 0, flex: 1 }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <span style={{ color: isSelected ? 'var(--accent)' : 'var(--text)', fontWeight: 600, fontSize: 13 }}>{ticker}</span>
            {(() => { const w = overallWeather(info.summary); return w ? <span title={w.label} style={{ fontSize: 12, lineHeight: 1 }}>{w.icon}</span> : null })()}
          </span>
          {info.summary?.name && (
            <div style={{ color: 'var(--text-muted)', fontSize: 10, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{info.summary.name}</div>
          )}
          {guruMap[ticker] && (
            <div style={{ color: '#ffb74d', fontSize: 10 }}>구루 {guruMap[ticker]}명</div>
          )}
          {!hasReport && <div style={{ color: 'var(--text-muted)', fontSize: 10 }}>클릭하여 생성</div>}
          {generating === ticker && genProgress.total > 0 && (
            <div style={{ marginTop: 3 }}>
              <div style={{ background: 'var(--bg-hover)', borderRadius: 2, height: 3, overflow: 'hidden' }}>
                <div style={{ width: `${Math.round(genProgress.done / genProgress.total * 100)}%`, height: '100%', background: 'var(--accent)', transition: 'width 0.4s ease' }} />
              </div>
            </div>
          )}
        </div>
        <button
          onClick={e => { e.stopPropagation(); generateOne(ticker) }}
          disabled={!!generating}
          style={{ background: 'transparent', border: '1px solid var(--border)', color: generating === ticker ? 'var(--accent)' : 'var(--text-muted)', borderRadius: 3, padding: '1px 6px', fontSize: 11, cursor: generating ? 'default' : 'pointer', flexShrink: 0 }}
        >
          {generating === ticker ? `${genProgress.done}/${genProgress.total || '?'}` : '생성'}
        </button>
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', gap: 24, height: 'calc(100vh - 120px)' }}>
      {/* 좌측 사이드바 */}
      <div style={{ width: 210, overflowY: 'auto', borderRight: '1px solid var(--border)', paddingRight: 16, flexShrink: 0 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
          <h3 style={{ color: 'var(--text-heading)', margin: 0 }}>리포트 목록</h3>
          <button
            onClick={runConsensusBatch}
            disabled={consensusBatch.running}
            title="전체 종목 수집 → 백필"
            style={{
              background: 'transparent', border: '1px solid var(--border)',
              color: consensusBatch.running ? 'var(--accent)' : 'var(--text-muted)',
              borderRadius: 3, padding: '2px 7px', fontSize: 10,
              cursor: consensusBatch.running ? 'default' : 'pointer', whiteSpace: 'nowrap',
            }}
          >
            {consensusBatch.running
              ? `${consensusBatch.current || '...'} (${consensusBatch.done}/${consensusBatch.total})`
              : '전체 수집/백필'}
          </button>
        </div>
        {consensusBatch.running && consensusBatch.total > 0 && (
          <div style={{ marginBottom: 8 }}>
            <div style={{ background: 'var(--bg-hover)', borderRadius: 2, height: 3, overflow: 'hidden' }}>
              <div style={{ width: `${Math.round(consensusBatch.done / consensusBatch.total * 100)}%`, height: '100%', background: 'var(--accent)', transition: 'width 0.4s ease' }} />
            </div>
          </div>
        )}
        <div style={{ display: 'flex', borderBottom: '1px solid var(--border)', marginBottom: activeTab === 'watchlist' ? 0 : 12 }}>
          <button style={TAB_STYLE(activeTab === 'holdings')} onClick={() => setActiveTab('holdings')}>보유 ({holdingsCount})</button>
          <button style={TAB_STYLE(activeTab === 'watchlist')} onClick={() => setActiveTab('watchlist')}>관심 ({watchlistCount})</button>
        </div>
        {activeTab === 'watchlist' && (
          <div style={{ display: 'flex', borderBottom: '1px solid var(--border)', marginBottom: 8, marginTop: 4 }}>
            <button
              style={{ ...TAB_STYLE(watchlistSub === 'low'), fontSize: 11, padding: '4px 10px', color: watchlistSub === 'low' ? '#81c784' : 'var(--text-muted)', borderBottom: watchlistSub === 'low' ? '2px solid #81c784' : '2px solid transparent' }}
              onClick={() => setWatchlistSub('low')}
            >RSI≤45 ({watchlistLowCount})</button>
            <button
              style={{ ...TAB_STYLE(watchlistSub === 'high'), fontSize: 11, padding: '4px 10px', color: watchlistSub === 'high' ? '#ef9a9a' : 'var(--text-muted)', borderBottom: watchlistSub === 'high' ? '2px solid #ef9a9a' : '2px solid transparent' }}
              onClick={() => setWatchlistSub('high')}
            >RSI&gt;45 ({watchlistHighCount})</button>
          </div>
        )}
        <div style={{ display: 'flex', gap: 4, marginBottom: 10 }}>
          {[['ALL', '전체', mCountAll], ['KR', '🇰🇷 국내', mCountKR], ['US', '🇺🇸 해외', mCountUS]].map(([val, label, cnt]) => (
            <button
              key={val}
              onClick={() => setMarketFilter(val)}
              style={{
                flex: 1, padding: '3px 0', fontSize: 10,
                background: marketFilter === val ? 'var(--bg-hover)' : 'transparent',
                border: `1px solid ${marketFilter === val ? 'var(--accent)' : 'var(--border)'}`,
                color: marketFilter === val ? 'var(--accent)' : 'var(--text-muted)',
                borderRadius: 3, cursor: 'pointer', lineHeight: 1.6,
              }}
            >
              {label}<br />
              <span style={{ fontSize: 9, opacity: 0.8 }}>({cnt})</span>
            </button>
          ))}
        </div>
        {tabEntries.length === 0 && <p style={{ color: 'var(--text-muted)', fontSize: 12 }}>리포트 없음</p>}
        {tabEntries.map(([t, info]) => renderTickerItem(t, info))}
      </div>

      {/* 우측 패널 */}
      <div style={{ flex: 1, overflowY: 'auto', overflowX: view === 'list' ? 'auto' : 'hidden' }}>
        {view === 'list' ? (
          /* 목록화면 */
          tabEntries.length === 0 ? (
            <div style={{ textAlign: 'center', marginTop: 80, color: 'var(--text-muted)' }}>
              <p>리포트가 없습니다.</p>
              <p style={{ marginTop: 8, fontSize: 13 }}>설정 페이지에서 "지금 생성" 버튼을 눌러 첫 리포트를 만드세요.</p>
            </div>
          ) : (
            <table style={{ borderCollapse: 'collapse', color: 'var(--text)', width: '100%' }}>
              <thead>
                <tr style={{ background: 'var(--bg-surface)' }}>
                  <th style={{ ...TH, textAlign: 'left', left: 0, zIndex: 3 }}>종목명 (티커)</th>
                  <th style={{ ...TH, textAlign: 'left' }}>시장</th>
                  <th style={{ ...TH, textAlign: 'left' }}>섹터</th>
                  <th style={TH}>현재가</th>
                  <th style={{ ...TH, color: '#ffb74d' }}>20일고점대비</th>
                  <th style={TH}>POC</th>
                  <th style={TH}>평균목표가<br/><span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>vs 현재가</span></th>
                  <th style={{ ...TH, color: '#81c784' }}>Buy</th>
                  <th style={TH}>Hold</th>
                  <th style={{ ...TH, color: '#ef9a9a' }}>Sell</th>
                  <th style={TH}>PER<br/><span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>Fwd</span></th>
                  <th style={TH}>PBR</th>
                  <th style={TH}>Finviz</th>
                  <th style={{ ...TH, borderLeft: '1px solid var(--border)' }}>RSI<br/><span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>일/주/월</span></th>
                  <th style={{ ...TH, color: '#4db6ac' }}>RSI20<br/><span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>일/주/월</span></th>
                  <th style={{ ...TH, color: '#4db6ac' }}>RSI25<br/><span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>일/주/월</span></th>
                  <th style={{ ...TH, color: '#4db6ac' }}>RSI30<br/><span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>일/주/월</span></th>
                  <th style={{ ...TH, color: '#ff8a65' }}>RSI70<br/><span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>일/주/월</span></th>
                  <th style={{ ...TH, color: '#ff8a65' }}>RSI75<br/><span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>일/주/월</span></th>
                  <th style={{ ...TH, color: '#ff8a65' }}>RSI80<br/><span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>일/주/월</span></th>
                </tr>
              </thead>
              <tbody>
                {tabEntries.map(([ticker, info]) => {
                  const s = info.summary
                  const dr = s?.daily_rsi
                  const wr = s?.weekly_rsi
                  const mr = s?.monthly_rsi
                  const rsiKeys = ['target_20', 'target_25', 'target_30', 'target_70', 'target_75', 'target_80']
                  let closestKey = null; let minDiff = Infinity
                  if (s?.price && dr) {
                    rsiKeys.forEach(k => {
                      if (dr[k] == null) return
                      const diff = Math.abs(dr[k] - s.price)
                      if (diff < minDiff) { minDiff = diff; closestKey = k }
                    })
                  }
                  const hasReport = info.dates.length > 0
                  const market = s?.market || info.market
                  return (
                    <tr
                      key={ticker}
                      onClick={() => hasReport ? openDetail(ticker, info.dates[0]) : generateOne(ticker)}
                      style={{ cursor: 'pointer', borderBottom: '1px solid var(--border)', opacity: hasReport ? 1 : 0.6 }}
                      onMouseEnter={e => { e.currentTarget.style.background = 'var(--bg-hover)'; e.currentTarget.querySelector('td').style.background = 'var(--bg-hover)' }}
                      onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.querySelector('td').style.background = 'var(--bg)' }}
                    >
                      <td style={{ ...TD, textAlign: 'left', color: 'var(--accent)', fontWeight: 600, position: 'sticky', left: 0, zIndex: 1, background: 'var(--bg)' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                          {s?.name || ticker}
                          {(() => { const w = overallWeather(s); return w ? <span title={w.label} style={{ fontSize: 13, lineHeight: 1, fontWeight: 400 }}>{w.icon}</span> : null })()}
                        </div>
                        <div style={{ color: 'var(--text-muted)', fontWeight: 400, fontSize: 11 }}>{ticker}</div>
                        {guruMap[ticker] && <div style={{ color: '#ffb74d', fontSize: 10 }}>구루 {guruMap[ticker]}명</div>}
                        {!hasReport && <div style={{ color: 'var(--text-muted)', fontSize: 10 }}>리포트 없음 — 클릭하여 생성</div>}
                      </td>
                      <td style={{ ...TD, textAlign: 'left' }}>
                        {market === 'KR'
                          ? <span style={{ fontSize: 10, padding: '1px 5px', borderRadius: 3, background: '#1a3a2a', color: '#81c784', border: '1px solid #2e6b4a', whiteSpace: 'nowrap' }}>🇰🇷 KR</span>
                          : <span style={{ fontSize: 10, padding: '1px 5px', borderRadius: 3, background: 'var(--bg-surface)', color: '#4fc3f7', border: '1px solid var(--border)', whiteSpace: 'nowrap' }}>🇺🇸 US</span>
                        }
                      </td>
                      <td style={{ ...TD, textAlign: 'left', color: 'var(--text-muted)', fontSize: 11 }}>
                        <div>{s?.sector || '—'}</div>
                        {s?.industry ? <div style={{ color: 'var(--text-muted)', fontSize: 10 }}>{s.industry}</div> : null}
                      </td>
                      <td style={TD}>{s ? fmt(s.price, s.market) : 'N/A'}</td>
                      <td style={TD}>
                        {s?.drop_from_high_20d != null ? (
                          <span style={{ color: s.drop_from_high_20d >= 0 ? '#81c784' : '#ef9a9a', fontWeight: 600 }}>
                            {s.drop_from_high_20d < -10 && <span title="20일 고점 대비 -10% 초과 하락">⚠ </span>}
                            {s.drop_from_high_20d >= 0 ? '+' : ''}{s.drop_from_high_20d.toFixed(1)}%
                          </span>
                        ) : '—'}
                      </td>
                      <td style={TD}>{fmt(s?.volume_profile?.poc, s?.market)}</td>
                      <td style={TD}>
                        <TargetTooltip s={s} />
                      </td>
                      {(() => {
                        const buy = s?.buy ?? 0, hold = s?.hold ?? 0, sell = s?.sell ?? 0
                        const total = buy + hold + sell
                        const pct = (n) => total > 0 ? `(${Math.round(n / total * 100)}%)` : ''
                        const lowAnalysts = s && total > 0 && total <= 10
                        return (<>
                          <td style={{ ...TD, color: '#81c784' }}>
                            {s ? `${buy}${pct(buy)}` : 'N/A'}
                            {lowAnalysts && (
                              <div title={`애널리스트 ${total}명 — 의견 수가 적어 신뢰도가 낮을 수 있습니다`} style={{ color: '#ffb74d', fontSize: 9, marginTop: 1, cursor: 'help' }}>⚠ 총 {total}명</div>
                            )}
                          </td>
                          <td style={TD}>{s ? `${hold}${pct(hold)}` : 'N/A'}</td>
                          <td style={{ ...TD, color: '#ef9a9a' }}>{s ? `${sell}${pct(sell)}` : 'N/A'}</td>
                        </>)
                      })()}
                      <td style={TD}>
                        {s?.per != null ? s.per.toFixed(1) : '—'}
                        {s?.forward_per != null && <div style={{ color: 'var(--text-muted)', fontSize: 10 }}>{s.forward_per.toFixed(1)}</div>}
                      </td>
                      <td style={TD}>{s?.pbr != null ? s.pbr.toFixed(2) : '—'}</td>
                      <td style={TD}>{s ? fmtN(s.finviz_recom) : 'N/A'}</td>
                      <td style={{ ...TD, borderLeft: '1px solid var(--border)' }}>
                        <div style={{ color: rsiColor(dr?.rsi), fontWeight: 600 }}>{dr?.rsi != null ? fmtN(dr.rsi) : 'N/A'}</div>
                        <div style={{ color: rsiColor(wr?.rsi), fontSize: 10 }}>{wr?.rsi != null ? fmtN(wr.rsi) : 'N/A'}</div>
                        <div style={{ color: rsiColor(mr?.rsi), fontSize: 10 }}>{mr?.rsi != null ? fmtN(mr.rsi) : 'N/A'}</div>
                      </td>
                      {[
                        { key: 'target_20', dr: dr?.target_20, wr: wr?.target_20, mr: mr?.target_20, base: '#81c784', sub: '#4a8a5a' },
                        { key: 'target_25', dr: dr?.target_25, wr: wr?.target_25, mr: mr?.target_25, base: '#81c784', sub: '#4a8a5a' },
                        { key: 'target_30', dr: dr?.target_30, wr: wr?.target_30, mr: mr?.target_30, base: '#81c784', sub: '#4a8a5a' },
                        { key: 'target_70', dr: dr?.target_70, wr: wr?.target_70, mr: mr?.target_70, base: '#ef9a9a', sub: '#8a4a4a' },
                        { key: 'target_75', dr: dr?.target_75, wr: wr?.target_75, mr: mr?.target_75, base: '#ef9a9a', sub: '#8a4a4a' },
                        { key: 'target_80', dr: dr?.target_80, wr: wr?.target_80, mr: mr?.target_80, base: '#ef9a9a', sub: '#8a4a4a' },
                      ].map(({ key, dr: dv, wr: wv, mr: mv, base, sub }) => {
                        const gapEl = (t, sz) => {
                          if (t == null || !s?.price) return null
                          const p = (t - s.price) / s.price * 100
                          const txt = `(${p >= 0 ? '+' : ''}${p.toFixed(1)}%)`
                          return <span style={{ fontSize: sz ?? 12, color: p >= 0 ? '#81c784' : '#ef9a9a' }}>{txt}</span>
                        }
                        const isClosest = closestKey === key
                        return (
                          <td key={key} style={{ ...TD, color: base, background: isClosest ? 'var(--bg-hover)' : undefined, border: isClosest ? '2px solid var(--accent)' : undefined, fontWeight: isClosest ? 700 : undefined }}>
                            {dv != null ? <div>{fmt(dv, s?.market)}{gapEl(dv)}</div> : <div style={{ color: 'var(--text-muted)' }}>N/A</div>}
                            <div style={{ fontSize: 10, color: wv != null ? sub : 'var(--text-muted)' }}>{wv != null ? <>{fmt(wv, s?.market)}{gapEl(wv, 9)}</> : 'N/A'}</div>
                            <div style={{ fontSize: 10, color: mv != null ? sub : 'var(--text-muted)' }}>{mv != null ? <>{fmt(mv, s?.market)}{gapEl(mv, 9)}</> : 'N/A'}</div>
                          </td>
                        )
                      })}
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )
        ) : (
          /* 상세화면 */
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 16 }}>
              <button
                onClick={() => setView('list')}
                style={{ background: 'transparent', border: '1px solid var(--border)', color: 'var(--text-muted)', borderRadius: 4, padding: '4px 12px', fontSize: 12, cursor: 'pointer', flexShrink: 0 }}
              >
                ← 목록으로
              </button>
              <div style={{ flex: 1 }}>
                <span style={{ color: 'var(--text-heading)', fontWeight: 700, fontSize: 16 }}>
                  {detail.summary?.name || selected.ticker}
                </span>
                <span style={{ color: 'var(--text-muted)', fontSize: 14, marginLeft: 8 }}>({selected.ticker})</span>
                {detail.summary?.market === 'KR'
                  ? <span style={{ fontSize: 10, marginLeft: 8, padding: '1px 5px', borderRadius: 3, background: '#1a3a2a', color: '#81c784', border: '1px solid #2e6b4a' }}>🇰🇷 KR</span>
                  : <span style={{ fontSize: 10, marginLeft: 8, padding: '1px 5px', borderRadius: 3, background: 'var(--bg-surface)', color: '#4fc3f7', border: '1px solid var(--border)' }}>🇺🇸 US</span>
                }
                {guruMap[selected.ticker] && (
                  <span style={{ color: '#ffb74d', fontSize: 11, marginLeft: 8, background: '#2a1a00', padding: '2px 7px', borderRadius: 3 }}>
                    구루 {guruMap[selected.ticker]}명
                  </span>
                )}
                {reportList[selected.ticker]?.dates?.length > 1 ? (
                  <select
                    value={selected.date}
                    onChange={e => setSelected({ ticker: selected.ticker, date: e.target.value })}
                    style={{ marginLeft: 12, background: 'var(--bg-surface)', border: '1px solid var(--border)', color: 'var(--text-muted)', borderRadius: 4, padding: '2px 6px', fontSize: 12, cursor: 'pointer', width: 'fit-content' }}
                  >
                    {reportList[selected.ticker].dates.map(d => (
                      <option key={d} value={d}>{d}</option>
                    ))}
                  </select>
                ) : (
                  <span style={{ color: 'var(--text-muted)', fontSize: 13, marginLeft: 12 }}>{selected.date}</span>
                )}
                {detail.summary?.price != null && (
                  <span style={{ color: 'var(--text)', fontSize: 14, marginLeft: 12, fontWeight: 600 }}>{fmt(detail.summary.price, detail.summary.market)}</span>
                )}
                {detail.summary?.sector && (
                  <span style={{ color: 'var(--accent)', fontSize: 11, marginLeft: 12, background: 'var(--bg-surface)', padding: '2px 7px', borderRadius: 3 }}>
                    {detail.summary.sector}{detail.summary.industry ? ` / ${detail.summary.industry}` : ''}
                  </span>
                )}
                {detail.summary?.drop_from_high_20d != null && (
                  <span style={{
                    fontSize: 11, marginLeft: 8, padding: '2px 7px', borderRadius: 3,
                    background: detail.summary.drop_from_high_20d >= 0 ? '#1a3a1a' : '#2a1000',
                    color: detail.summary.drop_from_high_20d >= 0 ? '#81c784' : '#ffb74d',
                  }}>
                    {detail.summary.drop_from_high_20d < -10 && <span title="20일 고점 대비 -10% 초과 하락">⚠ </span>}
                    20일고점 {detail.summary.drop_from_high_20d >= 0 ? '+' : ''}{detail.summary.drop_from_high_20d.toFixed(1)}%
                  </span>
                )}
                {detail.summary?.per != null && (
                  <span style={{ color: 'var(--text-muted)', fontSize: 11, marginLeft: 8, background: 'var(--bg-surface)', padding: '2px 7px', borderRadius: 3 }}>
                    PER {detail.summary.per.toFixed(1)}
                    {detail.summary.forward_per != null && <span style={{ color: 'var(--text-muted)', marginLeft: 4 }}>/ Fwd {detail.summary.forward_per.toFixed(1)}</span>}
                  </span>
                )}
                {detail.summary?.pbr != null && (
                  <span style={{ color: 'var(--text-muted)', fontSize: 11, marginLeft: 4, background: 'var(--bg-surface)', padding: '2px 7px', borderRadius: 3 }}>
                    PBR {detail.summary.pbr.toFixed(2)}
                  </span>
                )}
              </div>
              <button
                onClick={() => generateOne(selected.ticker)}
                disabled={!!generating}
                style={{
                  background: 'transparent',
                  border: '1px solid var(--border)',
                  color: generating === selected.ticker ? 'var(--accent)' : 'var(--text-muted)',
                  borderRadius: 4,
                  padding: '4px 12px',
                  fontSize: 12,
                  cursor: generating ? 'default' : 'pointer',
                  flexShrink: 0,
                }}
              >
                {generating === selected.ticker
                  ? `${genProgress.done}/${genProgress.total || '?'}`
                  : '생성'}
              </button>
            </div>
            {/* 탭 바 */}
            <div style={{ display: 'flex', borderBottom: '1px solid var(--border)', marginBottom: 16, marginTop: 4 }}>
              {[
                { key: 'summary', label: '📊 요약' },
                { key: 'technical', label: '📈 기술적 분석' },
                { key: 'report', label: '📄 리포트' },
                { key: 'history', label: '📅 히스토리' },
              ].map(({ key, label }) => (
                <button
                  key={key}
                  onClick={() => setActiveDetailTab(key)}
                  style={{
                    background: 'transparent',
                    border: 'none',
                    borderBottom: activeDetailTab === key ? '2px solid var(--accent)' : '2px solid transparent',
                    color: activeDetailTab === key ? 'var(--accent)' : 'var(--text-muted)',
                    padding: '6px 16px',
                    fontSize: 12,
                    cursor: 'pointer',
                    marginBottom: -1,
                    fontWeight: activeDetailTab === key ? 600 : 400,
                  }}
                >
                  {label}
                </button>
              ))}
            </div>

            {loading && <p style={{ color: 'var(--text-muted)' }}>로딩 중...</p>}
            {!loading && activeDetailTab === 'summary' && (
              detail.summary
                ? <DetailSummaryTab summary={detail.summary} ticker={selected.ticker} />
                : <p style={{ color: 'var(--text-muted)', fontSize: 13 }}>요약 데이터가 없습니다.</p>
            )}
            {!loading && activeDetailTab === 'technical' && (
              detail.summary?.daily_rsi
                ? (
                  <>
                    <RsiTable
                      dailyRsi={detail.summary.daily_rsi}
                      weeklyRsi={detail.summary.weekly_rsi}
                      monthlyRsi={detail.summary.monthly_rsi}
                      price={detail.summary.price}
                      vp={detail.summary.volume_profile}
                      target={detail.summary.target_mean}
                      market={detail.summary.market}
                    />
                  </>
                )
                : <p style={{ color: 'var(--text-muted)', fontSize: 13 }}>기술적 분석 데이터가 없습니다.</p>
            )}
            {!loading && activeDetailTab === 'report' && (
              detail.summary
                ? (
                  <div style={{ padding: '0 4px' }}>
                    <ReportSectionCompetitors
                      competitors={detail.summary.competitors_data}
                      market={detail.summary.market}
                    />
                    <ReportSectionText title="2️⃣ 리스크" text={detail.summary.risks} />
                    <ReportSectionText title="3️⃣ 경제적 해자" text={detail.summary.moat} />
                    <ReportSectionText title="4️⃣ 장기 성장 계획" text={detail.summary.growth_plan} />
                    <ReportSectionNews
                      disclosures={detail.summary.recent_disclosures}
                      news={detail.summary.news}
                    />
                  </div>
                )
                : <p style={{ color: 'var(--text-muted)', fontSize: 13 }}>리포트 데이터가 없습니다.</p>
            )}
            {!loading && activeDetailTab === 'history' && (
              <HistoryTab
                ticker={selected.ticker}
                dates={reportList[selected.ticker]?.dates ?? []}
                market={reportList[selected.ticker]?.market ?? 'US'}
              />
            )}
          </div>
        )}
      </div>
    </div>
  )
}

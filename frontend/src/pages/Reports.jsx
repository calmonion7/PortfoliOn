import { useState, useEffect, useCallback, useRef } from 'react'
import axios from 'axios'
import MarkdownViewer from '../components/MarkdownViewer'

const TAB_STYLE = (active) => ({
  padding: '6px 14px',
  cursor: 'pointer',
  border: 'none',
  borderBottom: active ? '2px solid #4fc3f7' : '2px solid transparent',
  background: 'transparent',
  color: active ? '#4fc3f7' : '#888',
  fontWeight: active ? 600 : 400,
  fontSize: 13,
})

const TH = { padding: '6px 10px', textAlign: 'right', borderBottom: '1px solid #333', whiteSpace: 'nowrap', fontSize: 11, color: '#aaa' }
const TD = { padding: '5px 10px', textAlign: 'right', borderBottom: '1px solid #1e1e1e', fontSize: 12 }

const fmt = (val) => val != null ? `$${Number(val).toFixed(2)}` : 'N/A'
const fmtN = (val) => val != null ? val : 'N/A'
const rsiColor = (rsi) => {
  if (rsi == null) return '#ccc'
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
      {s ? fmt(s.target_mean) : 'N/A'}
      {gap != null && <div style={{ color: gap >= 0 ? '#81c784' : '#ef9a9a', fontSize: 10 }}>{gap >= 0 ? '+' : ''}{gap.toFixed(1)}%</div>}
      {visible && s?.target_mean != null && (
        <div style={{
          position: 'fixed',
          top: pos.top,
          left: pos.left,
          zIndex: 9999,
          background: '#1a1a2e',
          border: '1px solid #3a4a6a',
          borderRadius: 6,
          padding: '10px 14px',
          minWidth: 200,
          fontSize: 12,
          color: '#ccc',
          boxShadow: '0 4px 16px rgba(0,0,0,0.6)',
          pointerEvents: 'none',
          lineHeight: 1.8,
        }}>
          <div style={{ color: '#80cbc4', fontWeight: 700, marginBottom: 6, fontSize: 11 }}>목표가 근거</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '2px 10px' }}>
            <span style={{ color: '#78909c' }}>평균</span>
            <span style={{ color: '#fff', fontWeight: 600 }}>{fmt(s.target_mean)}{gap != null && <span style={{ color: gap >= 0 ? '#81c784' : '#ef9a9a', marginLeft: 4 }}>{gap >= 0 ? '+' : ''}{gap.toFixed(1)}%</span>}</span>
            <span style={{ color: '#78909c' }}>최고</span>
            <span style={{ color: '#81c784' }}>{fmt(s.target_high)}</span>
            <span style={{ color: '#78909c' }}>최저</span>
            <span style={{ color: '#ef9a9a' }}>{fmt(s.target_low)}</span>
            <span style={{ color: '#78909c' }}>애널리스트</span>
            <span>{total > 0 ? `${total}명` : 'N/A'}</span>
            <span style={{ color: '#78909c' }}>Buy</span>
            <span style={{ color: '#81c784' }}>{s.buy ?? 0}{pct(s.buy ?? 0)}</span>
            <span style={{ color: '#78909c' }}>Hold</span>
            <span>{s.hold ?? 0}{pct(s.hold ?? 0)}</span>
            <span style={{ color: '#78909c' }}>Sell</span>
            <span style={{ color: '#ef9a9a' }}>{s.sell ?? 0}{pct(s.sell ?? 0)}</span>
            {s.finviz_recom != null && <>
              <span style={{ color: '#78909c' }}>Finviz</span>
              <span>{s.finviz_recom} <span style={{ color: '#546e7a', fontSize: 10 }}>(1=강매수)</span></span>
            </>}
          </div>
        </div>
      )}
    </div>
  )
}

const GapCell = ({ target, price, baseColor, highlight }) => {
  const gap = fmtGap(target, price)
  return (
    <td style={{ ...TD, color: baseColor, background: highlight ? '#2d2a00' : undefined, border: highlight ? '2px solid #ffeb3b' : undefined, fontWeight: highlight ? 700 : undefined }}>
      {target != null ? <>{fmt(target)}{gap && <span style={{ color: gap.positive ? '#81c784' : '#ef9a9a' }}>({gap.text})</span>}</> : 'N/A'}
    </td>
  )
}

function RsiTable({ dailyRsi, weeklyRsi, monthlyRsi, price }) {
  if (!dailyRsi) return null
  const rows = [
    { label: '일봉', d: dailyRsi },
    { label: '주봉', d: weeklyRsi },
    { label: '월봉', d: monthlyRsi },
  ]
  const keys = ['target_20', 'target_25', 'target_30', 'target_70', 'target_75', 'target_80']
  let closestKey = null, minDiff = Infinity
  if (price && dailyRsi) {
    keys.forEach(k => {
      if (dailyRsi[k] == null) return
      const diff = Math.abs(dailyRsi[k] - price)
      if (diff < minDiff) { minDiff = diff; closestKey = k }
    })
  }
  return (
    <div style={{ marginBottom: 16, overflowX: 'auto', background: '#111', borderRadius: 6, padding: '10px 12px' }}>
      <div style={{ color: '#80cbc4', fontWeight: 700, fontSize: 12, marginBottom: 8 }}>🎯 RSI 예상 타점</div>
      <table style={{ borderCollapse: 'collapse', fontSize: 12, color: '#ccc' }}>
        <thead>
          <tr style={{ background: '#1a2a3a' }}>
            <th style={{ ...TH, textAlign: 'left', color: '#aaa' }}>시간대</th>
            <th style={{ ...TH, color: '#81c784' }}>RSI20</th>
            <th style={{ ...TH, color: '#81c784' }}>RSI25</th>
            <th style={{ ...TH, color: '#81c784' }}>RSI30</th>
            <th style={{ ...TH, color: '#aaa' }}>현재RSI</th>
            <th style={{ ...TH, color: '#ef9a9a' }}>RSI70</th>
            <th style={{ ...TH, color: '#ef9a9a' }}>RSI75</th>
            <th style={{ ...TH, color: '#ef9a9a' }}>RSI80</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ label, d }) => d?.rsi != null && (
            <tr key={label}>
              <td style={{ ...TD, textAlign: 'left', color: '#78909c', fontWeight: 600 }}>{label}</td>
              <GapCell target={d.target_20} price={price} baseColor="#81c784" highlight={closestKey === 'target_20'} />
              <GapCell target={d.target_25} price={price} baseColor="#81c784" highlight={closestKey === 'target_25'} />
              <GapCell target={d.target_30} price={price} baseColor="#81c784" highlight={closestKey === 'target_30'} />
              <td style={{ ...TD, color: rsiColor(d.rsi), fontWeight: 600 }}>{fmtN(d.rsi)}</td>
              <GapCell target={d.target_70} price={price} baseColor="#ef9a9a" highlight={closestKey === 'target_70'} />
              <GapCell target={d.target_75} price={price} baseColor="#ef9a9a" highlight={closestKey === 'target_75'} />
              <GapCell target={d.target_80} price={price} baseColor="#ef9a9a" highlight={closestKey === 'target_80'} />
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

const MetricCard = ({ label, value, sub, valueColor }) => (
  <div style={{ background: '#111827', border: '1px solid #1e2a3a', borderRadius: 6, padding: '8px 10px' }}>
    <div style={{ color: '#546e7a', fontSize: 11, marginBottom: 4 }}>{label}</div>
    <div style={{ fontWeight: 700, fontSize: 14, color: valueColor ?? '#ccc' }}>{value}</div>
    {sub && <div style={{ color: '#546e7a', fontSize: 10, marginTop: 2 }}>{sub}</div>}
  </div>
)

const SectionTitle = ({ children }) => (
  <div style={{ color: '#80cbc4', fontWeight: 700, fontSize: 12, letterSpacing: '0.3px', marginBottom: 10 }}>
    {children}
  </div>
)

function DetailSummaryTab({ summary }) {
  if (!summary) return null
  const { buy = 0, hold = 0, sell = 0 } = summary
  const total = buy + hold + sell
  const pct = (n) => total > 0 ? `${Math.round(n / total * 100)}%` : '—'
  const gap = summary.target_mean != null && summary.price != null
    ? ((summary.target_mean - summary.price) / summary.price * 100)
    : null

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>

      {/* 왼쪽: 증권사 컨센서스 */}
      <div style={{ background: '#111827', borderRadius: 6, padding: 14 }}>
        <SectionTitle>🏦 증권사 컨센서스</SectionTitle>
        {total > 0 && (
          <>
            <div style={{ display: 'flex', height: 8, borderRadius: 4, overflow: 'hidden', marginBottom: 5 }}>
              <div style={{ width: `${Math.round(buy / total * 100)}%`, background: 'linear-gradient(90deg,#1b5e20,#43a047)' }} />
              <div style={{ width: `${Math.round(hold / total * 100)}%`, background: '#424242' }} />
              <div style={{ width: `${Math.round(sell / total * 100)}%`, background: '#b71c1c' }} />
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: '#888', marginBottom: 12 }}>
              <span style={{ color: '#81c784' }}>🟢 Buy {buy} ({pct(buy)})</span>
              <span>⬜ Hold {hold} ({pct(hold)})</span>
              <span style={{ color: '#ef9a9a' }}>🔴 Sell {sell} ({pct(sell)})</span>
            </div>
          </>
        )}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
          <div style={{ background: '#0d1f0d', border: '1px solid #1e3a1e', borderRadius: 6, padding: '8px 10px', gridColumn: '1/-1' }}>
            <div style={{ color: '#546e7a', fontSize: 11, marginBottom: 4 }}>🎯 평균 목표가</div>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
              <span style={{ fontWeight: 700, fontSize: 18, color: '#fff' }}>{fmt(summary.target_mean)}</span>
              {gap != null && (
                <span style={{ fontSize: 12, color: gap >= 0 ? '#81c784' : '#ef9a9a' }}>
                  {gap >= 0 ? '+' : ''}{gap.toFixed(1)}% 상승 여력
                </span>
              )}
            </div>
          </div>
          <MetricCard label="🔼 최고 목표가" value={fmt(summary.target_high)} valueColor="#81c784" />
          <MetricCard label="🔽 최저 목표가" value={fmt(summary.target_low)} valueColor="#ef9a9a" />
          <MetricCard
            label="🌐 Finviz 추천지수"
            value={summary.finviz_recom ?? 'N/A'}
            sub="1=강매수, 5=강매도"
            valueColor={summary.finviz_recom != null && summary.finviz_recom <= 2 ? '#81c784' : '#ccc'}
          />
          <MetricCard label="👥 애널리스트 수" value={total > 0 ? `${total}명` : 'N/A'} />
        </div>
      </div>

      {/* 오른쪽: 밸류에이션 + 매물대·RSI 현황 */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div style={{ background: '#111827', borderRadius: 6, padding: 14 }}>
          <SectionTitle>📊 밸류에이션</SectionTitle>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 6 }}>
            <MetricCard label="📈 PER" value={summary.per != null ? summary.per.toFixed(1) : '—'} valueColor="#b0bec5" sub="Trailing" />
            <MetricCard label="🔭 Fwd PER" value={summary.forward_per != null ? summary.forward_per.toFixed(1) : '—'} valueColor="#78909c" sub="Forward" />
            <MetricCard label="📋 PBR" value={summary.pbr != null ? summary.pbr.toFixed(2) : '—'} valueColor="#78909c" sub="Price/Book" />
          </div>
        </div>
        <div style={{ background: '#111827', borderRadius: 6, padding: 14 }}>
          <SectionTitle>📉 매물대 &amp; RSI 현황</SectionTitle>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
            <div style={{ background: '#111827', border: '1px solid #1e2a3a', borderRadius: 6, padding: '8px 10px' }}>
              <div style={{ color: '#546e7a', fontSize: 11, marginBottom: 4 }}>🎯 POC</div>
              <div style={{ fontWeight: 700, fontSize: 14, color: '#80cbc4' }}>{fmt(summary.volume_profile?.poc)}</div>
              {summary.volume_profile?.hvn?.length > 0 && (
                <div style={{ color: '#81c784', fontSize: 10, marginTop: 3 }}>
                  🛡 HVN {summary.volume_profile.hvn.map(v => `$${Number(v).toFixed(2)}`).join(' / ')}
                </div>
              )}
            </div>
            <div style={{ background: '#111827', border: '1px solid #1e2a3a', borderRadius: 6, padding: '8px 10px' }}>
              <div style={{ color: '#546e7a', fontSize: 11, marginBottom: 6 }}>📈 RSI 현황</div>
              {[
                { label: '일봉', rsi: summary.daily_rsi?.rsi },
                { label: '주봉', rsi: summary.weekly_rsi?.rsi },
                { label: '월봉', rsi: summary.monthly_rsi?.rsi },
              ].map(({ label, rsi }) => (
                <div key={label} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, marginBottom: 2 }}>
                  <span style={{ color: '#546e7a' }}>{label}</span>
                  <span style={{ color: rsiColor(rsi), fontWeight: label === '일봉' ? 700 : 400 }}>
                    {rsi != null ? rsi.toFixed(1) : '—'}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

function VolumeProfileCards({ vp }) {
  if (!vp || vp.poc == null) return null
  const hvnStr = vp.hvn?.length ? vp.hvn.map(v => `$${Number(v).toFixed(2)}`).join(' / ') : '—'
  const lvnStr = vp.lvn?.length ? vp.lvn.map(v => `$${Number(v).toFixed(2)}`).join(' / ') : '—'
  return (
    <div style={{ marginBottom: 14, background: '#111', borderRadius: 6, padding: '10px 12px' }}>
      <div style={{ color: '#80cbc4', fontWeight: 700, fontSize: 12, letterSpacing: '0.3px', marginBottom: 10 }}>
        📊 매물대 분석 (Volume Profile, 1년 일봉)
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 8 }}>
        <div style={{ background: '#111827', border: '1px solid #1e2a3a', borderRadius: 6, padding: '8px 10px', textAlign: 'center' }}>
          <div style={{ color: '#546e7a', fontSize: 11, marginBottom: 4 }}>🎯 POC</div>
          <div style={{ fontWeight: 700, fontSize: 14, color: '#80cbc4' }}>{fmt(vp.poc)}</div>
        </div>
        <div style={{ background: '#111827', border: '1px solid #1e2a3a', borderRadius: 6, padding: '8px 10px', textAlign: 'center' }}>
          <div style={{ color: '#81c784', fontSize: 11, marginBottom: 4 }}>🛡 HVN (지지·저항)</div>
          <div style={{ color: '#81c784', fontSize: 11 }}>{hvnStr}</div>
        </div>
        <div style={{ background: '#111827', border: '1px solid #1e2a3a', borderRadius: 6, padding: '8px 10px', textAlign: 'center' }}>
          <div style={{ color: '#ffcc80', fontSize: 11, marginBottom: 4 }}>⬜ LVN (매물 공백)</div>
          <div style={{ color: '#ffcc80', fontSize: 11 }}>{lvnStr}</div>
        </div>
      </div>
    </div>
  )
}

export default function Reports() {
  const [reportList, setReportList] = useState({})
  const [selected, setSelected] = useState({ ticker: null, date: null })
  const [detail, setDetail] = useState({ content: '', summary: null })
  const [loading, setLoading] = useState(false)
  const [generating, setGenerating] = useState(null)
  const [genProgress, setGenProgress] = useState({ done: 0, total: 0 })
  const pollRef = useRef(null)
  const [activeTab, setActiveTab] = useState('holdings')
  const [watchlistSub, setWatchlistSub] = useState('low')
  const [view, setView] = useState('list')
  const [detailRefreshKey, setDetailRefreshKey] = useState(0)
  const [activeDetailTab, setActiveDetailTab] = useState('summary')

  const fetchList = useCallback(() => {
    axios.get('/api/report/list').then(({ data }) => setReportList(data))
  }, [])

  useEffect(() => { fetchList() }, [])

  useEffect(() => {
    if (!selected.ticker || !selected.date) return
    setLoading(true)
    axios.get(`/api/report/${selected.ticker}/${selected.date}`)
      .then(({ data }) => setDetail({ content: data.content, summary: data.summary }))
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

  const holdingsCount = Object.values(reportList).filter(v => v.category === 'holdings').length
  const watchlistAll = Object.entries(reportList).filter(([, v]) => v.category === 'watchlist')
  const watchlistLowCount = watchlistAll.filter(([, v]) => (v.summary?.daily_rsi?.rsi ?? 999) <= 45).length
  const watchlistHighCount = watchlistAll.filter(([, v]) => (v.summary?.daily_rsi?.rsi ?? -1) > 45).length
  const watchlistCount = watchlistAll.length

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
    .sort(([, a], [, b]) => {
      const rsiA = a.summary?.daily_rsi?.rsi ?? null
      const rsiB = b.summary?.daily_rsi?.rsi ?? null
      if (rsiA === null && rsiB === null) return 0
      if (rsiA === null) return 1
      if (rsiB === null) return -1
      return activeTab === 'holdings' ? rsiB - rsiA : rsiA - rsiB
    })
  const otherEntries = Object.entries(reportList).filter(([, v]) => v.category === 'other')

  const renderTickerItem = (ticker, info) => (
    <div key={ticker} style={{ marginBottom: 12 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
        <span style={{ color: '#80cbc4', fontWeight: 600, fontSize: 13 }}>{ticker}</span>
        <button
          onClick={() => generateOne(ticker)}
          disabled={!!generating}
          style={{ background: 'transparent', border: '1px solid #444', color: generating === ticker ? '#4fc3f7' : generating ? '#555' : '#aaa', borderRadius: 3, padding: '1px 6px', fontSize: 11, cursor: generating ? 'default' : 'pointer' }}
        >
          {generating === ticker ? `${genProgress.done}/${genProgress.total || '?'}` : '생성'}
        </button>
      </div>
      {generating === ticker && genProgress.total > 0 && (
        <div style={{ marginBottom: 4 }}>
          <div style={{ background: '#2a2a3a', borderRadius: 2, height: 3, overflow: 'hidden' }}>
            <div style={{ width: `${Math.round(genProgress.done / genProgress.total * 100)}%`, height: '100%', background: '#4fc3f7', transition: 'width 0.4s ease' }} />
          </div>
        </div>
      )}
      {info.dates.map(date => (
        <div
          key={date}
          onClick={() => openDetail(ticker, date)}
          style={{ padding: '3px 8px', cursor: 'pointer', borderRadius: 4, fontSize: 12, background: selected.ticker === ticker && selected.date === date && view === 'detail' ? '#1565c0' : 'transparent', color: selected.ticker === ticker && selected.date === date && view === 'detail' ? 'white' : '#aaa' }}
        >
          {date}
        </div>
      ))}
    </div>
  )

  return (
    <div style={{ display: 'flex', gap: 24, height: 'calc(100vh - 120px)' }}>
      {/* 좌측 사이드바 */}
      <div style={{ width: 210, overflowY: 'auto', borderRight: '1px solid #333', paddingRight: 16, flexShrink: 0 }}>
        <h3 style={{ color: '#90caf9', marginBottom: 8 }}>리포트 목록</h3>
        <div style={{ display: 'flex', borderBottom: '1px solid #333', marginBottom: activeTab === 'watchlist' ? 0 : 12 }}>
          <button style={TAB_STYLE(activeTab === 'holdings')} onClick={() => setActiveTab('holdings')}>보유 ({holdingsCount})</button>
          <button style={TAB_STYLE(activeTab === 'watchlist')} onClick={() => setActiveTab('watchlist')}>관심 ({watchlistCount})</button>
        </div>
        {activeTab === 'watchlist' && (
          <div style={{ display: 'flex', borderBottom: '1px solid #222', marginBottom: 12, marginTop: 4 }}>
            <button
              style={{ ...TAB_STYLE(watchlistSub === 'low'), fontSize: 11, padding: '4px 10px', color: watchlistSub === 'low' ? '#81c784' : '#666', borderBottom: watchlistSub === 'low' ? '2px solid #81c784' : '2px solid transparent' }}
              onClick={() => setWatchlistSub('low')}
            >RSI≤45 ({watchlistLowCount})</button>
            <button
              style={{ ...TAB_STYLE(watchlistSub === 'high'), fontSize: 11, padding: '4px 10px', color: watchlistSub === 'high' ? '#ef9a9a' : '#666', borderBottom: watchlistSub === 'high' ? '2px solid #ef9a9a' : '2px solid transparent' }}
              onClick={() => setWatchlistSub('high')}
            >RSI&gt;45 ({watchlistHighCount})</button>
          </div>
        )}
        {tabEntries.length === 0 && <p style={{ color: '#666', fontSize: 12 }}>리포트 없음</p>}
        {tabEntries.map(([t, info]) => renderTickerItem(t, info))}
        {otherEntries.length > 0 && (
          <>
            <div style={{ color: '#555', fontSize: 11, marginTop: 12, marginBottom: 6 }}>기타</div>
            {otherEntries.map(([t, info]) => renderTickerItem(t, info))}
          </>
        )}
      </div>

      {/* 우측 패널 */}
      <div style={{ flex: 1, overflowY: 'auto', overflowX: view === 'list' ? 'auto' : 'hidden' }}>
        {view === 'list' ? (
          /* 목록화면 */
          tabEntries.length === 0 ? (
            <div style={{ textAlign: 'center', marginTop: 80, color: '#666' }}>
              <p>리포트가 없습니다.</p>
              <p style={{ marginTop: 8, fontSize: 13 }}>설정 페이지에서 "지금 생성" 버튼을 눌러 첫 리포트를 만드세요.</p>
            </div>
          ) : (
            <table style={{ borderCollapse: 'collapse', color: '#ccc', width: '100%' }}>
              <thead>
                <tr style={{ background: '#1a2a3a', position: 'sticky', top: 0 }}>
                  <th style={{ ...TH, textAlign: 'left', position: 'sticky', left: 0, zIndex: 2, background: '#1a2a3a' }}>종목명 (티커)</th>
                  <th style={{ ...TH, textAlign: 'left' }}>섹터</th>
                  <th style={TH}>현재가</th>
                  <th style={TH}>POC</th>
                  <th style={TH}>평균목표가<br/><span style={{ color: '#546e7a', fontWeight: 400 }}>vs 현재가</span></th>
                  <th style={{ ...TH, color: '#81c784' }}>Buy</th>
                  <th style={TH}>Hold</th>
                  <th style={{ ...TH, color: '#ef9a9a' }}>Sell</th>
                  <th style={TH}>PER<br/><span style={{ color: '#546e7a', fontWeight: 400 }}>Fwd</span></th>
                  <th style={TH}>PBR</th>
                  <th style={TH}>Finviz</th>
                  <th style={{ ...TH, borderLeft: '1px solid #2a3a4a' }}>RSI<br/><span style={{ color: '#546e7a', fontWeight: 400 }}>일/주/월</span></th>
                  <th style={{ ...TH, color: '#81c784' }}>RSI20<br/><span style={{ color: '#546e7a', fontWeight: 400 }}>일/주/월</span></th>
                  <th style={{ ...TH, color: '#81c784' }}>RSI25<br/><span style={{ color: '#546e7a', fontWeight: 400 }}>일/주/월</span></th>
                  <th style={{ ...TH, color: '#81c784' }}>RSI30<br/><span style={{ color: '#546e7a', fontWeight: 400 }}>일/주/월</span></th>
                  <th style={{ ...TH, color: '#ef9a9a' }}>RSI70<br/><span style={{ color: '#546e7a', fontWeight: 400 }}>일/주/월</span></th>
                  <th style={{ ...TH, color: '#ef9a9a' }}>RSI75<br/><span style={{ color: '#546e7a', fontWeight: 400 }}>일/주/월</span></th>
                  <th style={{ ...TH, color: '#ef9a9a' }}>RSI80<br/><span style={{ color: '#546e7a', fontWeight: 400 }}>일/주/월</span></th>
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
                  return (
                    <tr
                      key={ticker}
                      onClick={() => openDetail(ticker, info.dates[0])}
                      style={{ cursor: 'pointer', borderBottom: '1px solid #222' }}
                      onMouseEnter={e => { e.currentTarget.style.background = '#1a2a3a'; e.currentTarget.querySelector('td').style.background = '#1a2a3a' }}
                      onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.querySelector('td').style.background = '#141414' }}
                    >
                      <td style={{ ...TD, textAlign: 'left', color: '#80cbc4', fontWeight: 600, position: 'sticky', left: 0, zIndex: 1, background: '#141414' }}>
                        {s?.name || ticker} <span style={{ color: '#666', fontWeight: 400 }}>({ticker})</span>
                      </td>
                      <td style={{ ...TD, textAlign: 'left', color: '#78909c', fontSize: 11 }}>
                        <div>{s?.sector || '—'}</div>
                        {s?.industry ? <div style={{ color: '#546e7a', fontSize: 10 }}>{s.industry}</div> : null}
                      </td>
                      <td style={TD}>{s ? fmt(s.price) : 'N/A'}</td>
                      <td style={TD}>{fmt(s?.volume_profile?.poc)}</td>
                      <td style={TD}>
                        <TargetTooltip s={s} />
                      </td>
                      {(() => {
                        const buy = s?.buy ?? 0, hold = s?.hold ?? 0, sell = s?.sell ?? 0
                        const total = buy + hold + sell
                        const pct = (n) => total > 0 ? `(${Math.round(n / total * 100)}%)` : ''
                        return (<>
                          <td style={{ ...TD, color: '#81c784' }}>{s ? `${buy}${pct(buy)}` : 'N/A'}</td>
                          <td style={TD}>{s ? `${hold}${pct(hold)}` : 'N/A'}</td>
                          <td style={{ ...TD, color: '#ef9a9a' }}>{s ? `${sell}${pct(sell)}` : 'N/A'}</td>
                        </>)
                      })()}
                      <td style={TD}>
                        {s?.per != null ? s.per.toFixed(1) : '—'}
                        {s?.forward_per != null && <div style={{ color: '#78909c', fontSize: 10 }}>{s.forward_per.toFixed(1)}</div>}
                      </td>
                      <td style={TD}>{s?.pbr != null ? s.pbr.toFixed(2) : '—'}</td>
                      <td style={TD}>{s ? fmtN(s.finviz_recom) : 'N/A'}</td>
                      <td style={{ ...TD, borderLeft: '1px solid #2a3a4a' }}>
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
                          <td key={key} style={{ ...TD, color: base, background: isClosest ? '#2d2a00' : undefined, border: isClosest ? '2px solid #ffeb3b' : undefined, fontWeight: isClosest ? 700 : undefined }}>
                            {dv != null ? <div>{fmt(dv)}{gapEl(dv)}</div> : <div>N/A</div>}
                            {wv != null && <div style={{ fontSize: 10, color: sub }}>{fmt(wv)}{gapEl(wv, 9)}</div>}
                            {mv != null && <div style={{ fontSize: 10, color: sub }}>{fmt(mv)}{gapEl(mv, 9)}</div>}
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
                style={{ background: 'transparent', border: '1px solid #444', color: '#aaa', borderRadius: 4, padding: '4px 12px', fontSize: 12, cursor: 'pointer', flexShrink: 0 }}
              >
                ← 목록으로
              </button>
              <div style={{ flex: 1 }}>
                <span style={{ color: '#90caf9', fontWeight: 700, fontSize: 16 }}>
                  {detail.summary?.name || selected.ticker}
                </span>
                <span style={{ color: '#666', fontSize: 14, marginLeft: 8 }}>({selected.ticker})</span>
                <span style={{ color: '#555', fontSize: 13, marginLeft: 12 }}>{selected.date}</span>
                {detail.summary?.price != null && (
                  <span style={{ color: '#e0e0e0', fontSize: 14, marginLeft: 12, fontWeight: 600 }}>{fmt(detail.summary.price)}</span>
                )}
                {detail.summary?.sector && (
                  <span style={{ color: '#4fc3f7', fontSize: 11, marginLeft: 12, background: '#0d2333', padding: '2px 7px', borderRadius: 3 }}>
                    {detail.summary.sector}{detail.summary.industry ? ` / ${detail.summary.industry}` : ''}
                  </span>
                )}
                {detail.summary?.per != null && (
                  <span style={{ color: '#b0bec5', fontSize: 11, marginLeft: 8, background: '#1a2a1a', padding: '2px 7px', borderRadius: 3 }}>
                    PER {detail.summary.per.toFixed(1)}
                    {detail.summary.forward_per != null && <span style={{ color: '#546e7a', marginLeft: 4 }}>/ Fwd {detail.summary.forward_per.toFixed(1)}</span>}
                  </span>
                )}
                {detail.summary?.pbr != null && (
                  <span style={{ color: '#b0bec5', fontSize: 11, marginLeft: 4, background: '#1a2a1a', padding: '2px 7px', borderRadius: 3 }}>
                    PBR {detail.summary.pbr.toFixed(2)}
                  </span>
                )}
              </div>
              <button
                onClick={() => generateOne(selected.ticker)}
                disabled={!!generating}
                style={{
                  background: 'transparent',
                  border: '1px solid #444',
                  color: generating === selected.ticker ? '#4fc3f7' : generating ? '#555' : '#aaa',
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
            <div style={{ display: 'flex', borderBottom: '1px solid #2a3a4a', marginBottom: 16, marginTop: 4 }}>
              {[
                { key: 'summary', label: '📊 요약' },
                { key: 'technical', label: '📈 기술적 분석' },
                { key: 'report', label: '📄 리포트' },
              ].map(({ key, label }) => (
                <button
                  key={key}
                  onClick={() => setActiveDetailTab(key)}
                  style={{
                    background: 'transparent',
                    border: 'none',
                    borderBottom: activeDetailTab === key ? '2px solid #4fc3f7' : '2px solid transparent',
                    color: activeDetailTab === key ? '#4fc3f7' : '#555',
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

            {loading && <p style={{ color: '#aaa' }}>로딩 중...</p>}
            {!loading && activeDetailTab === 'summary' && (
              detail.summary
                ? <DetailSummaryTab summary={detail.summary} />
                : <p style={{ color: '#666', fontSize: 13 }}>요약 데이터가 없습니다.</p>
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
                    />
                    <VolumeProfileCards vp={detail.summary.volume_profile} />
                  </>
                )
                : <p style={{ color: '#666', fontSize: 13 }}>기술적 분석 데이터가 없습니다.</p>
            )}
            {!loading && activeDetailTab === 'report' && (
              detail.content
                ? <MarkdownViewer content={detail.content} ticker={selected.ticker} />
                : <p style={{ color: '#666', fontSize: 13 }}>리포트 파일이 없습니다.</p>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

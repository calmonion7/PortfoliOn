import { useState, useEffect, useCallback } from 'react'
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

const GapCell = ({ target, price, baseColor }) => {
  const gap = fmtGap(target, price)
  return (
    <td style={{ ...TD, color: baseColor }}>
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
  return (
    <div style={{ marginBottom: 16, overflowX: 'auto', background: '#111', borderRadius: 6, padding: '10px 12px' }}>
      <div style={{ color: '#80cbc4', fontWeight: 600, fontSize: 12, marginBottom: 8 }}>RSI 예상 타점</div>
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
              <GapCell target={d.target_20} price={price} baseColor="#81c784" />
              <GapCell target={d.target_25} price={price} baseColor="#81c784" />
              <GapCell target={d.target_30} price={price} baseColor="#81c784" />
              <td style={{ ...TD, color: rsiColor(d.rsi), fontWeight: 600 }}>{fmtN(d.rsi)}</td>
              <GapCell target={d.target_70} price={price} baseColor="#ef9a9a" />
              <GapCell target={d.target_75} price={price} baseColor="#ef9a9a" />
              <GapCell target={d.target_80} price={price} baseColor="#ef9a9a" />
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function VolumeProfileTable({ vp }) {
  if (!vp || vp.poc == null) return null
  const hvnStr = vp.hvn?.length ? vp.hvn.map(v => `$${Number(v).toFixed(2)}`).join(' / ') : 'N/A'
  const lvnStr = vp.lvn?.length ? vp.lvn.map(v => `$${Number(v).toFixed(2)}`).join(' / ') : 'N/A'
  return (
    <div style={{ marginBottom: 16, overflowX: 'auto', background: '#111', borderRadius: 6, padding: '10px 12px' }}>
      <div style={{ color: '#80cbc4', fontWeight: 600, fontSize: 12, marginBottom: 8 }}>매물대 분석 (Volume Profile, 1년 일봉)</div>
      <table style={{ borderCollapse: 'collapse', fontSize: 12, color: '#ccc' }}>
        <thead>
          <tr style={{ background: '#1a2a3a' }}>
            <th style={TH}>POC</th>
            <th style={{ ...TH, color: '#81c784' }}>HVN (지지·저항)</th>
            <th style={{ ...TH, color: '#ffcc80' }}>LVN (매물 공백)</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td style={{ ...TD, fontWeight: 600 }}>{fmt(vp.poc)}</td>
            <td style={{ ...TD, color: '#81c784' }}>{hvnStr}</td>
            <td style={{ ...TD, color: '#ffcc80' }}>{lvnStr}</td>
          </tr>
        </tbody>
      </table>
    </div>
  )
}

export default function Reports() {
  const [reportList, setReportList] = useState({})
  const [selected, setSelected] = useState({ ticker: null, date: null })
  const [detail, setDetail] = useState({ content: '', summary: null })
  const [loading, setLoading] = useState(false)
  const [generating, setGenerating] = useState(null)
  const [activeTab, setActiveTab] = useState('holdings')
  const [watchlistSub, setWatchlistSub] = useState('low')
  const [view, setView] = useState('list')
  const [detailRefreshKey, setDetailRefreshKey] = useState(0)

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
  }

  const generateOne = async (ticker) => {
    setGenerating(ticker)
    try {
      await axios.post(`/api/report/generate/${ticker}`)
      setTimeout(() => {
        fetchList()
        setGenerating(null)
        if (view === 'detail' && selected.ticker === ticker) {
          setDetailRefreshKey(k => k + 1)
        }
      }, 3000)
    } catch {
      setGenerating(null)
    }
  }

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
          disabled={generating === ticker}
          style={{ background: 'transparent', border: '1px solid #444', color: generating === ticker ? '#666' : '#aaa', borderRadius: 3, padding: '1px 6px', fontSize: 11, cursor: generating === ticker ? 'default' : 'pointer' }}
        >
          {generating === ticker ? '생성중' : '생성'}
        </button>
      </div>
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
                  <th style={TH}>평균목표가<br/><span style={{ color: '#546e7a', fontWeight: 400 }}>(-12%)</span></th>
                  <th style={{ ...TH, color: '#81c784' }}>Buy</th>
                  <th style={TH}>Hold</th>
                  <th style={{ ...TH, color: '#ef9a9a' }}>Sell</th>
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
                        {s?.sector || '—'}{s?.industry ? <span style={{ color: '#546e7a', marginLeft: 4 }}>/ {s.industry}</span> : null}
                      </td>
                      <td style={TD}>{s ? fmt(s.price) : 'N/A'}</td>
                      <td style={TD}>{fmt(s?.volume_profile?.poc)}</td>
                      <td style={TD}>
                        {s ? fmt(s.target_mean) : 'N/A'}
                        {s?.target_mean != null && <div style={{ color: '#78909c', fontSize: 10 }}>{fmt(s.target_mean * 0.88)}</div>}
                      </td>
                      <td style={{ ...TD, color: '#81c784' }}>{s ? fmtN(s.buy) : 'N/A'}</td>
                      <td style={TD}>{s ? fmtN(s.hold) : 'N/A'}</td>
                      <td style={{ ...TD, color: '#ef9a9a' }}>{s ? fmtN(s.sell) : 'N/A'}</td>
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
                        return (
                          <td key={key} style={{ ...TD, color: base }}>
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
              <div>
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
              </div>
            </div>
            {loading && <p style={{ color: '#aaa' }}>로딩 중...</p>}
            {!loading && detail.summary?.daily_rsi && <RsiTable dailyRsi={detail.summary.daily_rsi} weeklyRsi={detail.summary.weekly_rsi} monthlyRsi={detail.summary.monthly_rsi} price={detail.summary.price} />}
            {!loading && detail.summary?.volume_profile && <VolumeProfileTable vp={detail.summary.volume_profile} />}
            {!loading && detail.content && <MarkdownViewer content={detail.content} ticker={selected.ticker} />}
          </div>
        )}
      </div>
    </div>
  )
}

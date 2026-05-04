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

function RsiTable({ dailyRsi }) {
  if (!dailyRsi) return null
  return (
    <div style={{ marginBottom: 16, overflowX: 'auto', background: '#111', borderRadius: 6, padding: '10px 12px' }}>
      <div style={{ color: '#80cbc4', fontWeight: 600, fontSize: 12, marginBottom: 8 }}>RSI 예상 타점 (일봉)</div>
      <table style={{ borderCollapse: 'collapse', fontSize: 12, color: '#ccc' }}>
        <thead>
          <tr style={{ background: '#1a2a3a' }}>
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
          <tr>
            <td style={{ ...TD, color: '#81c784' }}>{fmt(dailyRsi.target_20)}</td>
            <td style={{ ...TD, color: '#81c784' }}>{fmt(dailyRsi.target_25)}</td>
            <td style={{ ...TD, color: '#81c784' }}>{fmt(dailyRsi.target_30)}</td>
            <td style={TD}>{fmtN(dailyRsi.rsi)}</td>
            <td style={{ ...TD, color: '#ef9a9a' }}>{fmt(dailyRsi.target_70)}</td>
            <td style={{ ...TD, color: '#ef9a9a' }}>{fmt(dailyRsi.target_75)}</td>
            <td style={{ ...TD, color: '#ef9a9a' }}>{fmt(dailyRsi.target_80)}</td>
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
  const [view, setView] = useState('list')

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
  }, [selected])

  const openDetail = (ticker, date) => {
    setSelected({ ticker, date })
    setView('detail')
  }

  const generateOne = async (ticker) => {
    setGenerating(ticker)
    try {
      await axios.post(`/api/report/generate/${ticker}`)
      setTimeout(() => { fetchList(); setGenerating(null) }, 2000)
    } catch {
      setGenerating(null)
    }
  }

  const holdingsCount = Object.values(reportList).filter(v => v.category === 'holdings').length
  const watchlistCount = Object.values(reportList).filter(v => v.category === 'watchlist').length
  const tabEntries = Object.entries(reportList)
    .filter(([, v]) => v.category === activeTab)
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
        <div style={{ display: 'flex', borderBottom: '1px solid #333', marginBottom: 12 }}>
          <button style={TAB_STYLE(activeTab === 'holdings')} onClick={() => setActiveTab('holdings')}>보유 ({holdingsCount})</button>
          <button style={TAB_STYLE(activeTab === 'watchlist')} onClick={() => setActiveTab('watchlist')}>관심 ({watchlistCount})</button>
        </div>
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
                  <th style={{ ...TH, textAlign: 'left' }}>종목명 (티커)</th>
                  <th style={TH}>현재가</th>
                  <th style={TH}>평균목표가</th>
                  <th style={{ ...TH, color: '#81c784' }}>Buy</th>
                  <th style={TH}>Hold</th>
                  <th style={{ ...TH, color: '#ef9a9a' }}>Sell</th>
                  <th style={TH}>Finviz</th>
                  <th style={TH}>현재RSI</th>
                  <th style={{ ...TH, color: '#81c784' }}>RSI20</th>
                  <th style={{ ...TH, color: '#81c784' }}>RSI25</th>
                  <th style={{ ...TH, color: '#81c784' }}>RSI30</th>
                  <th style={{ ...TH, color: '#ef9a9a' }}>RSI70</th>
                  <th style={{ ...TH, color: '#ef9a9a' }}>RSI75</th>
                  <th style={{ ...TH, color: '#ef9a9a' }}>RSI80</th>
                </tr>
              </thead>
              <tbody>
                {tabEntries.map(([ticker, info]) => {
                  const s = info.summary
                  const dr = s?.daily_rsi
                  return (
                    <tr
                      key={ticker}
                      onClick={() => openDetail(ticker, info.dates[0])}
                      style={{ cursor: 'pointer', borderBottom: '1px solid #222' }}
                      onMouseEnter={e => e.currentTarget.style.background = '#1a2a3a'}
                      onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                    >
                      <td style={{ ...TD, textAlign: 'left', color: '#80cbc4', fontWeight: 600 }}>
                        {s?.name || ticker} <span style={{ color: '#666', fontWeight: 400 }}>({ticker})</span>
                      </td>
                      <td style={TD}>{s ? fmt(s.price) : 'N/A'}</td>
                      <td style={TD}>{s ? fmt(s.target_mean) : 'N/A'}</td>
                      <td style={{ ...TD, color: '#81c784' }}>{s ? fmtN(s.buy) : 'N/A'}</td>
                      <td style={TD}>{s ? fmtN(s.hold) : 'N/A'}</td>
                      <td style={{ ...TD, color: '#ef9a9a' }}>{s ? fmtN(s.sell) : 'N/A'}</td>
                      <td style={TD}>{s ? fmtN(s.finviz_recom) : 'N/A'}</td>
                      <td style={{ ...TD, color: rsiColor(dr?.rsi), fontWeight: 600 }}>{dr ? fmtN(dr.rsi) : 'N/A'}</td>
                      <td style={{ ...TD, color: '#81c784' }}>{dr ? fmt(dr.target_20) : 'N/A'}</td>
                      <td style={{ ...TD, color: '#81c784' }}>{dr ? fmt(dr.target_25) : 'N/A'}</td>
                      <td style={{ ...TD, color: '#81c784' }}>{dr ? fmt(dr.target_30) : 'N/A'}</td>
                      <td style={{ ...TD, color: '#ef9a9a' }}>{dr ? fmt(dr.target_70) : 'N/A'}</td>
                      <td style={{ ...TD, color: '#ef9a9a' }}>{dr ? fmt(dr.target_75) : 'N/A'}</td>
                      <td style={{ ...TD, color: '#ef9a9a' }}>{dr ? fmt(dr.target_80) : 'N/A'}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )
        ) : (
          /* 상세화면 */
          <div>
            <button
              onClick={() => setView('list')}
              style={{ background: 'transparent', border: '1px solid #444', color: '#aaa', borderRadius: 4, padding: '4px 12px', fontSize: 12, cursor: 'pointer', marginBottom: 16 }}
            >
              ← 목록으로
            </button>
            {loading && <p style={{ color: '#aaa' }}>로딩 중...</p>}
            {!loading && detail.summary?.daily_rsi && <RsiTable dailyRsi={detail.summary.daily_rsi} />}
            {!loading && detail.content && <MarkdownViewer content={detail.content} ticker={selected.ticker} />}
          </div>
        )}
      </div>
    </div>
  )
}

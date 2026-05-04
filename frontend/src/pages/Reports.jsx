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

export default function Reports() {
  const [reportList, setReportList] = useState({})
  const [selected, setSelected] = useState({ ticker: null, date: null })
  const [content, setContent] = useState('')
  const [loading, setLoading] = useState(false)
  const [generating, setGenerating] = useState(null)
  const [activeTab, setActiveTab] = useState('holdings')

  const fetchList = useCallback(() => {
    axios.get('/api/report/list').then(({ data }) => {
      setReportList(data)
      if (!selected.ticker) {
        const entries = Object.entries(data).filter(([, v]) => v.category === 'holdings')
        if (entries.length > 0) {
          setSelected({ ticker: entries[0][0], date: entries[0][1].dates[0] })
        }
      }
    })
  }, [selected.ticker])

  useEffect(() => { fetchList() }, [])

  useEffect(() => {
    if (!selected.ticker || !selected.date) return
    setLoading(true)
    axios.get(`/api/report/${selected.ticker}/${selected.date}`)
      .then(({ data }) => setContent(data.content))
      .finally(() => setLoading(false))
  }, [selected])

  const generateOne = async (ticker) => {
    setGenerating(ticker)
    try {
      await axios.post(`/api/report/generate/${ticker}`)
      setTimeout(() => { fetchList(); setGenerating(null) }, 2000)
    } catch {
      setGenerating(null)
    }
  }

  const tabTickers = Object.entries(reportList).filter(([, v]) => v.category === activeTab)
  const otherTickers = Object.entries(reportList).filter(([, v]) => v.category === 'other')

  const holdingsCount = Object.values(reportList).filter(v => v.category === 'holdings').length
  const watchlistCount = Object.values(reportList).filter(v => v.category === 'watchlist').length

  const renderTickerList = (entries) => entries.map(([ticker, info]) => (
    <div key={ticker} style={{ marginBottom: 12 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
        <span style={{ color: '#80cbc4', fontWeight: 600, fontSize: 13 }}>{ticker}</span>
        <button
          onClick={() => generateOne(ticker)}
          disabled={generating === ticker}
          style={{
            background: 'transparent',
            border: '1px solid #444',
            color: generating === ticker ? '#666' : '#aaa',
            borderRadius: 3,
            padding: '1px 6px',
            fontSize: 11,
            cursor: generating === ticker ? 'default' : 'pointer',
          }}
        >
          {generating === ticker ? '생성중' : '생성'}
        </button>
      </div>
      {info.dates.map(date => (
        <div
          key={date}
          onClick={() => setSelected({ ticker, date })}
          style={{
            padding: '3px 8px',
            cursor: 'pointer',
            borderRadius: 4,
            fontSize: 12,
            background: selected.ticker === ticker && selected.date === date ? '#1565c0' : 'transparent',
            color: selected.ticker === ticker && selected.date === date ? 'white' : '#aaa',
          }}
        >
          {date}
        </div>
      ))}
    </div>
  ))

  return (
    <div style={{ display: 'flex', gap: 24, height: 'calc(100vh - 120px)' }}>
      <div style={{ width: 210, overflowY: 'auto', borderRight: '1px solid #333', paddingRight: 16 }}>
        <h3 style={{ color: '#90caf9', marginBottom: 8 }}>리포트 목록</h3>

        <div style={{ display: 'flex', borderBottom: '1px solid #333', marginBottom: 12 }}>
          <button style={TAB_STYLE(activeTab === 'holdings')} onClick={() => setActiveTab('holdings')}>
            보유 ({holdingsCount})
          </button>
          <button style={TAB_STYLE(activeTab === 'watchlist')} onClick={() => setActiveTab('watchlist')}>
            관심 ({watchlistCount})
          </button>
        </div>

        {tabTickers.length === 0 && (
          <p style={{ color: '#666', fontSize: 12 }}>리포트 없음</p>
        )}
        {renderTickerList(tabTickers)}

        {otherTickers.length > 0 && (
          <>
            <div style={{ color: '#555', fontSize: 11, marginTop: 12, marginBottom: 6 }}>기타</div>
            {renderTickerList(otherTickers)}
          </>
        )}
      </div>

      <div style={{ flex: 1, overflowY: 'auto' }}>
        {loading && <p style={{ color: '#aaa' }}>로딩 중...</p>}
        {!loading && content && <MarkdownViewer content={content} ticker={selected.ticker} />}
        {!loading && !content && Object.keys(reportList).length === 0 && (
          <div style={{ textAlign: 'center', marginTop: 80, color: '#666' }}>
            <p>리포트가 없습니다.</p>
            <p style={{ marginTop: 8, fontSize: 13 }}>설정 페이지에서 "지금 생성" 버튼을 눌러 첫 리포트를 만드세요.</p>
          </div>
        )}
      </div>
    </div>
  )
}

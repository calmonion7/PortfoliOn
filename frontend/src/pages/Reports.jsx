import { useState, useEffect } from 'react'
import axios from 'axios'
import MarkdownViewer from '../components/MarkdownViewer'

export default function Reports() {
  const [reportList, setReportList] = useState({})
  const [selected, setSelected] = useState({ ticker: null, date: null })
  const [content, setContent] = useState('')
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    axios.get('/api/report/list').then(({ data }) => {
      setReportList(data)
      const tickers = Object.keys(data)
      if (tickers.length > 0) {
        const ticker = tickers[0]
        const date = data[ticker][0]
        setSelected({ ticker, date })
      }
    })
  }, [])

  useEffect(() => {
    if (!selected.ticker || !selected.date) return
    setLoading(true)
    axios.get(`/api/report/${selected.ticker}/${selected.date}`)
      .then(({ data }) => setContent(data.content))
      .finally(() => setLoading(false))
  }, [selected])

  const tickers = Object.keys(reportList)

  return (
    <div style={{ display: 'flex', gap: 24, height: 'calc(100vh - 120px)' }}>
      <div style={{ width: 200, overflowY: 'auto', borderRight: '1px solid #333', paddingRight: 16 }}>
        <h3 style={{ color: '#90caf9', marginBottom: 12 }}>리포트 목록</h3>
        {tickers.length === 0 && <p style={{ color: '#666', fontSize: 13 }}>리포트 없음</p>}
        {tickers.map(ticker => (
          <div key={ticker} style={{ marginBottom: 16 }}>
            <div style={{ color: '#80cbc4', fontWeight: 600, marginBottom: 4 }}>{ticker}</div>
            {reportList[ticker].map(date => (
              <div
                key={date}
                onClick={() => setSelected({ ticker, date })}
                style={{
                  padding: '4px 8px',
                  cursor: 'pointer',
                  borderRadius: 4,
                  fontSize: 13,
                  background: selected.ticker === ticker && selected.date === date ? '#1565c0' : 'transparent',
                  color: selected.ticker === ticker && selected.date === date ? 'white' : '#aaa',
                }}
              >
                {date}
              </div>
            ))}
          </div>
        ))}
      </div>

      <div style={{ flex: 1, overflowY: 'auto' }}>
        {loading && <p style={{ color: '#aaa' }}>로딩 중...</p>}
        {!loading && content && <MarkdownViewer content={content} ticker={selected.ticker} />}
        {!loading && !content && tickers.length === 0 && (
          <div style={{ textAlign: 'center', marginTop: 80, color: '#666' }}>
            <p>리포트가 없습니다.</p>
            <p style={{ marginTop: 8, fontSize: 13 }}>설정 페이지에서 "지금 생성" 버튼을 눌러 첫 리포트를 만드세요.</p>
          </div>
        )}
      </div>
    </div>
  )
}

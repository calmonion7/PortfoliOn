import { useState, useEffect, useRef } from 'react'
import api from '../api'
import { useAuth } from '../contexts/AuthContext'

export default function GuruCrawlNow() {
  const { role } = useAuth() || { role: 'user' }
  const [crawling, setCrawling]   = useState(false)
  const [crawlMsg, setCrawlMsg]   = useState('')
  const [progress, setProgress]   = useState({ done: 0, total: 0, current: '' })
  const [lastUpdated, setLastUpdated] = useState(null)
  const pollRef = useRef(null)

  useEffect(() => {
    api.get('/api/guru/managers').then(({ data }) => setLastUpdated(data.last_updated))
  }, [])

  const startPolling = () => {
    pollRef.current = setInterval(async () => {
      try {
        const { data } = await api.get('/api/guru/crawl/progress')
        setProgress({ done: data.done, total: data.total, current: data.current })
        if (!data.running && data.total > 0 && data.done >= data.total) {
          clearInterval(pollRef.current)
          setCrawling(false)
          setCrawlMsg(`완료: ${data.done}명 매니저 데이터 수집됨`)
          api.get('/api/guru/managers').then(({ data }) => setLastUpdated(data.last_updated))
        }
      } catch {}
    }, 2000)
  }

  const handleCrawlNow = async () => {
    setCrawling(true)
    setCrawlMsg('')
    setProgress({ done: 0, total: 0, current: '' })
    try {
      await api.post('/api/guru/crawl')
      startPolling()
    } catch (err) {
      setCrawlMsg(err.response?.data?.detail || '크롤링 실패')
      setCrawling(false)
    }
  }

  useEffect(() => () => clearInterval(pollRef.current), [])

  const pct = progress.total > 0 ? Math.round(progress.done / progress.total * 100) : 0

  return (
    <div style={{ maxWidth: 480 }}>
      <div className="s-group-h" style={{ paddingLeft: 0, paddingRight: 0, paddingTop: 8 }}>즉시 크롤링</div>
      <div className="list-card" style={{ margin: '0 0 6px' }}>
        <div style={{ padding: '14px 16px' }}>
          <p style={{ color: 'var(--text-3)', fontSize: 13, margin: '0 0 4px', lineHeight: 1.6 }}>
            dataroma 전체 매니저 데이터를 지금 수집합니다. 수 분 소요됩니다.
          </p>
          {lastUpdated && (
            <p style={{ color: 'var(--text-faint)', fontSize: 12, margin: '0 0 14px', lineHeight: 1.5 }}>
              마지막 갱신: {lastUpdated}
            </p>
          )}
          {role === 'admin' && (
            <button className="btn btn-primary" onClick={handleCrawlNow} disabled={crawling}
              style={{ width: '100%', justifyContent: 'center', marginTop: lastUpdated ? 0 : 14 }}>
              {crawling ? '수집 중...' : '지금 갱신'}
            </button>
          )}
          {crawling && (
            <div style={{ marginTop: 14 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: 'var(--text-3)', marginBottom: 8 }}>
                <span>{progress.current ? `수집 중: ${progress.current}` : '준비 중...'}</span>
                <span style={{ color: 'var(--text)', fontWeight: 600 }}>
                  {progress.done} / {progress.total || '?'}
                </span>
              </div>
              <div style={{ background: 'var(--accent-soft)', borderRadius: 999, height: 4, overflow: 'hidden' }}>
                <div style={{ width: `${pct}%`, height: '100%', background: 'var(--text)', borderRadius: 999, transition: 'width 0.4s ease' }} />
              </div>
            </div>
          )}
          {crawlMsg && <p style={{ marginTop: 8, color: 'var(--up)', fontSize: 13 }}>{crawlMsg}</p>}
        </div>
      </div>
    </div>
  )
}

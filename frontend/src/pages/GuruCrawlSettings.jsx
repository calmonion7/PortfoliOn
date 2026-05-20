import { useState, useEffect, useRef } from 'react'
import axios from 'axios'

const DAYS = [
  { key: 'mon', label: '월' }, { key: 'tue', label: '화' },
  { key: 'wed', label: '수' }, { key: 'thu', label: '목' },
  { key: 'fri', label: '금' }, { key: 'sat', label: '토' },
  { key: 'sun', label: '일' },
]

export default function GuruCrawlSettings() {
  const [schedule, setSchedule]   = useState({ enabled: false, day: 'sun', time: '03:00' })
  const [saved, setSaved]         = useState(false)
  const [crawling, setCrawling]   = useState(false)
  const [crawlMsg, setCrawlMsg]   = useState('')
  const [progress, setProgress]   = useState({ done: 0, total: 0, current: '' })
  const [lastUpdated, setLastUpdated] = useState(null)
  const pollRef = useRef(null)

  useEffect(() => {
    axios.get('/api/guru/schedule').then(({ data }) => setSchedule(data))
    axios.get('/api/guru/managers').then(({ data }) => setLastUpdated(data.last_updated))
  }, [])

  const startPolling = () => {
    pollRef.current = setInterval(async () => {
      try {
        const { data } = await axios.get('/api/guru/crawl/progress')
        setProgress({ done: data.done, total: data.total, current: data.current })
        if (!data.running && data.total > 0 && data.done >= data.total) {
          clearInterval(pollRef.current)
          setCrawling(false)
          setCrawlMsg(`완료: ${data.done}명 매니저 데이터 수집됨`)
          axios.get('/api/guru/managers').then(({ data }) => setLastUpdated(data.last_updated))
        }
      } catch {}
    }, 2000)
  }

  const handleCrawlNow = async () => {
    setCrawling(true)
    setCrawlMsg('')
    setProgress({ done: 0, total: 0, current: '' })
    try {
      await axios.post('/api/guru/crawl')
      startPolling()
    } catch (err) {
      setCrawlMsg(err.response?.data?.detail || '크롤링 실패')
      setCrawling(false)
    }
  }

  const handleSave = async () => {
    await axios.put('/api/guru/schedule', schedule)
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  useEffect(() => () => clearInterval(pollRef.current), [])

  const pct = progress.total > 0 ? Math.round(progress.done / progress.total * 100) : 0

  return (
    <div style={{ maxWidth: 480 }}>

      {/* 즉시 크롤링 */}
      <section style={{ background: 'var(--bg-surface)', padding: 20, borderRadius: 8, marginBottom: 20 }}>
        <h2 style={{ color: 'var(--text-heading)', marginBottom: 8, fontSize: 14 }}>즉시 크롤링</h2>
        <p style={{ color: 'var(--text-muted)', fontSize: 13, marginBottom: 12 }}>
          dataroma 전체 매니저 데이터를 지금 수집합니다. 수 분 소요됩니다.
        </p>
        {lastUpdated && (
          <p style={{ color: 'var(--text-muted)', fontSize: 12, marginBottom: 10 }}>마지막 갱신: {lastUpdated}</p>
        )}
        <button className="btn-primary" onClick={handleCrawlNow} disabled={crawling}>
          {crawling ? '수집 중...' : '지금 갱신'}
        </button>
        {crawling && (
          <div style={{ marginTop: 14 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, color: 'var(--text-muted)', marginBottom: 6 }}>
              <span>{progress.current ? `수집 중: ${progress.current}` : '준비 중...'}</span>
              <span style={{ color: 'var(--accent)', fontWeight: 600 }}>
                {progress.done} / {progress.total || '?'}
              </span>
            </div>
            <div style={{ background: 'var(--bg-hover)', borderRadius: 4, height: 8, overflow: 'hidden' }}>
              <div style={{ width: `${pct}%`, height: '100%', background: 'var(--accent)', borderRadius: 4, transition: 'width 0.4s ease' }} />
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4, textAlign: 'right' }}>{pct}%</div>
          </div>
        )}
        {crawlMsg && <p style={{ marginTop: 8, color: 'var(--positive)', fontSize: 13 }}>{crawlMsg}</p>}
      </section>

      {/* 자동 스케줄 */}
      <section style={{ background: 'var(--bg-surface)', padding: 20, borderRadius: 8 }}>
        <h2 style={{ color: 'var(--text-heading)', marginBottom: 16, fontSize: 14 }}>자동 갱신 스케줄</h2>
        <div className="form-field" style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <label style={{ marginBottom: 0, width: 'auto' }}>자동 갱신</label>
          <input type="checkbox" checked={schedule.enabled}
            onChange={e => setSchedule(s => ({ ...s, enabled: e.target.checked }))}
            style={{ width: 'auto' }} />
        </div>
        <div className="form-field">
          <label style={{ marginBottom: 8 }}>요일 (주 1회)</label>
          <div style={{ display: 'flex', gap: 8 }}>
            {DAYS.map(({ key, label }) => (
              <button key={key} type="button"
                onClick={() => setSchedule(s => ({ ...s, day: key }))}
                disabled={!schedule.enabled}
                style={{
                  padding: '4px 8px', borderRadius: 4, border: 'none',
                  cursor: schedule.enabled ? 'pointer' : 'default',
                  background: schedule.day === key ? 'var(--accent-btn)' : 'var(--bg-hover)',
                  color: schedule.day === key ? 'white' : 'var(--text-muted)',
                  opacity: schedule.enabled ? 1 : 0.5, fontSize: 13,
                }}>
                {label}
              </button>
            ))}
          </div>
        </div>
        <div className="form-field">
          <label>실행 시간</label>
          <input type="time" value={schedule.time}
            onChange={e => setSchedule(s => ({ ...s, time: e.target.value }))}
            disabled={!schedule.enabled} />
        </div>
        <button className="btn-primary" onClick={handleSave}>{saved ? '저장됨' : '저장'}</button>
      </section>

    </div>
  )
}

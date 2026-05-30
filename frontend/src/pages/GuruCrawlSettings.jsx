import { useState, useEffect, useRef } from 'react'
import api from '../api'

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
    api.get('/api/guru/schedule').then(({ data }) => setSchedule(data))
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

  const [saveErr, setSaveErr] = useState('')

  const handleSave = async () => {
    setSaveErr('')
    try {
      await api.put('/api/guru/schedule', schedule)
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    } catch (err) {
      setSaveErr(err?.response?.data?.detail || '저장에 실패했습니다.')
    }
  }

  useEffect(() => () => clearInterval(pollRef.current), [])

  const pct = progress.total > 0 ? Math.round(progress.done / progress.total * 100) : 0

  return (
    <div style={{ maxWidth: 480 }}>

      {/* 즉시 크롤링 */}
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
          <button className="btn btn-primary" onClick={handleCrawlNow} disabled={crawling}
            style={{ width: '100%', justifyContent: 'center', marginTop: lastUpdated ? 0 : 14 }}>
            {crawling ? '수집 중...' : '지금 갱신'}
          </button>
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

      {/* 자동 갱신 스케줄 */}
      <div className="s-group-h" style={{ paddingLeft: 0, paddingRight: 0 }}>자동 갱신 스케줄</div>
      <div className="list-card" style={{ margin: '0 0 6px' }}>
        <div className="s-row">
          <div className="title">자동 갱신</div>
          <button
            className={`m-switch ${schedule.enabled ? 'on' : ''}`}
            onClick={() => setSchedule(s => ({ ...s, enabled: !s.enabled }))}
          />
        </div>
        <div style={{ padding: '14px 16px', borderTop: '1px solid var(--border)', opacity: schedule.enabled ? 1 : 0.4 }}>
          <div style={{ fontSize: 11, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 500, marginBottom: 10 }}>요일 (주 1회)</div>
          <div style={{ display: 'flex', gap: 6 }}>
            {DAYS.map(({ key, label }) => (
              <button key={key} type="button"
                onClick={() => schedule.enabled && setSchedule(s => ({ ...s, day: key }))}
                style={{
                  flex: 1, height: 36, borderRadius: '50%', border: 'none',
                  background: schedule.day === key ? 'var(--text)' : 'var(--accent-soft)',
                  color: schedule.day === key ? 'var(--bg)' : 'var(--text-3)',
                  fontSize: 13, fontWeight: 500, cursor: schedule.enabled ? 'pointer' : 'default',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>
                {label}
              </button>
            ))}
          </div>
        </div>
        <div className="s-row" style={{ opacity: schedule.enabled ? 1 : 0.4 }}>
          <div className="title">실행 시간</div>
          <input type="time" value={schedule.time}
            onChange={e => setSchedule(s => ({ ...s, time: e.target.value }))}
            disabled={!schedule.enabled}
            style={{
              background: 'var(--bg-elev-2)', border: '1px solid var(--border)',
              color: 'var(--text)', fontSize: 14, fontFamily: 'inherit',
              borderRadius: 8, padding: '4px 10px', cursor: schedule.enabled ? 'pointer' : 'default',
            }} />
        </div>
        <div style={{ padding: '12px 16px', borderTop: '1px solid var(--border)' }}>
          <button className="btn btn-primary" onClick={handleSave} style={{ width: '100%', justifyContent: 'center' }}>
            {saved ? '저장됨 ✓' : '저장'}
          </button>
          {saveErr && <p style={{ color: 'var(--down)', fontSize: 13, marginTop: 6 }}>{saveErr}</p>}
        </div>
      </div>

    </div>
  )
}

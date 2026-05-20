import { useState, useEffect, useRef } from 'react'
import axios from 'axios'

const DAYS = [
  { key: 'mon', label: '월' }, { key: 'tue', label: '화' },
  { key: 'wed', label: '수' }, { key: 'thu', label: '목' },
  { key: 'fri', label: '금' }, { key: 'sat', label: '토' },
  { key: 'sun', label: '일' },
]

export default function ReportSchedule() {
  const [schedule, setSchedule] = useState({ enabled: false, time: '08:00', days: ['mon', 'tue', 'wed', 'thu', 'fri'] })
  const [saved, setSaved] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [genMsg, setGenMsg] = useState('')
  const [progress, setProgress] = useState({ done: 0, total: 0, current: '' })
  const pollRef = useRef(null)

  useEffect(() => {
    axios.get('/api/schedule').then(({ data }) => setSchedule(data))
  }, [])

  const startPolling = () => {
    pollRef.current = setInterval(async () => {
      try {
        const { data } = await axios.get('/api/report/progress')
        setProgress({ done: data.done, total: data.total, current: data.current })
        if (!data.running && data.total > 0 && data.done >= data.total) {
          clearInterval(pollRef.current)
          setGenerating(false)
          setGenMsg(`완료: ${data.done}/${data.total} 종목 생성됨`)
        }
      } catch {}
    }, 1500)
  }

  const toggleDay = (day) => {
    setSchedule(s => ({
      ...s,
      days: s.days.includes(day) ? s.days.filter(d => d !== day) : [...s.days, day],
    }))
  }

  const handleSave = async () => {
    await axios.put('/api/schedule', schedule)
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  const handleGenerateNow = async () => {
    setGenerating(true)
    setGenMsg('')
    setProgress({ done: 0, total: 0, current: '' })
    try {
      await axios.post('/api/report/generate')
      startPolling()
    } catch (err) {
      setGenMsg(err.response?.data?.detail || '생성 실패')
      setGenerating(false)
    }
  }

  useEffect(() => () => clearInterval(pollRef.current), [])

  const pct = progress.total > 0 ? Math.round(progress.done / progress.total * 100) : 0

  return (
    <div style={{ maxWidth: 480 }}>
      <section style={{ background: 'var(--bg-surface)', padding: 20, borderRadius: 8, marginBottom: 24 }}>
        <h2 style={{ color: 'var(--text-heading)', marginBottom: 16, fontSize: 14 }}>자동 리포트 스케줄</h2>
        <div className="form-field" style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <label style={{ marginBottom: 0, width: 'auto' }}>자동 생성</label>
          <input type="checkbox" checked={schedule.enabled}
            onChange={e => setSchedule(s => ({ ...s, enabled: e.target.checked }))}
            style={{ width: 'auto' }} />
        </div>
        <div className="form-field">
          <label>생성 시간</label>
          <input type="time" value={schedule.time}
            onChange={e => setSchedule(s => ({ ...s, time: e.target.value }))}
            disabled={!schedule.enabled} />
        </div>
        <div className="form-field">
          <label style={{ marginBottom: 8 }}>요일</label>
          <div style={{ display: 'flex', gap: 8 }}>
            {DAYS.map(({ key, label }) => (
              <button key={key} type="button" onClick={() => toggleDay(key)}
                disabled={!schedule.enabled}
                style={{
                  padding: '4px 8px', borderRadius: 4, border: 'none',
                  cursor: schedule.enabled ? 'pointer' : 'default',
                  background: schedule.days.includes(key) ? 'var(--accent-btn)' : 'var(--bg-hover)',
                  color: schedule.days.includes(key) ? 'white' : 'var(--text-muted)',
                  opacity: schedule.enabled ? 1 : 0.5, fontSize: 13,
                }}>
                {label}
              </button>
            ))}
          </div>
        </div>
        <button className="btn-primary" onClick={handleSave}>{saved ? '저장됨' : '저장'}</button>
      </section>

      <section style={{ background: 'var(--bg-surface)', padding: 20, borderRadius: 8 }}>
        <h2 style={{ color: 'var(--text-heading)', marginBottom: 12, fontSize: 14 }}>즉시 리포트 생성</h2>
        <p style={{ color: 'var(--text-muted)', fontSize: 13, marginBottom: 12 }}>보유 및 관심 종목 전체에 대해 즉시 리포트를 생성합니다. 종목당 30초~1분 소요됩니다.</p>
        <button className="btn-primary" onClick={handleGenerateNow} disabled={generating}>
          {generating ? '생성 중...' : '지금 생성'}
        </button>
        {generating && progress.total > 0 && (
          <div style={{ marginTop: 14 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, color: 'var(--text-muted)', marginBottom: 6 }}>
              <span>{progress.current ? `생성 중: ${progress.current}` : '준비 중...'}</span>
              <span style={{ color: 'var(--accent)', fontWeight: 600 }}>{progress.done} / {progress.total}</span>
            </div>
            <div style={{ background: 'var(--bg-hover)', borderRadius: 4, height: 8, overflow: 'hidden' }}>
              <div style={{ width: `${pct}%`, height: '100%', background: '#4fc3f7', borderRadius: 4, transition: 'width 0.4s ease' }} />
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4, textAlign: 'right' }}>{pct}%</div>
          </div>
        )}
        {genMsg && <p style={{ marginTop: 8, color: 'var(--positive)', fontSize: 13 }}>{genMsg}</p>}
      </section>
    </div>
  )
}

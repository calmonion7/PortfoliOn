import { useState, useEffect, useRef } from 'react'
import api from '../api'

const DAYS_OPTIONS = [30, 60, 90, 180]

export default function ConsensusSettings() {
  const [days, setDays] = useState(180)
  const [batch, setBatch] = useState({ running: false, done: 0, total: 0, current: '' })
  const [batchErr, setBatchErr] = useState('')
  const pollRef = useRef(null)

  useEffect(() => () => clearInterval(pollRef.current), [])

  const runBatch = async () => {
    setBatch({ running: true, done: 0, total: 0, current: '' })
    setBatchErr('')
    clearInterval(pollRef.current)
    try {
      await api.post(`/api/consensus/batch?days=${days}`)
      pollRef.current = setInterval(async () => {
        try {
          const { data } = await api.get('/api/consensus/batch/progress')
          setBatch({ running: data.running, done: data.done, total: data.total, current: data.current })
          if (!data.running && data.total > 0 && data.done >= data.total) {
            clearInterval(pollRef.current)
          }
        } catch {}
      }, 1500)
    } catch (err) {
      setBatch(p => ({ ...p, running: false }))
      setBatchErr(err?.response?.data?.detail || '실행에 실패했습니다.')
    }
  }

  const pct = batch.total > 0 ? Math.round(batch.done / batch.total * 100) : 0

  return (
    <div style={{ maxWidth: 480 }}>
      <div className="s-group-h" style={{ paddingLeft: 0, paddingRight: 0, paddingTop: 8 }}>컨센서스 수집/백필</div>
      <div className="list-card" style={{ margin: '0 0 6px' }}>
        <div style={{ padding: '14px 16px' }}>
          <p style={{ color: 'var(--text-3)', fontSize: 13, margin: '0 0 14px', lineHeight: 1.6 }}>
            전체 종목의 네이버 컨센서스 데이터를 수집하고 백필을 실행합니다. 수 분 소요됩니다.
          </p>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
            <span style={{ fontSize: 13, color: 'var(--text-3)', flexShrink: 0 }}>기간</span>
            <div style={{ flex: 1, display: 'flex', gap: 2, padding: 3, background: 'var(--accent-soft)', borderRadius: 10 }}>
              {DAYS_OPTIONS.map(d => (
                <button key={d} onClick={() => setDays(d)} style={{
                  flex: 1, border: 0, padding: '7px 0', fontSize: 13, fontWeight: 500,
                  borderRadius: 8, letterSpacing: '-0.01em',
                  background: days === d ? 'var(--bg-elev)' : 'transparent',
                  color: days === d ? 'var(--text)' : 'var(--text-3)',
                  boxShadow: days === d ? 'var(--shadow-sm)' : 'none',
                  cursor: 'pointer',
                }}>{d}일</button>
              ))}
            </div>
          </div>
          <button className="btn btn-primary" onClick={runBatch} disabled={batch.running}
            style={{ width: '100%', justifyContent: 'center' }}>
            {batch.running
              ? `${batch.current || '...'} (${batch.done}/${batch.total})`
              : '지금 수집/백필'}
          </button>
          {batch.running && batch.total > 0 && (
            <div style={{ marginTop: 14 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: 'var(--text-3)', marginBottom: 8 }}>
                <span>{batch.current || '준비 중...'}</span>
                <span style={{ color: 'var(--text)', fontWeight: 600 }}>{batch.done} / {batch.total}</span>
              </div>
              <div style={{ background: 'var(--accent-soft)', borderRadius: 999, height: 4, overflow: 'hidden' }}>
                <div style={{
                  width: `${pct}%`,
                  height: '100%',
                  background: 'var(--text)',
                  borderRadius: 999,
                  transition: 'width 0.4s ease',
                }} />
              </div>
            </div>
          )}
          {!batch.running && batch.total > 0 && batch.done >= batch.total && (
            <p style={{ marginTop: 8, color: 'var(--up)', fontSize: 13 }}>
              완료: {batch.done}개 종목 수집됨
            </p>
          )}
          {batchErr && <p style={{ marginTop: 8, color: 'var(--down)', fontSize: 13 }}>{batchErr}</p>}
        </div>
      </div>
    </div>
  )
}

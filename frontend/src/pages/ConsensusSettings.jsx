import { useState, useEffect, useRef } from 'react'
import axios from 'axios'

export default function ConsensusSettings() {
  const [batch, setBatch] = useState({ running: false, done: 0, total: 0, current: '' })
  const pollRef = useRef(null)

  useEffect(() => () => clearInterval(pollRef.current), [])

  const runBatch = async () => {
    setBatch({ running: true, done: 0, total: 0, current: '' })
    clearInterval(pollRef.current)
    try {
      await axios.post('/api/consensus/batch')
      pollRef.current = setInterval(async () => {
        try {
          const { data } = await axios.get('/api/consensus/batch/progress')
          setBatch({ running: data.running, done: data.done, total: data.total, current: data.current })
          if (!data.running && data.total > 0 && data.done >= data.total) {
            clearInterval(pollRef.current)
          }
        } catch {}
      }, 1500)
    } catch {
      setBatch(p => ({ ...p, running: false }))
    }
  }

  return (
    <div style={{ maxWidth: 600 }}>
      <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 6, padding: '16px 20px', marginBottom: 16 }}>
        <h2 style={{ color: 'var(--text-heading)', marginBottom: 8, fontSize: 14 }}>컨센서스 수집/백필</h2>
        <p style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 16 }}>
          전체 종목의 네이버 컨센서스 데이터를 수집하고 60일 백필을 실행합니다. 수 분 소요됩니다.
        </p>
        <button className="btn-primary" onClick={runBatch} disabled={batch.running}>
          {batch.running
            ? `${batch.current || '...'} (${batch.done}/${batch.total})`
            : '지금 수집/백필'}
        </button>
        {batch.running && batch.total > 0 && (
          <div style={{ marginTop: 12 }}>
            <div style={{ background: 'var(--bg-hover)', borderRadius: 2, height: 4, overflow: 'hidden' }}>
              <div style={{
                width: `${Math.round(batch.done / batch.total * 100)}%`,
                height: '100%',
                background: 'var(--accent)',
                transition: 'width 0.4s ease',
              }} />
            </div>
          </div>
        )}
        {!batch.running && batch.total > 0 && batch.done >= batch.total && (
          <p style={{ marginTop: 8, color: 'var(--positive)', fontSize: 13 }}>
            완료: {batch.done}개 종목 수집됨
          </p>
        )}
      </div>
    </div>
  )
}

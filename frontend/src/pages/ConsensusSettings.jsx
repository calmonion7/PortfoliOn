import { useState, useEffect, useRef } from 'react'
import api from '../api'

export default function ConsensusSettings() {
  const [batch, setBatch] = useState({ running: false, done: 0, total: 0, current: '' })
  const [batchErr, setBatchErr] = useState('')
  const pollRef = useRef(null)

  useEffect(() => () => clearInterval(pollRef.current), [])

  const runBatch = async () => {
    setBatch({ running: true, done: 0, total: 0, current: '' })
    setBatchErr('')
    clearInterval(pollRef.current)
    try {
      await api.post('/api/consensus/batch')
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
            전체 종목의 네이버 컨센서스 데이터를 수집하고 60일 백필을 실행합니다. 수 분 소요됩니다.
          </p>
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

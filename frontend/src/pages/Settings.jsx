import { useState, useEffect } from 'react'
import api from '../api'
import BatchScheduleEditor from '../components/BatchScheduleEditor'
import ReportManualGen from './ReportManualGen'
import GuruCrawlNow from './GuruCrawlNow'
import ConsensusSettings from './ConsensusSettings'
import LeverageBackfillSettings from './LeverageBackfillSettings'
import useIsMobile from '../hooks/useIsMobile'
import { useAuth } from '../contexts/AuthContext'
import PermissionManager from '../components/PermissionManager'

const CATEGORIES = [
  { key: 'report', label: '리포트·분석' },
  { key: 'market', label: '시장 데이터' },
  { key: 'guru',   label: '구루' },
]

// 스케줄 에디터 외에 배치별로 추가로 노출할 컴포넌트.
// consensus(편집 불가)는 에디터 없이 ConsensusSettings만 노출한다.
const EXTRA = {
  daily_report:   ReportManualGen,
  consensus:      ConsensusSettings,
  guru_crawl:     GuruCrawlNow,
  leverage_fetch: LeverageBackfillSettings,
}

function fmtKst(iso) {
  if (!iso) return null
  const d = new Date(iso)
  if (isNaN(d)) return null
  return d.toLocaleString('ko-KR', {
    timeZone: 'Asia/Seoul',
    month: 'numeric', day: 'numeric',
    hour: '2-digit', minute: '2-digit',
  })
}

function TriggerBadge({ trigger }) {
  const manual = trigger === 'manual'
  return (
    <span className={`m-pill ${manual ? 'm-pill-warn' : 'm-pill-neutral'}`}>
      {manual ? '수동' : '자동'}
    </span>
  )
}

function StatusIcon({ status }) {
  if (status === 'success') return <span className="up" style={{ fontSize: 12 }}>●</span>
  if (status === 'failed')  return <span className="down" style={{ fontSize: 12 }}>●</span>
  return <span style={{ color: 'var(--text-faint)', fontSize: 12 }}>○</span>
}

function RecentRun({ run }) {
  if (!run) return <span style={{ color: 'var(--text-faint)' }}>실행 이력 없음</span>
  const ts = fmtKst(run.finished_at || run.started_at)
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
      <StatusIcon status={run.status} />
      <span>{ts || '-'}</span>
      <TriggerBadge trigger={run.trigger} />
    </span>
  )
}

function ManualRunButton({ batch }) {
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const [err, setErr] = useState('')

  const run = async () => {
    setBusy(true)
    setMsg('')
    setErr('')
    try {
      await api.post(batch.manual_endpoint)
      setMsg('실행 요청됨')
    } catch (e) {
      setErr(e?.response?.data?.detail || '실행에 실패했습니다.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div>
      <button className="btn btn-primary" onClick={run} disabled={busy}
        style={{ justifyContent: 'center' }}>
        {busy ? '실행 중...' : '지금 실행'}
      </button>
      {msg && <p style={{ marginTop: 8, color: 'var(--up)', fontSize: 13 }}>{msg}</p>}
      {err && <p style={{ marginTop: 8, color: 'var(--down)', fontSize: 13 }}>{err}</p>}
    </div>
  )
}

function BatchCard({ batch, isAdmin, onSaved }) {
  const [open, setOpen] = useState(false)
  const Extra = EXTRA[batch.id]
  const recent = batch.recent_runs?.[0]
  const nextRun = fmtKst(batch.next_run)
  const showEditor = isAdmin && batch.editable
  const showExtra = isAdmin && Extra

  return (
    <div className="list-card" style={{ margin: '0 0 10px' }}>
      <button
        onClick={() => setOpen(o => !o)}
        style={{
          width: '100%', display: 'flex', alignItems: 'center', gap: 12,
          padding: '14px 16px', border: 0, background: 'transparent',
          cursor: 'pointer', textAlign: 'left', color: 'var(--text)', font: 'inherit',
        }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 14, fontWeight: 600 }}>{batch.label}</div>
          <div style={{ fontSize: 12, color: 'var(--text-3)', marginTop: 3 }}>
            {batch.schedule_desc}
            {batch.usage?.length > 0 && <> · {batch.usage.join(', ')}</>}
          </div>
          <div style={{ fontSize: 11.5, color: 'var(--text-3)', marginTop: 5, display: 'flex', flexWrap: 'wrap', gap: '4px 14px' }}>
            <span>다음 {nextRun || '예정 없음'}</span>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>최근 <RecentRun run={recent} /></span>
          </div>
        </div>
        <span style={{ color: 'var(--text-faint)', fontSize: 12, flexShrink: 0 }}>{open ? '▲' : '▼'}</span>
      </button>

      {open && (
        <div style={{ borderTop: '1px solid var(--border)', padding: '14px 16px' }}>
          {showEditor || showExtra ? (
            <>
              {showEditor && (
                <BatchScheduleEditor jobId={batch.id} schedule={batch.schedule} timezone={batch.timezone} onSaved={onSaved} />
              )}
              {showExtra && <Extra />}
              {!showExtra && batch.manual_endpoint && (
                <div style={{ marginTop: 14 }}><ManualRunButton batch={batch} /></div>
              )}
            </>
          ) : (
            <>
              <div className="s-row" style={{ padding: '0 0 12px', gridTemplateColumns: '1fr' }}>
                <div>
                  <div className="desc">주기: {batch.schedule_desc}</div>
                  {batch.usage?.length > 0 && <div className="desc">사용처: {batch.usage.join(', ')}</div>}
                </div>
              </div>
              {isAdmin && batch.manual_endpoint && <ManualRunButton batch={batch} />}
            </>
          )}
        </div>
      )}
    </div>
  )
}

function BatchHub({ isAdmin }) {
  const [batches, setBatches] = useState(null)
  const [err, setErr] = useState('')

  const load = () => api.get('/api/batches')
    .then(({ data }) => setBatches(data))
    .catch(e => setErr(e?.response?.data?.detail || '배치 현황을 불러오지 못했습니다.'))

  useEffect(() => { load() }, [])

  if (err) return <p style={{ color: 'var(--down)', fontSize: 13 }}>{err}</p>
  if (!batches) return <p style={{ color: 'var(--text-3)', fontSize: 13 }}>불러오는 중...</p>
  if (batches.length === 0) return <p style={{ color: 'var(--text-3)', fontSize: 13 }}>등록된 배치가 없습니다.</p>

  return (
    <>
      {CATEGORIES.map(cat => {
        const items = batches.filter(b => b.category === cat.key)
        if (items.length === 0) return null
        return (
          <div key={cat.key}>
            <div className="s-group-h" style={{ paddingLeft: 0, paddingRight: 0 }}>{cat.label}</div>
            {items.map(b => <BatchCard key={b.id} batch={b} isAdmin={isAdmin} onSaved={load} />)}
          </div>
        )
      })}
    </>
  )
}

export default function Settings() {
  const isMobile = useIsMobile()
  const [tab, setTab] = useState('batch')
  const { role } = useAuth() || { role: 'user' }
  const isAdmin = role === 'admin'

  const showAccount = isAdmin
  const activeTab = tab === 'account' && !showAccount ? 'batch' : tab

  if (isMobile) return (
    <>
      <header className="appbar">
        <h1>설정</h1>
      </header>

      <div className="seg-pad">
        <div className="seg">
          <button className={activeTab === 'batch' ? 'is-active' : ''} onClick={() => setTab('batch')}>배치</button>
          {showAccount && (
            <button className={activeTab === 'account' ? 'is-active' : ''} onClick={() => setTab('account')}>권한·계정</button>
          )}
        </div>
      </div>

      <div style={{ padding: '0 20px 20px' }}>
        {activeTab === 'batch'   && <BatchHub isAdmin={isAdmin} />}
        {activeTab === 'account' && showAccount && <PermissionManager />}
      </div>
    </>
  )

  return (
    <div className="page">
      <h1 style={{ color: 'var(--text)', marginBottom: 20 }}>설정</h1>

      <div style={{ display: 'flex', borderBottom: '1px solid var(--border)', marginBottom: 24 }}>
        <button className={`tab-btn${activeTab === 'batch' ? ' active' : ''}`} onClick={() => setTab('batch')}>배치</button>
        {showAccount && (
          <button className={`tab-btn${activeTab === 'account' ? ' active' : ''}`} onClick={() => setTab('account')}>권한·계정</button>
        )}
      </div>

      {activeTab === 'batch'   && <BatchHub isAdmin={isAdmin} />}
      {activeTab === 'account' && showAccount && <PermissionManager />}
    </div>
  )
}

import { useState } from 'react'
import ReportSchedule from './ReportSchedule'
import GuruCrawlSettings from './GuruCrawlSettings'
import ConsensusSettings from './ConsensusSettings'
import useIsMobile from '../hooks/useIsMobile'
import { supabase } from '../supabase'

const TABS = [
  { key: 'report',    label: '리포트 설정' },
  { key: 'consensus', label: '컨센서스 수집' },
  { key: 'guru',      label: '구루 설정' },
]

export default function Settings() {
  const isMobile = useIsMobile()
  const [tab, setTab] = useState('report')

  if (isMobile) return (
    <>
      <header className="appbar">
        <h1>설정</h1>
      </header>

      <div className="seg-pad">
        <div className="seg">
          <button className={tab === 'report' ? 'is-active' : ''} onClick={() => setTab('report')}>리포트</button>
          <button className={tab === 'consensus' ? 'is-active' : ''} onClick={() => setTab('consensus')}>컨센서스</button>
          <button className={tab === 'guru' ? 'is-active' : ''} onClick={() => setTab('guru')}>구루</button>
        </div>
      </div>

      <div style={{ padding: '0 20px 20px' }}>
        {tab === 'report'    && <ReportSchedule />}
        {tab === 'consensus' && <ConsensusSettings />}
        {tab === 'guru'      && <GuruCrawlSettings />}
      </div>

      <div style={{ padding: '0 20px 32px' }}>
        <button className="btn" style={{ width: '100%', justifyContent: 'center', color: 'var(--down)' }}
          onClick={() => supabase.auth.signOut()}>
          로그아웃
        </button>
      </div>
    </>
  )

  return (
    <div className="page">
      <h1 style={{ color: 'var(--text)', marginBottom: 20 }}>설정</h1>

      <div style={{ display: 'flex', borderBottom: '1px solid var(--border)', marginBottom: 24 }}>
        {TABS.map(t => (
          <button key={t.key} className={`tab-btn${tab === t.key ? ' active' : ''}`} onClick={() => setTab(t.key)}>
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'report'    && <ReportSchedule />}
      {tab === 'consensus' && <ConsensusSettings />}
      {tab === 'guru'      && <GuruCrawlSettings />}
    </div>
  )
}

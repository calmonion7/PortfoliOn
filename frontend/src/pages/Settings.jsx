import { useState } from 'react'
import ReportSchedule from './ReportSchedule'
import GuruCrawlSettings from './GuruCrawlSettings'
import ConsensusSettings from './ConsensusSettings'
import useIsMobile from '../hooks/useIsMobile'
import useTheme from '../hooks/useTheme'
import { supabase } from '../supabase'

const TABS = [
  { key: 'report',    label: '리포트 설정' },
  { key: 'consensus', label: '컨센서스 수집' },
  { key: 'guru',      label: '구루 설정' },
]

export default function Settings() {
  const isMobile = useIsMobile()
  const [tab, setTab] = useState('report')
  const [theme, setTheme] = useTheme()

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

      {/* 테마 토글 */}
      <div style={{ padding: '0 20px 16px' }}>
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          background: 'var(--bg-elev)', border: '1px solid var(--border)',
          borderRadius: 12, padding: '14px 16px',
        }}>
          <div>
            <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 2 }}>화면 테마</div>
            <div style={{ fontSize: 12, color: 'var(--text-3)' }}>{theme === 'dark' ? '다크 모드' : '라이트 모드'}</div>
          </div>
          <button
            onClick={() => setTheme(t => t === 'dark' ? 'light' : 'dark')}
            style={{
              display: 'flex', gap: 2, padding: 3,
              background: 'var(--bg-elev-2)', border: '1px solid var(--border)',
              borderRadius: 10, cursor: 'pointer',
            }}
          >
            {['light', 'dark'].map(t => (
              <span key={t} style={{
                padding: '6px 14px', borderRadius: 8, fontSize: 13, fontWeight: 500,
                background: theme === t ? 'var(--text)' : 'transparent',
                color: theme === t ? 'var(--bg)' : 'var(--text-3)',
                transition: 'background .15s, color .15s',
              }}>
                {t === 'light' ? '☀️ 라이트' : '🌙 다크'}
              </span>
            ))}
          </button>
        </div>
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

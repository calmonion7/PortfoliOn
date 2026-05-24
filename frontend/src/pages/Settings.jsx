import { useState } from 'react'
import ReportSchedule from './ReportSchedule'
import GuruCrawlSettings from './GuruCrawlSettings'
import ConsensusSettings from './ConsensusSettings'

const TABS = [
  { key: 'report',    label: '리포트 설정' },
  { key: 'consensus', label: '컨센서스 수집' },
  { key: 'guru',      label: '구루 설정' },
]

export default function Settings() {
  const [tab, setTab] = useState('report')

  const tabStyle = (active) => ({
    padding: '8px 16px', border: 'none',
    borderBottom: active ? `2px solid var(--accent)` : '2px solid transparent',
    background: 'none', color: active ? 'var(--accent)' : 'var(--text-muted)',
    cursor: 'pointer', fontWeight: active ? 600 : 400, fontSize: 14,
  })

  return (
    <div style={{ maxWidth: 900 }}>
      <h1 style={{ color: 'var(--text-heading)', marginBottom: 20 }}>설정</h1>

      <div style={{ display: 'flex', borderBottom: '1px solid var(--border)', marginBottom: 24 }}>
        {TABS.map(t => (
          <button key={t.key} style={tabStyle(tab === t.key)} onClick={() => setTab(t.key)}>
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

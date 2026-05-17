import { useState } from 'react'
import ReportSchedule from './ReportSchedule'
import GuruCrawlSettings from './GuruCrawlSettings'

const TABS = [
  { key: 'report', label: '리포트 설정' },
  { key: 'guru',   label: '구루 설정' },
]

export default function Settings() {
  const [tab, setTab] = useState('report')

  const tabStyle = (active) => ({
    padding: '8px 16px', border: 'none',
    borderBottom: active ? '2px solid #4fc3f7' : '2px solid transparent',
    background: 'none', color: active ? '#4fc3f7' : '#888',
    cursor: 'pointer', fontWeight: active ? 600 : 400, fontSize: 14,
  })

  return (
    <div style={{ maxWidth: 900 }}>
      <h1 style={{ color: '#90caf9', marginBottom: 20 }}>설정</h1>

      <div style={{ display: 'flex', borderBottom: '1px solid #333', marginBottom: 24 }}>
        {TABS.map(t => (
          <button key={t.key} style={tabStyle(tab === t.key)} onClick={() => setTab(t.key)}>
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'report' && <ReportSchedule />}
      {tab === 'guru'   && <GuruCrawlSettings />}
    </div>
  )
}

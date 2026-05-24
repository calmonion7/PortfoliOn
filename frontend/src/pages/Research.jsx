import { useState } from 'react'
import Reports from './Reports'
import Calendar from './Calendar'
import Digest from './Digest'

const TABS = [
  { key: 'reports',  label: '리포트' },
  { key: 'calendar', label: '캘린더' },
  { key: 'digest',   label: '다이제스트' },
]

export default function Research() {
  const [tab, setTab] = useState('reports')

  const tabStyle = (active) => ({
    padding: '8px 16px', border: 'none',
    borderBottom: active ? '2px solid var(--accent)' : '2px solid transparent',
    background: 'none', color: active ? 'var(--accent)' : 'var(--text-muted)',
    cursor: 'pointer', fontWeight: active ? 600 : 400, fontSize: 14,
  })

  return (
    <div>
      <div style={{ display: 'flex', borderBottom: '1px solid var(--border)', marginBottom: 24 }}>
        {TABS.map(t => (
          <button key={t.key} style={tabStyle(tab === t.key)} onClick={() => setTab(t.key)}>
            {t.label}
          </button>
        ))}
      </div>
      {tab === 'reports'  && <Reports />}
      {tab === 'calendar' && <Calendar />}
      {tab === 'digest'   && <Digest />}
    </div>
  )
}

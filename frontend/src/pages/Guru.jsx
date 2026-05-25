import { useState } from 'react'
import GuruManagers from './GuruManagers'
import GuruStats from './GuruStats'

const TABS = [
  { key: 'managers', label: '매니저 목록' },
  { key: 'stats',    label: '추천 통계' },
]

export default function Guru() {
  const [tab, setTab] = useState('managers')

  const tabStyle = (active) => ({
    padding: '6px 14px', borderRadius: 16,
    border: `1px solid ${active ? 'var(--accent)' : 'var(--border)'}`,
    background: active ? 'var(--accent-btn)' : 'transparent',
    color: active ? 'white' : 'var(--text-muted)',
    cursor: 'pointer', fontSize: 13,
  })

  return (
    <div style={{ maxWidth: 900 }}>
      <h3 style={{ color: 'var(--text-heading)', marginBottom: 8 }}>구루 매니저</h3>

      <div className="tab-scroll" style={{ display: 'flex', gap: 8, marginBottom: 20 }}>
        {TABS.map(t => (
          <button key={t.key} style={tabStyle(tab === t.key)} onClick={() => setTab(t.key)}>
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'managers' && <GuruManagers />}
      {tab === 'stats'    && <GuruStats />}
    </div>
  )
}

// frontend/src/pages/AnalysisHub.jsx
import { useState } from 'react'
import SectorTab from './SectorTab'
import MacroTab from './MacroTab'

const TABS = [
  { key: 'sector', label: '섹터' },
  { key: 'macro',  label: '매크로' },
]

export default function AnalysisHub() {
  const [tab, setTab] = useState('sector')

  const tabStyle = (active) => ({
    padding: '6px 14px', borderRadius: 16,
    border: `1px solid ${active ? 'var(--accent)' : 'var(--border)'}`,
    background: active ? 'var(--accent-btn)' : 'transparent',
    color: active ? 'white' : 'var(--text-muted)',
    cursor: 'pointer', fontSize: 13,
  })

  return (
    <div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 24 }}>
        {TABS.map(t => (
          <button key={t.key} style={tabStyle(tab === t.key)} onClick={() => setTab(t.key)}>
            {t.label}
          </button>
        ))}
      </div>
      {tab === 'sector' && <SectorTab />}
      {tab === 'macro'  && <MacroTab />}
    </div>
  )
}

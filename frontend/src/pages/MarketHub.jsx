import { useState } from 'react'
import Market from './Market'
import Analytics from './Analytics'

const TABS = [
  { key: 'indicators', label: '시장지표' },
  { key: 'analytics',  label: '분석' },
]

export default function MarketHub() {
  const [tab, setTab] = useState('indicators')

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
      {tab === 'indicators' && <Market />}
      {tab === 'analytics'  && <Analytics />}
    </div>
  )
}

import { useState } from 'react'
import GuruManagers from './GuruManagers'
import GuruStats from './GuruStats'
import useIsMobile from '../hooks/useIsMobile'

const TABS = [
  { key: 'managers', label: '매니저 목록' },
  { key: 'stats',    label: '추천 통계' },
]

export default function Guru() {
  const isMobile = useIsMobile()
  const [tab, setTab] = useState('managers')

  if (isMobile) return (
    <>
      <header className="appbar">
        <h1>구루</h1>
      </header>
      <div className="seg-pad">
        <div className="seg">
          <button className={tab === 'managers' ? 'is-active' : ''} onClick={() => setTab('managers')}>매니저</button>
          <button className={tab === 'stats' ? 'is-active' : ''} onClick={() => setTab('stats')}>추천 통계</button>
        </div>
      </div>
      <div className="m-page">
        {tab === 'managers' && <GuruManagers />}
        {tab === 'stats'    && <GuruStats />}
      </div>
    </>
  )

  return (
    <div className="page">
      <h3 style={{ color: 'var(--text)', marginBottom: 8 }}>구루 매니저</h3>

      <div className="tabs" style={{ marginBottom: 18 }}>
        {TABS.map(t => (
          <button key={t.key} className={tab === t.key ? 'is-active' : ''} onClick={() => setTab(t.key)}>
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'managers' && <GuruManagers />}
      {tab === 'stats'    && <GuruStats />}
    </div>
  )
}

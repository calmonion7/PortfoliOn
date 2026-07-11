import { useState } from 'react'
import GuruManagers from './GuruManagers'
import GuruStats from './GuruStats'
import useIsMobile from '../hooks/useIsMobile'

// 이중 탭(상위 매니저/통계 + GuruStats 내부 탭)을 단일 탭행으로 평탄화.
// stats 뷰 key는 GuruStats의 내부 view 값과 일치(popularity/top3/weighted).
const TABS = [
  { key: 'managers',   label: '매니저 목록' },
  { key: 'popularity', label: '인기순' },
  { key: 'top3',       label: '매니저별 탑3' },
  { key: 'weighted',   label: '가중치' },
]

export default function Guru() {
  const isMobile = useIsMobile()
  const [tab, setTab] = useState('managers')

  const body = tab === 'managers'
    ? <GuruManagers />
    : <GuruStats view={tab} />

  if (isMobile) return (
    <>
      <header className="appbar">
        <h1>구루</h1>
      </header>
      <div className="seg-pad">
        <div className="seg">
          {TABS.map(t => (
            <button key={t.key} className={tab === t.key ? 'is-active' : ''} onClick={() => setTab(t.key)}>
              {t.label}
            </button>
          ))}
        </div>
      </div>
      <div className="m-page">
        {body}
      </div>
    </>
  )

  return (
    <div className="page">
      <div className="page-head">
        <h1 className="page-title">구루 매니저</h1>
      </div>

      <div className="tabs" style={{ marginBottom: 18 }}>
        {TABS.map(t => (
          <button key={t.key} className={tab === t.key ? 'is-active' : ''} onClick={() => setTab(t.key)}>
            {t.label}
          </button>
        ))}
      </div>

      {body}
    </div>
  )
}

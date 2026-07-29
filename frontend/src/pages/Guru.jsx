import { useState } from 'react'
import GuruManagers from './GuruManagers'
import GuruStats from './GuruStats'
import GuruAllocation from './GuruAllocation'
import useIsMobile from '../hooks/useIsMobile'

// 이중 탭(상위 매니저/통계 + GuruStats 내부 탭)을 단일 탭행으로 평탄화.
// stats 뷰 key는 GuruStats의 내부 view 값과 일치(popularity/weighted).
// '매니저별 탑3' 탭은 제거됨 — 매니저 목록 카드의 top10 배지가 비중%·보유 구루 수를 흡수(task#227).
// '투자금'만 별도 컴포넌트다 — 전 종목 층을 읽는 자체 fetch라 GuruStats(top10층 2종 동시
// fetch)에 얹지 않고, 그 탭이 선택될 때만 불러온다(task#241).
const TABS = [
  { key: 'managers',   label: '매니저 목록' },
  { key: 'popularity', label: '인기순' },
  { key: 'weighted',   label: '가중치' },
  { key: 'allocation', label: '투자금' },
]

export default function Guru() {
  const isMobile = useIsMobile()
  const [tab, setTab] = useState('managers')

  const body = tab === 'managers'
    ? <GuruManagers />
    : tab === 'allocation'
      ? <GuruAllocation />
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

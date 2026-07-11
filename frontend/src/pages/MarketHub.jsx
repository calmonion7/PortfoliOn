import { NavLink } from 'react-router-dom'
import Market from './Market'
import useIsMobile from '../hooks/useIsMobile'

// 모바일 필 2개(시장지표/수급지표)는 라우트 네비게이션(/market/indicators, /market/flow) — PC는 사이드바가 nav 담당.
const TABS = [
  { to: '/market/indicators', label: '시장지표' },
  { to: '/market/flow', label: '수급지표' },
]

export default function MarketHub({ tab }) {
  const isMobile = useIsMobile()
  const activeLabel = tab === 'flow' ? '수급지표' : '시장지표'

  if (isMobile) return (
    <>
      <header className="appbar">
        <h1>시장</h1>
      </header>
      <div className="seg-pad">
        <div className="seg">
          {TABS.map(t => (
            <NavLink key={t.to} to={t.to} className={({ isActive }) => isActive ? 'is-active' : ''}>
              {t.label}
            </NavLink>
          ))}
        </div>
      </div>
      <div className="m-page">
        <Market tab={tab} />
      </div>
    </>
  )

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1 className="page-title">시장</h1>
          <p className="page-sub">{activeLabel}</p>
        </div>
      </div>
      <Market tab={tab} />
    </div>
  )
}

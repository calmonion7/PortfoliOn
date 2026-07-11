import { NavLink, useLocation } from 'react-router-dom'
import { trackEvent } from '../utils/analytics'
import useIsMobile from '../hooks/useIsMobile'

// 리서치 7하위 라우트 공용 얇은 래퍼(task#172 S2) — 각 라우트가 실제 탭 컴포넌트를 children으로 렌더한다.
// 모바일: 기존 seg 필 nav(동선 보존, state 전환→라우트 네비게이션). PC: 사이드바가 nav를 담당하므로 필 숨김.
const TABS = [
  { to: '/reports', label: '리포트', evt: 'tab_reports' },
  { to: '/recommend', label: '추천' },
  { to: '/ranking', label: '랭킹', evt: 'tab_ranking' },
  { to: '/compare', label: '비교', evt: 'tab_compare' },
  { to: '/calendar', label: '캘린더', evt: 'tab_calendar' },
  { to: '/dividends', label: '배당' },
  { to: '/digest', label: '다이제스트', evt: 'tab_digest' },
]

export default function ResearchShell({ children }) {
  const isMobile = useIsMobile()
  const { pathname } = useLocation()
  const activeLabel = TABS.find(t => pathname.startsWith(t.to))?.label

  if (isMobile) return (
    <>
      <header className="appbar">
        <h1>리서치</h1>
      </header>
      <div className="seg-pad">
        <div className="seg">
          {TABS.map(t => (
            <NavLink key={t.to} to={t.to}
              onClick={() => t.evt && trackEvent(t.evt)}
              className={({ isActive }) => isActive ? 'is-active' : ''}>
              {t.label}
            </NavLink>
          ))}
        </div>
      </div>
      <div className="m-page">{children}</div>
    </>
  )

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1 className="page-title">리서치</h1>
          {activeLabel && <p className="page-sub">{activeLabel}</p>}
        </div>
      </div>
      {children}
    </div>
  )
}

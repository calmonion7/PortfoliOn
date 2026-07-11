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

// 사이드바 IA(ADR-0025) 상 '일정·인컴' 섹션 소속 라우트 — 헤더 그룹 라벨 동기화용(task#175 F23)
const SCHEDULE_PATHS = ['/calendar', '/dividends', '/digest']

export default function ResearchShell({ children }) {
  const isMobile = useIsMobile()
  const { pathname } = useLocation()
  const activeLabel = TABS.find(t => pathname.startsWith(t.to))?.label
  const groupLabel = SCHEDULE_PATHS.some(p => pathname.startsWith(p)) ? '일정·인컴' : '리서치'

  if (isMobile) return (
    <>
      <header className="appbar">
        {/* 모바일 하단 MobileNav·서브내비가 아직 이 7탭을 '리서치'로 묶으므로(5섹션 모바일 IA는 후속 과제) 헤더도 '리서치'로 일치. PC는 사이드바 '일정·인컴' 섹션과 맞춰 groupLabel 사용. task#175 F23 회귀수정 */}
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
          <h1 className="page-title">{groupLabel}</h1>
          {activeLabel && <p className="page-sub">{activeLabel}</p>}
        </div>
      </div>
      {children}
    </div>
  )
}

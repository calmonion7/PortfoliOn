import { NavLink, useLocation } from 'react-router-dom'
import { trackEvent } from '../utils/analytics'
import useIsMobile from '../hooks/useIsMobile'
import GlobalSearch from '../components/GlobalSearch'

// 리서치 7하위 라우트 공용 얇은 래퍼(task#172 S2) — 각 라우트가 실제 탭 컴포넌트를 children으로 렌더한다.
// 모바일: 기존 seg 필 nav(동선 보존, state 전환→라우트 네비게이션). PC: 마스트헤드가 nav를 담당하므로 필 숨김(ADR-0026).
// 마스트헤드 IA 5섹션 미러: 리서치(리포트/추천/랭킹/비교)와 일정·인컴(캘린더/배당/다이제스트)을
// 별도 모바일 섹션으로 분리 — seg는 현재 섹션 하위만 노출(교차 노출 없음, task#178).
const RESEARCH_TABS = [
  { to: '/reports', label: '리포트', evt: 'tab_reports' },
  { to: '/recommend', label: '추천' },
  { to: '/ranking', label: '랭킹', evt: 'tab_ranking' },
  { to: '/compare', label: '비교', evt: 'tab_compare' },
]
const SCHEDULE_TABS = [
  { to: '/calendar', label: '캘린더', evt: 'tab_calendar' },
  { to: '/dividends', label: '배당' },
  { to: '/digest', label: '다이제스트', evt: 'tab_digest' },
]
const SCHEDULE_PATHS = SCHEDULE_TABS.map(t => t.to)

export default function ResearchShell({ children }) {
  const isMobile = useIsMobile()
  const { pathname } = useLocation()
  const isSchedule = SCHEDULE_PATHS.some(p => pathname.startsWith(p))
  const groupLabel = isSchedule ? '일정·인컴' : '리서치'
  const segTabs = isSchedule ? SCHEDULE_TABS : RESEARCH_TABS

  if (isMobile) return (
    <>
      <header className="appbar">
        {/* 모바일 하단 MobileNav 5섹션과 일치: 경로별 groupLabel(리서치/일정·인컴). PC 헤더와 동일 로직(task#178, task#175 F23 해소) */}
        <h1>{groupLabel}</h1>
      </header>
      <div className="seg-pad">
        <div className="seg">
          {segTabs.map(t => (
            <NavLink key={t.to} to={t.to}
              onClick={() => t.evt && trackEvent(t.evt)}
              className={({ isActive }) => isActive ? 'is-active' : ''}>
              {t.label}
            </NavLink>
          ))}
        </div>
      </div>
      {!isSchedule && (
        <div className="seg-pad">
          <GlobalSearch variant="bar" />
        </div>
      )}
      <div className="m-page">{children}</div>
    </>
  )

  // PC: 마스트헤드 2행(카테고리, groupLabel과 동일)·3행 서브바(activeLabel과 동일)가 이미 보여주므로
  // page-head 중복 표시 없이 children만 렌더한다(ADR-0026, task#191).
  return (
    <div className="page">
      {children}
    </div>
  )
}

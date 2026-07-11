import { useState } from 'react'
import { NavLink, Link, useLocation } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { trackEvent } from '../utils/analytics'
import { SearchIcon, HomeIcon, ChartIcon, CalendarIcon, GuruIcon, GearIcon, GridIcon, Caret } from './ui/icons'
import './Sidebar.css'

// 사이드바 IA (ADR-0025) — 섹션당 perm 1개, 단일항목 섹션은 헤더=링크
const SECTIONS = [
  {
    key: 'research', label: '리서치', perm: 'research', Icon: SearchIcon,
    items: [
      { to: '/reports', label: '리포트', evt: 'tab_reports' },
      { to: '/recommend', label: '추천' },
      { to: '/ranking', label: '랭킹', evt: 'tab_ranking' },
      { to: '/compare', label: '비교', evt: 'tab_compare' },
    ],
  },
  {
    key: 'portfolio', label: '포트폴리오', perm: 'portfolio', Icon: HomeIcon,
    items: [{ to: '/portfolio', label: '포트폴리오', evt: 'nav_portfolio' }],
  },
  {
    key: 'market', label: '시장', perm: 'market', Icon: ChartIcon,
    items: [
      { to: '/market/indicators', label: '시장지표', evt: 'nav_market' },
      { to: '/market/flow', label: '수급지표', evt: 'nav_market' },
    ],
  },
  {
    key: 'schedule', label: '일정·인컴', perm: 'research', Icon: CalendarIcon,
    items: [
      { to: '/calendar', label: '캘린더', evt: 'tab_calendar' },
      { to: '/dividends', label: '배당' },
      { to: '/digest', label: '다이제스트', evt: 'tab_digest' },
    ],
  },
  {
    key: 'guru', label: '구루', perm: 'guru', Icon: GuruIcon,
    items: [{ to: '/guru', label: '구루', evt: 'nav_guru' }],
  },
]

const linkClass = ({ isActive }) => 'sidebar-link' + (isActive ? ' is-active' : '')

function SectionGroup({ section, collapsed }) {
  const location = useLocation()
  const single = section.items.length === 1

  if (single) {
    const item = section.items[0]
    return (
      <NavLink to={item.to} className={linkClass} title={section.label}
        onClick={() => item.evt && trackEvent(item.evt)}>
        <section.Icon />
        {!collapsed && <span>{section.label}</span>}
      </NavLink>
    )
  }

  if (collapsed) {
    // 축소 모드: 섹션 아이콘 하나만 — 클릭 시 첫 항목으로 이동, 하위 항목 중 하나라도 활성이면 하이라이트
    const active = section.items.some(i => location.pathname.startsWith(i.to))
    return (
      <Link to={section.items[0].to} className={'sidebar-link' + (active ? ' is-active' : '')} title={section.label}>
        <section.Icon />
      </Link>
    )
  }

  return (
    <div className="sidebar-group">
      <div className="sidebar-group-head"><section.Icon /><span>{section.label}</span></div>
      <div className="sidebar-group-items">
        {section.items.map(item => (
          <NavLink key={item.to} to={item.to} className={linkClass}
            onClick={() => item.evt && trackEvent(item.evt)}>
            {item.label}
          </NavLink>
        ))}
      </div>
    </div>
  )
}

export default function Sidebar() {
  const { menuPermissions, role, loading } = useAuth() || { menuPermissions: [], role: null, loading: true }
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem('sidebar_collapsed') === '1')

  const toggle = () => setCollapsed(c => {
    const next = !c
    localStorage.setItem('sidebar_collapsed', next ? '1' : '0')
    return next
  })

  const sections = loading ? [] : SECTIONS.filter(s => menuPermissions.includes(s.perm))

  return (
    <aside className={'sidebar' + (collapsed ? ' is-collapsed' : '')}>
      <div className="sidebar-brand">
        <img src="/favicon.svg" className="brand-mark" alt="" />
        {!collapsed && <span>PortfoliOn</span>}
        <button className="sidebar-toggle" onClick={toggle} title={collapsed ? '펼치기' : '접기'}>
          <Caret dir={collapsed ? 'right' : 'left'} />
        </button>
      </div>
      <nav className="sidebar-nav">
        {sections.map(s => <SectionGroup key={s.key} section={s} collapsed={collapsed} />)}
      </nav>
      <div className="sidebar-bottom">
        {!loading && menuPermissions.includes('settings') && (
          <NavLink to="/settings" className={linkClass} title="설정"
            onClick={() => trackEvent('nav_settings')}>
            <GearIcon />
            {!collapsed && <span>설정</span>}
          </NavLink>
        )}
        {role === 'admin' && (
          <NavLink to="/admin-analytics" className={linkClass} title="행동"
            onClick={() => trackEvent('nav_analytics')}>
            <GridIcon />
            {!collapsed && <span>행동</span>}
          </NavLink>
        )}
      </div>
    </aside>
  )
}

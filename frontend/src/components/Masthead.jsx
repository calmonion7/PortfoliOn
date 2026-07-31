import { Link, NavLink, useLocation } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { trackEvent } from '../utils/analytics'
import { Sun, Moon, Refresh, LogOut, GearIcon, GridIcon } from './ui/icons'
import { IconResearch, IconPortfolio, IconMarket, IconCalendarIncome, IconGuru } from './sketches'
import GlobalSearch from './GlobalSearch'
import { NAV_SECTIONS, matchesSection, matchesItem } from '../navSections'
import './Masthead.css'

// 매거진 마스트헤드 카테고리 IA (ADR-0026) — 경로·라벨은 navSections.js 단일 소스에서 파생하고
// 여기선 섹션 key → 아이콘 매핑만 갖는다(아이콘 셋이 소비처마다 다르므로, task#251).
const ICONS = {
  research: IconResearch,
  portfolio: IconPortfolio,
  market: IconMarket,
  schedule: IconCalendarIncome,
  guru: IconGuru,
}

const adminLinkClass = ({ isActive }) => 'masthead-admin-link' + (isActive ? ' is-active' : '')

function CategoryLink({ section, isActive }) {
  const cls = 'masthead-cat' + (isActive ? ' is-active' : '')
  const Icon = ICONS[section.key]
  if (section.items.length === 1) {
    const item = section.items[0]
    return (
      <NavLink to={item.to} className={cls} onClick={() => item.evt && trackEvent(item.evt)}>
        <Icon size={18} />
        <span>{section.label}</span>
      </NavLink>
    )
  }
  return (
    <Link to={section.items[0].to} className={cls}>
      <Icon size={18} />
      <span>{section.label}</span>
    </Link>
  )
}

export default function Masthead({ theme, setTheme, onLogout }) {
  const { menuPermissions, role, loading } = useAuth() || { menuPermissions: [], role: null, loading: true }
  const location = useLocation()

  const sections = loading ? [] : NAV_SECTIONS.filter(s => menuPermissions.includes(s.perm))
  const activeSection = sections.find(s => matchesSection(location.pathname, s))
  const showSubbar = activeSection && activeSection.items.length >= 2

  return (
    <>
      <header className="masthead anim-fade-up">
        <div className="masthead-row1">
          <div className="masthead-brand">
            <img src="/favicon.svg" className="masthead-mark" alt="" />
            <span>PortfoliOn</span>
          </div>
          <div className="masthead-utils">
            <GlobalSearch variant="desktop" />
            <button className="icon-btn" title="새로고침" onClick={() => window.location.reload()}><Refresh /></button>
            <button className="theme-toggle" onClick={() => setTheme(t => t === 'dark' ? 'light' : 'dark')} title="테마">
              {theme === 'dark' ? <Sun /> : <Moon />}
            </button>
            <button className="icon-btn" title="로그아웃" onClick={onLogout}><LogOut /></button>
          </div>
        </div>
      </header>
      {/* .masthead(위 header)와 형제로 둬 .app-pc(전체 페이지 높이)를 containing block으로 삼는다 —
          .masthead 자식이면 그 짧은 높이가 containing block이 돼 sticky가 여유(slack) 없이 static처럼 동작한다(task#191). */}
      <div className="masthead-sticky">
        <nav className="masthead-nav">
          <div className="masthead-cats">
            {sections.map(s => (
              <CategoryLink key={s.key} section={s} isActive={activeSection?.key === s.key} />
            ))}
          </div>
          <div className="masthead-admin">
            {!loading && menuPermissions.includes('settings') && (
              <NavLink to="/settings" className={adminLinkClass} title="설정" onClick={() => trackEvent('nav_settings')}>
                <GearIcon />
              </NavLink>
            )}
            {role === 'admin' && (
              <NavLink to="/admin-analytics" className={adminLinkClass} title="행동" onClick={() => trackEvent('nav_analytics')}>
                <GridIcon />
              </NavLink>
            )}
          </div>
        </nav>
        {showSubbar && (
          <div className="masthead-subbar">
            {activeSection.items.map(item => (
              <NavLink key={item.to} to={item.to}
                className={'masthead-sublink' + (matchesItem(location.pathname, item) ? ' is-active' : '')}
                onClick={() => item.evt && trackEvent(item.evt)}>
                {item.label}
              </NavLink>
            ))}
          </div>
        )}
      </div>
    </>
  )
}

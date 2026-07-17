import { Link, NavLink, useLocation } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { trackEvent } from '../utils/analytics'
import { Sun, Moon, Refresh, LogOut, GearIcon, GridIcon } from './ui/icons'
import { IconResearch, IconPortfolio, IconMarket, IconCalendarIncome, IconGuru } from './sketches'
import GlobalSearch from './GlobalSearch'
import './Masthead.css'

// 매거진 마스트헤드 카테고리 IA (ADR-0026) — Sidebar(ADR-0025, 삭제됨)에서 그대로 이식.
// 섹션당 perm 1개, 단일항목 섹션은 헤더=링크.
const SECTIONS = [
  {
    key: 'research', label: '리서치', perm: 'research', Icon: IconResearch,
    items: [
      { to: '/reports', label: '리포트', evt: 'tab_reports' },
      { to: '/recommend', label: '추천' },
      { to: '/ranking', label: '랭킹', evt: 'tab_ranking' },
      { to: '/compare', label: '비교', evt: 'tab_compare' },
    ],
  },
  {
    key: 'portfolio', label: '포트폴리오', perm: 'portfolio', Icon: IconPortfolio,
    items: [{ to: '/portfolio', label: '포트폴리오', evt: 'nav_portfolio' }],
  },
  {
    key: 'market', label: '시장', perm: 'market', Icon: IconMarket,
    items: [
      { to: '/market/indicators', label: '시장지표', evt: 'nav_market' },
      { to: '/market/flow', label: '수급지표', evt: 'nav_market' },
    ],
  },
  {
    key: 'schedule', label: '일정·인컴', perm: 'research', Icon: IconCalendarIncome,
    items: [
      { to: '/calendar', label: '캘린더', evt: 'tab_calendar' },
      { to: '/dividends', label: '배당' },
      { to: '/digest', label: '다이제스트', evt: 'tab_digest' },
    ],
  },
  {
    key: 'guru', label: '구루', perm: 'guru', Icon: IconGuru,
    items: [{ to: '/guru', label: '구루', evt: 'nav_guru' }],
  },
]

const adminLinkClass = ({ isActive }) => 'masthead-admin-link' + (isActive ? ' is-active' : '')
const subLinkClass = ({ isActive }) => 'masthead-sublink' + (isActive ? ' is-active' : '')

function CategoryLink({ section, isActive }) {
  const cls = 'masthead-cat' + (isActive ? ' is-active' : '')
  if (section.items.length === 1) {
    const item = section.items[0]
    return (
      <NavLink to={item.to} className={cls} onClick={() => item.evt && trackEvent(item.evt)}>
        <section.Icon size={18} />
        <span>{section.label}</span>
      </NavLink>
    )
  }
  return (
    <Link to={section.items[0].to} className={cls}>
      <section.Icon size={18} />
      <span>{section.label}</span>
    </Link>
  )
}

export default function Masthead({ theme, setTheme, onLogout }) {
  const { menuPermissions, role, loading } = useAuth() || { menuPermissions: [], role: null, loading: true }
  const location = useLocation()

  const sections = loading ? [] : SECTIONS.filter(s => menuPermissions.includes(s.perm))
  const activeSection = sections.find(s => s.items.some(i => location.pathname.startsWith(i.to)))
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
              <NavLink key={item.to} to={item.to} className={subLinkClass}
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

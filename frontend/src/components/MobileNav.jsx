import { Link, useLocation } from 'react-router-dom'
import { HomeIcon, SearchIcon, ChartIcon, GuruIcon, CalendarIcon } from './ui/icons'
import { useAuth } from '../contexts/AuthContext'
import { trackEvent } from '../utils/analytics'

// PC 사이드바 5섹션(ADR-0025) 미러: 리서치·포트폴리오·시장·일정·인컴·구루 (task#178).
// 리서치=리포트/추천/랭킹/비교, 일정·인컴=캘린더/배당/다이제스트로 분리(둘 다 research 권한).
// 설정·admin은 하단 탭이 아니라 상단 mobile-header 진입점으로 이동.
// NavLink 기본 매칭(정확한 to prefix)으론 이 그룹핑이 안 되어 pathname 기반으로 직접 판정한다.
const RESEARCH_PATHS = ['/reports', '/recommend', '/ranking', '/compare']
const SCHEDULE_PATHS = ['/calendar', '/dividends', '/digest']

const ALL_TABS = [
  { to: '/reports',   label: '리서치',   key: 'research',  Icon: SearchIcon, match: p => RESEARCH_PATHS.some(r => p.startsWith(r)) },
  { to: '/portfolio', label: '포트폴리오', key: 'portfolio', Icon: HomeIcon,   match: p => p.startsWith('/portfolio') },
  { to: '/market/indicators', label: '시장', key: 'market', Icon: ChartIcon,  match: p => p.startsWith('/market') },
  { to: '/calendar',  label: '일정·인컴', key: 'research',  Icon: CalendarIcon, match: p => SCHEDULE_PATHS.some(r => p.startsWith(r)) },
  { to: '/guru',      label: '구루',     key: 'guru',      Icon: GuruIcon,   match: p => p.startsWith('/guru') },
]

export default function MobileNav() {
  const location = useLocation()
  const { menuPermissions, loading } = useAuth() || { menuPermissions: [], loading: true }
  const tabs = loading ? [] : ALL_TABS.filter(t => menuPermissions.includes(t.key))
  return (
    <nav className="tabbar">
      {tabs.map(({ to, label, Icon, key, match }) => (
        <Link key={to} to={to}
          onClick={() => trackEvent('nav_' + key)}
          className={match(location.pathname) ? 'is-active' : ''}>
          <Icon />
          <span>{label}</span>
        </Link>
      ))}
    </nav>
  )
}

import { Link, useLocation } from 'react-router-dom'
import { HomeIcon, SearchIcon, ChartIcon, GuruIcon, GearIcon, GridIcon } from './ui/icons'
import { useAuth } from '../contexts/AuthContext'
import { trackEvent } from '../utils/analytics'

// 리서치 탭은 7개 하위 라우트 전부에서, 시장 탭은 /market/* 전부에서 활성 표시(task#172 S3)
// — NavLink 기본 매칭(정확한 to prefix)으론 이 그룹핑이 안 되어 pathname 기반으로 직접 판정한다.
const RESEARCH_PATHS = ['/reports', '/recommend', '/ranking', '/compare', '/calendar', '/dividends', '/digest']

const ALL_TABS = [
  { to: '/reports',   label: '리서치',   key: 'research',  Icon: SearchIcon, match: p => RESEARCH_PATHS.some(r => p.startsWith(r)) },
  { to: '/portfolio', label: '포트폴리오', key: 'portfolio', Icon: HomeIcon,   match: p => p.startsWith('/portfolio') },
  { to: '/market/indicators', label: '시장', key: 'market', Icon: ChartIcon,  match: p => p.startsWith('/market') },
  { to: '/guru',      label: '구루',     key: 'guru',      Icon: GuruIcon,   match: p => p.startsWith('/guru') },
  { to: '/settings',  label: '설정',     key: 'settings',  Icon: GearIcon,   match: p => p.startsWith('/settings') },
]

export default function MobileNav() {
  const location = useLocation()
  const { menuPermissions, role, loading } = useAuth() || { menuPermissions: [], role: null, loading: true }
  const adminTabs = role === 'admin' ? [{ to: '/admin-analytics', label: '행동', key: 'analytics', Icon: GridIcon, match: p => p.startsWith('/admin-analytics') }] : []
  const tabs = loading ? [] : [...ALL_TABS.filter(t => menuPermissions.includes(t.key)), ...adminTabs]
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

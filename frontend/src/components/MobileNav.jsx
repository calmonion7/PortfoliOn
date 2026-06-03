import { NavLink } from 'react-router-dom'
import { HomeIcon, SearchIcon, ChartIcon, GuruIcon, GearIcon, GridIcon } from './ui/icons'
import { useAuth } from '../contexts/AuthContext'
import { trackEvent } from '../utils/analytics'

const ALL_TABS = [
  { to: '/',         label: '종목관리', key: 'portfolio', Icon: HomeIcon,   end: true },
  { to: '/research', label: '리서치',   key: 'research',  Icon: SearchIcon },
  { to: '/market',   label: '시장',     key: 'market',    Icon: ChartIcon },
  { to: '/guru',     label: '구루',     key: 'guru',      Icon: GuruIcon },
  { to: '/settings', label: '설정',     key: 'settings',  Icon: GearIcon },
]

export default function MobileNav() {
  const { menuPermissions, role, loading } = useAuth() || { menuPermissions: [], role: null, loading: true }
  const adminTabs = role === 'admin' ? [{ to: '/admin-analytics', label: '애널리틱스', key: 'analytics', Icon: GridIcon }] : []
  const tabs = loading ? [] : [...ALL_TABS.filter(t => menuPermissions.includes(t.key)), ...adminTabs]
  return (
    <nav className="tabbar">
      {tabs.map(({ to, label, Icon, end, key }) => (
        <NavLink key={to} to={to} end={end}
          onClick={() => trackEvent('nav_' + key)}
          className={({ isActive }) => isActive ? 'is-active' : ''}>
          <Icon />
          <span>{label}</span>
        </NavLink>
      ))}
    </nav>
  )
}

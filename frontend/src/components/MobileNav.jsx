import { NavLink } from 'react-router-dom'
import { HomeIcon, SearchIcon, ChartIcon, GuruIcon, GearIcon } from './ui/icons'
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
  const { menuPermissions, loading } = useAuth() || { menuPermissions: [], loading: true }
  const tabs = loading ? [] : ALL_TABS.filter(t => menuPermissions.includes(t.key))
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

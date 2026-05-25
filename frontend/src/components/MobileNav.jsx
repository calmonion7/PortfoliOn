import { NavLink } from 'react-router-dom'
import { HomeIcon, SearchIcon, ChartIcon, GridIcon, GearIcon } from './ui/icons'

const TABS = [
  { to: '/',         label: '종목관리', Icon: HomeIcon,   end: true },
  { to: '/research', label: '리서치',   Icon: SearchIcon },
  { to: '/market',   label: '시장',     Icon: ChartIcon },
  { to: '/analysis', label: '분석',     Icon: GridIcon },
  { to: '/settings', label: '설정',     Icon: GearIcon },
]

export default function MobileNav() {
  return (
    <nav className="tabbar">
      {TABS.map(({ to, label, Icon, end }) => (
        <NavLink key={to} to={to} end={end}
          className={({ isActive }) => isActive ? 'is-active' : ''}>
          <Icon />
          <span>{label}</span>
        </NavLink>
      ))}
    </nav>
  )
}

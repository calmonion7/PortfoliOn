import { Link, useLocation } from 'react-router-dom'
import { HomeIcon, SearchIcon, ChartIcon, GuruIcon, CalendarIcon } from './ui/icons'
import { useAuth } from '../contexts/AuthContext'
import { trackEvent } from '../utils/analytics'
import { NAV_SECTIONS, matchesSection } from '../navSections'

// 마스트헤드 IA 5섹션(ADR-0026) 하단 탭바: 경로·라벨은 navSections.js 단일 소스에서 파생하고
// 여기선 섹션 key → 아이콘 매핑만 갖는다(task#251). 설정·admin은 하단 탭이 아니라 상단 진입점.
// NavLink 기본 매칭(정확한 to prefix)으론 섹션 그룹핑이 안 되어 섹션 전체 항목으로 판정한다.
const ICONS = {
  research: SearchIcon,
  portfolio: HomeIcon,
  market: ChartIcon,
  schedule: CalendarIcon,
  guru: GuruIcon,
}

export default function MobileNav() {
  const location = useLocation()
  const { menuPermissions, loading } = useAuth() || { menuPermissions: [], loading: true }
  const tabs = loading ? [] : NAV_SECTIONS.filter(s => menuPermissions.includes(s.perm))
  return (
    <nav className="tabbar">
      {tabs.map(section => {
        const Icon = ICONS[section.key]
        return (
          <Link key={section.key} to={section.items[0].to}
            onClick={() => trackEvent('nav_' + section.perm)}
            className={matchesSection(location.pathname, section) ? 'is-active' : ''}>
            <Icon />
            <span>{section.label}</span>
          </Link>
        )
      })}
    </nav>
  )
}

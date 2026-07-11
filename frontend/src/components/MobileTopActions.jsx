import { Link } from 'react-router-dom'
import { GearIcon, GridIcon } from './ui/icons'
import { useAuth } from '../contexts/AuthContext'
import { trackEvent } from '../utils/analytics'

// 설정·admin은 하단 5탭에서 빠진 대신 모바일 상단바 진입점으로 노출(task#178).
// PC는 사이드바가 담당하므로 이 컴포넌트는 mobile-header(모바일 전용) 안에서만 렌더된다.
export default function MobileTopActions() {
  const { menuPermissions, role } = useAuth() || { menuPermissions: [], role: null }
  return (
    <>
      {menuPermissions.includes('settings') && (
        <Link to="/settings" className="icon-btn" title="설정" onClick={() => trackEvent('nav_settings')}>
          <GearIcon />
        </Link>
      )}
      {role === 'admin' && (
        <Link to="/admin-analytics" className="icon-btn" title="행동 분석" onClick={() => trackEvent('nav_analytics')}>
          <GridIcon />
        </Link>
      )}
    </>
  )
}

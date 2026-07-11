import { useState } from 'react'
import { Link } from 'react-router-dom'
import { MoreIcon } from './ui/icons'
import { useAuth } from '../contexts/AuthContext'
import { trackEvent } from '../utils/analytics'

// 설정·admin은 하단 5탭에서 빠진 대신 상단바 '더보기' 메뉴로 노출(task#178).
// 개별 아이콘 버튼은 GearIcon이 테마 Sun과 형태가 겹쳐(다크 기본) 혼동되므로,
// 텍스트 라벨 드롭다운으로 묶어 명확히 한다. PC는 사이드바가 담당(이 컴포넌트는 mobile-header 전용).
export default function MobileTopActions() {
  const { menuPermissions, role } = useAuth() || { menuPermissions: [], role: null }
  const [open, setOpen] = useState(false)
  const items = []
  if (menuPermissions.includes('settings')) items.push({ to: '/settings', label: '설정', evt: 'nav_settings' })
  if (role === 'admin') items.push({ to: '/admin-analytics', label: '행동 분석', evt: 'nav_analytics' })
  if (!items.length) return null
  return (
    <div className="more-menu">
      <button className="icon-btn" title="더보기" aria-label="더보기" aria-expanded={open} onClick={() => setOpen(o => !o)}>
        <MoreIcon />
      </button>
      {open && (
        <>
          <button className="more-backdrop" aria-hidden="true" tabIndex={-1} onClick={() => setOpen(false)} />
          <div className="more-pop" role="menu">
            {items.map(it => (
              <Link key={it.to} to={it.to} role="menuitem"
                onClick={() => { trackEvent(it.evt); setOpen(false) }}>{it.label}</Link>
            ))}
          </div>
        </>
      )}
    </div>
  )
}

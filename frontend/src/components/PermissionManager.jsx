import { useState, useEffect, useRef } from 'react'
import api from '../api'

const ALL_MENUS = ['portfolio', 'research', 'market', 'guru', 'settings']
const MENU_LABELS = {
  portfolio: '종목관리', research: '리서치', market: '시장',
  guru: '구루', settings: '설정',
}

function useIsMobile() {
  const [isMobile, setIsMobile] = useState(() => window.innerWidth < 768)
  useEffect(() => {
    const handler = () => setIsMobile(window.innerWidth < 768)
    window.addEventListener('resize', handler)
    return () => window.removeEventListener('resize', handler)
  }, [])
  return isMobile
}

// 칩 버튼: DefaultPermissionsSection + EditPanel + BottomSheet 에서 공유
function PermChip({ label, on, onClick }) {
  return (
    <button
      onClick={onClick}
      style={{
        padding: '5px 14px', borderRadius: 20, cursor: 'pointer', fontSize: 12, fontWeight: 600,
        background: on ? 'var(--text)' : 'transparent',
        color: on ? 'var(--bg)' : 'var(--text-3)',
        border: on ? '1px solid var(--text)' : '1px solid var(--border)',
        transition: 'all 0.15s',
      }}
    >
      {label}
    </button>
  )
}

// 읽기 전용 뱃지: 테이블 행 + 모바일 카드에서 공유
function PermBadges({ permissions }) {
  const active = ALL_MENUS.filter(m => permissions[m])
  if (active.length === 0)
    return <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>권한 없음</span>
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
      {active.map(m => (
        <span key={m} style={{
          fontSize: 11, padding: '2px 8px', borderRadius: 10,
          background: 'var(--accent-soft)', color: 'var(--text-2)',
        }}>
          {MENU_LABELS[m]}
        </span>
      ))}
    </div>
  )
}

export default function PermissionManager() {
  return <div>TODO</div>
}

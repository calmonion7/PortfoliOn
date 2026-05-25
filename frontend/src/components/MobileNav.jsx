// frontend/src/components/MobileNav.jsx
import { useState } from 'react'
import { NavLink } from 'react-router-dom'

const TAB_STYLE = (active) => ({
  flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center',
  justifyContent: 'center', gap: 2, padding: '6px 0',
  background: 'none', border: 'none', cursor: 'pointer',
  color: active ? 'var(--accent)' : 'var(--text-muted)',
  fontSize: 9, fontWeight: active ? 600 : 400,
})

const TABS = [
  { to: '/',         label: '종목관리', icon: '📊' },
  { to: '/research', label: '리서치',   icon: '📰' },
  { to: '/market',   label: '시장',     icon: '📈' },
  { to: '/analysis', label: '분석',     icon: '🔍' },
]

export default function MobileNav() {
  const [drawerOpen, setDrawerOpen] = useState(false)

  return (
    <>
      {/* 하단 탭 바 */}
      <nav className="mobile-only" style={{
        position: 'fixed', bottom: 0, left: 0, right: 0, zIndex: 200,
        background: 'var(--bg-nav)',
        borderTop: '2px solid var(--accent)', height: 56,
      }}>
        {TABS.map(({ to, label, icon }) => (
          <NavLink key={to} to={to} end={to === '/'} style={({ isActive }) => TAB_STYLE(isActive)}>
            <span style={{ fontSize: 16 }}>{icon}</span>
            {label}
          </NavLink>
        ))}
        <button style={TAB_STYLE(false)} onClick={() => setDrawerOpen(true)}>
          <span style={{ fontSize: 16 }}>⋯</span>
          더보기
        </button>
      </nav>

      {/* 더보기 드로어 */}
      {drawerOpen && (
        <div
          style={{ position: 'fixed', inset: 0, background: 'var(--overlay)', zIndex: 300 }}
          onClick={() => setDrawerOpen(false)}
        >
          <div
            style={{
              position: 'absolute', bottom: 0, left: 0, right: 0,
              background: 'var(--bg-surface)', borderRadius: '12px 12px 0 0',
              padding: '16px 0 72px',
            }}
            onClick={e => e.stopPropagation()}
          >
            {[
              { to: '/guru',     label: '구루',  icon: '👤' },
              { to: '/settings', label: '설정',  icon: '⚙️' },
            ].map(({ to, label, icon }) => (
              <NavLink
                key={to}
                to={to}
                onClick={() => setDrawerOpen(false)}
                style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '14px 24px',
                         color: 'var(--text)', textDecoration: 'none', fontSize: 15 }}
              >
                <span style={{ fontSize: 20 }}>{icon}</span> {label}
              </NavLink>
            ))}
          </div>
        </div>
      )}
    </>
  )
}

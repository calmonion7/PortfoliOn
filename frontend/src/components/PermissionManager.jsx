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

function DefaultPermissionsSection() {
  const [defaults, setDefaults] = useState(Object.fromEntries(ALL_MENUS.map(m => [m, false])))
  const [saved, setSaved] = useState(false)
  const timerRef = useRef(null)

  useEffect(() => {
    api.get('/api/admin/default-permissions').then(r => setDefaults(r.data))
  }, [])

  function toggle(menu) {
    const next = { ...defaults, [menu]: !defaults[menu] }
    setDefaults(next)
    clearTimeout(timerRef.current)
    timerRef.current = setTimeout(async () => {
      try {
        await api.put('/api/admin/default-permissions', { permissions: next })
        setSaved(true)
        setTimeout(() => setSaved(false), 2000)
      } catch (e) {
        console.error('기본 권한 저장 실패', e)
      }
    }, 500)
  }

  return (
    <div style={{ border: '1px solid var(--border)', borderRadius: 10, padding: '16px 20px', marginBottom: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <div>
          <div style={{ fontSize: 13, fontWeight: 600 }}>신규 가입 기본 권한</div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>새로 가입하는 사용자에게 자동으로 적용됩니다</div>
        </div>
        {saved && <span style={{ fontSize: 11, color: 'var(--text-2)' }}>저장됨 ✓</span>}
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        {ALL_MENUS.map(menu => (
          <PermChip
            key={menu}
            label={MENU_LABELS[menu]}
            on={defaults[menu]}
            onClick={() => toggle(menu)}
          />
        ))}
      </div>
    </div>
  )
}

export default function PermissionManager() {
  const isMobile = useIsMobile()
  const [users, setUsers] = useState([])
  const [search, setSearch] = useState('')
  const [renderCount, setRenderCount] = useState(20)
  const [selectedIds, setSelectedIds] = useState([])
  // null=패널닫힘 | User객체=단일편집 | 'bulk'=일괄
  const [editingUser, setEditingUser] = useState(null)
  const [pendingPerms, setPendingPerms] = useState({})
  const [saving, setSaving] = useState(false)
  const [savedMsg, setSavedMsg] = useState(false)
  const sentinelRef = useRef(null)

  useEffect(() => {
    api.get('/api/admin/users').then(r => setUsers(r.data))
  }, [])

  const normalUsers = users.filter(u => u.role !== 'admin')
  const adminUsers = users.filter(u => u.role === 'admin')
  const filtered = [...adminUsers, ...normalUsers].filter(u =>
    u.email.toLowerCase().includes(search.toLowerCase())
  )
  const displayed = filtered.slice(0, renderCount)

  useEffect(() => { setRenderCount(20) }, [search])

  useEffect(() => {
    if (!sentinelRef.current) return
    const obs = new IntersectionObserver(entries => {
      if (entries[0].isIntersecting) setRenderCount(c => c + 20)
    })
    obs.observe(sentinelRef.current)
    return () => obs.disconnect()
  }, [])

  function openEdit(user) {
    setEditingUser(user)
    setPendingPerms({ ...user.permissions })
    setSavedMsg(false)
  }

  function openBulk() {
    setEditingUser('bulk')
    setPendingPerms(Object.fromEntries(ALL_MENUS.map(m => [m, false])))
    setSavedMsg(false)
  }

  function closePanel() {
    setEditingUser(null)
    setPendingPerms({})
  }

  async function saveSingle() {
    setSaving(true)
    try {
      await api.put(`/api/admin/users/${editingUser.id}/permissions`, { permissions: pendingPerms })
      setUsers(prev => prev.map(u => u.id === editingUser.id ? { ...u, permissions: pendingPerms } : u))
      setSavedMsg(true)
      setTimeout(() => setSavedMsg(false), 2000)
    } catch {
      alert('권한 변경에 실패했습니다.')
    } finally {
      setSaving(false)
    }
  }

  async function saveBulk() {
    setSaving(true)
    try {
      await api.post('/api/admin/users/bulk-permissions', { user_ids: selectedIds, permissions: pendingPerms })
      const updated = await api.get('/api/admin/users')
      setUsers(updated.data)
      setSelectedIds([])
      closePanel()
    } catch {
      alert('일괄 권한 적용에 실패했습니다.')
    } finally {
      setSaving(false)
    }
  }

  async function deleteUser(user) {
    if (!window.confirm(`${user.email} 계정을 삭제하시겠습니까?\n모든 데이터가 삭제됩니다.`)) return
    await api.delete(`/api/admin/users/${user.id}`)
    setUsers(prev => prev.filter(u => u.id !== user.id))
    setSelectedIds(prev => prev.filter(id => id !== user.id))
    if (editingUser?.id === user.id) closePanel()
  }

  return (
    <div>
      <DefaultPermissionsSection />
      <div>검색+테이블 TODO</div>
      <div ref={sentinelRef} />
    </div>
  )
}

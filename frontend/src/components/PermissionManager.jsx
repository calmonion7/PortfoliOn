import { useState, useEffect } from 'react'
import api from '../api'

const ALL_MENUS = ['portfolio', 'research', 'market', 'guru', 'settings']
const MENU_LABELS = {
  portfolio: '종목관리', research: '리서치', market: '시장',
  guru: '구루', settings: '설정',
}

function ToggleBtn({ on, onClick }) {
  return (
    <button
      onClick={onClick}
      style={{
        padding: '4px 16px', borderRadius: 20, cursor: 'pointer', fontSize: 12, fontWeight: 600,
        background: on ? 'var(--text)' : 'transparent',
        color: on ? 'var(--bg)' : 'var(--text-3)',
        border: on ? '1px solid var(--text)' : '1px solid var(--border)',
        transition: 'all 0.15s',
        flexShrink: 0,
      }}
    >
      {on ? 'ON' : 'OFF'}
    </button>
  )
}

export default function PermissionManager() {
  const [users, setUsers] = useState([])
  const [selected, setSelected] = useState([])
  const [bulkPerms, setBulkPerms] = useState(
    Object.fromEntries(ALL_MENUS.map(m => [m, false]))
  )
  const [pendingPerms, setPendingPerms] = useState(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    api.get('/api/admin/users').then(r => setUsers(r.data))
  }, [])

  const normalUsers = users.filter(u => u.role !== 'admin')
  const allSelected = normalUsers.length > 0 && selected.length === normalUsers.length

  function toggleSelectAll() {
    setSelected(allSelected ? [] : normalUsers.map(u => u.id))
  }

  function toggleUser(id) {
    setSelected(prev =>
      prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
    )
  }

  const singleUser = selected.length === 1 ? users.find(u => u.id === selected[0]) : null

  useEffect(() => {
    if (singleUser) {
      setPendingPerms({ ...singleUser.permissions })
    } else {
      setPendingPerms(null)
    }
  }, [singleUser?.id])

  async function saveSinglePerms() {
    if (!singleUser || !pendingPerms) return
    setSaving(true)
    try {
      await api.put(`/api/admin/users/${singleUser.id}/permissions`, { permissions: pendingPerms })
      setUsers(prev => prev.map(u => u.id === singleUser.id
        ? { ...u, permissions: pendingPerms }
        : u
      ))
    } catch {
      alert('권한 변경에 실패했습니다.')
    } finally {
      setSaving(false)
    }
  }

  async function applyBulk() {
    setSaving(true)
    try {
      await api.post('/api/admin/users/bulk-permissions', {
        user_ids: selected,
        permissions: bulkPerms,
      })
      const updated = await api.get('/api/admin/users')
      setUsers(updated.data)
      setSelected([])
      setBulkPerms(Object.fromEntries(ALL_MENUS.map(m => [m, false])))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div style={{
      display: 'flex',
      border: '1px solid var(--border)',
      borderRadius: 10,
      overflow: 'hidden',
      minHeight: 360,
    }}>
      {/* Left panel */}
      <div style={{
        width: 240,
        flexShrink: 0,
        borderRight: '1px solid var(--border)',
        display: 'flex',
        flexDirection: 'column',
        padding: '16px 12px',
        gap: 4,
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
          <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>사용자</span>
          <button
            className="link-btn"
            onClick={toggleSelectAll}
            style={{ fontSize: 11, color: 'var(--accent)' }}
          >
            {allSelected ? '전체해제' : '전체선택'}
          </button>
        </div>

        {users.filter(u => u.role === 'admin').map(u => (
          <div key={u.id} style={{
            padding: '7px 10px',
            borderRadius: 6,
            background: 'var(--surface-2)',
            display: 'flex',
            alignItems: 'center',
            gap: 8,
          }}>
            <span style={{ fontSize: 13 }}>👑</span>
            <span style={{ fontSize: 12, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'var(--text-muted)' }}>{u.email}</span>
          </div>
        ))}

        {normalUsers.map(u => (
          <div
            key={u.id}
            onClick={() => toggleUser(u.id)}
            style={{
              padding: '7px 10px',
              borderRadius: 6,
              cursor: 'pointer',
              background: selected.includes(u.id) ? 'var(--accent-subtle)' : 'transparent',
              border: `1px solid ${selected.includes(u.id) ? 'var(--accent)' : 'transparent'}`,
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              transition: 'all 0.12s',
            }}
          >
            <div style={{
              width: 14, height: 14, borderRadius: 3, flexShrink: 0,
              background: selected.includes(u.id) ? 'var(--accent)' : 'transparent',
              border: `1.5px solid ${selected.includes(u.id) ? 'var(--accent)' : 'var(--border)'}`,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              {selected.includes(u.id) && <span style={{ color: '#fff', fontSize: 10, lineHeight: 1 }}>✓</span>}
            </div>
            <span style={{ fontSize: 12, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{u.email}</span>
          </div>
        ))}

        {selected.length > 1 && (
          <div style={{ fontSize: 11, color: 'var(--accent)', marginTop: 6, paddingLeft: 2 }}>{selected.length}명 선택됨</div>
        )}
      </div>

      {/* Right panel */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', padding: '16px 20px' }}>
        {selected.length === 0 && (
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <p style={{ color: 'var(--text-muted)', fontSize: 13 }}>왼쪽에서 사용자를 선택하세요</p>
          </div>
        )}

        {selected.length === 1 && singleUser && pendingPerms && (
          <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
            <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 16, paddingBottom: 12, borderBottom: '1px solid var(--border)' }}>
              {singleUser.email}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2, flex: 1 }}>
              {ALL_MENUS.map((menu, i) => (
                <div
                  key={menu}
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    padding: '10px 14px',
                    borderRadius: 6,
                    background: i % 2 === 0 ? 'var(--surface-2)' : 'transparent',
                  }}
                >
                  <span style={{ fontSize: 13 }}>{MENU_LABELS[menu]}</span>
                  <ToggleBtn
                    on={pendingPerms[menu]}
                    onClick={() => setPendingPerms(p => ({ ...p, [menu]: !p[menu] }))}
                  />
                </div>
              ))}
            </div>
            <div style={{ marginTop: 16, paddingTop: 14, borderTop: '1px solid var(--border)' }}>
              <button
                onClick={saveSinglePerms}
                disabled={saving}
                style={{
                  width: '100%', padding: '10px',
                  borderRadius: 6, border: 'none', cursor: saving ? 'default' : 'pointer',
                  background: 'var(--text)', color: 'var(--bg)',
                  fontWeight: 600, fontSize: 13,
                  opacity: saving ? 0.6 : 1,
                  transition: 'opacity 0.15s',
                }}
              >
                {saving ? '저장 중...' : '저장'}
              </button>
            </div>
          </div>
        )}

        {selected.length > 1 && (
          <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
            <div style={{ marginBottom: 16, paddingBottom: 12, borderBottom: '1px solid var(--border)' }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--accent)' }}>{selected.length}명에게 일괄 적용</div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 3 }}>선택한 사용자 전체에 동일하게 적용됩니다</div>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2, flex: 1 }}>
              {ALL_MENUS.map((menu, i) => (
                <div
                  key={menu}
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    padding: '10px 14px',
                    borderRadius: 6,
                    background: i % 2 === 0 ? 'var(--surface-2)' : 'transparent',
                  }}
                >
                  <span style={{ fontSize: 13 }}>{MENU_LABELS[menu]}</span>
                  <ToggleBtn
                    on={bulkPerms[menu]}
                    onClick={() => setBulkPerms(p => ({ ...p, [menu]: !p[menu] }))}
                  />
                </div>
              ))}
            </div>
            <div style={{ marginTop: 16, paddingTop: 14, borderTop: '1px solid var(--border)' }}>
              <button
                onClick={applyBulk}
                disabled={saving}
                style={{
                  width: '100%', padding: '10px',
                  borderRadius: 6, border: 'none', cursor: saving ? 'default' : 'pointer',
                  background: 'var(--text)', color: 'var(--bg)',
                  fontWeight: 600, fontSize: 13,
                  opacity: saving ? 0.6 : 1,
                }}
              >
                {saving ? '적용 중...' : `${selected.length}명에게 적용`}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

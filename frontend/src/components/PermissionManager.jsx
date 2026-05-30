import { useState, useEffect } from 'react'
import api from '../api'

const ALL_MENUS = ['portfolio', 'research', 'market', 'analysis', 'guru', 'settings']
const MENU_LABELS = {
  portfolio: '종목관리', research: '리서치', market: '시장',
  analysis: '분석', guru: '구루', settings: '설정',
}

export default function PermissionManager() {
  const [users, setUsers] = useState([])
  const [selected, setSelected] = useState([])
  const [bulkPerms, setBulkPerms] = useState(
    Object.fromEntries(ALL_MENUS.map(m => [m, false]))
  )
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

  async function toggleSinglePerm(userId, menu, currentVal) {
    const user = users.find(u => u.id === userId)
    const newPerms = { ...user.permissions, [menu]: !currentVal }
    await api.put(`/api/admin/users/${userId}/permissions`, { permissions: newPerms })
    setUsers(prev => prev.map(u => u.id === userId
      ? { ...u, permissions: newPerms }
      : u
    ))
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
    } finally {
      setSaving(false)
    }
  }

  const singleUser = selected.length === 1 ? users.find(u => u.id === selected[0]) : null

  return (
    <div style={{ display: 'flex', gap: 16, minHeight: 400 }}>
      {/* Left panel */}
      <div style={{ width: 220, flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
          <span style={{ fontSize: 12, color: 'var(--text-muted)', textTransform: 'uppercase' }}>사용자</span>
          <button className="link-btn" onClick={toggleSelectAll} style={{ fontSize: 12 }}>
            {allSelected ? '전체해제' : '전체선택'}
          </button>
        </div>
        {users.filter(u => u.role === 'admin').map(u => (
          <div key={u.id} style={{ padding: '6px 10px', borderRadius: 6, background: 'var(--surface-2)', display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 12 }}>👑</span>
            <span style={{ fontSize: 13, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{u.email}</span>
          </div>
        ))}
        {normalUsers.map(u => (
          <div
            key={u.id}
            onClick={() => toggleUser(u.id)}
            style={{
              padding: '6px 10px', borderRadius: 6, cursor: 'pointer',
              background: selected.includes(u.id) ? 'var(--accent-subtle)' : 'var(--surface-2)',
              border: selected.includes(u.id) ? '1px solid var(--accent)' : '1px solid transparent',
              display: 'flex', alignItems: 'center', gap: 8,
            }}
          >
            <div style={{
              width: 14, height: 14, borderRadius: 3, flexShrink: 0,
              background: selected.includes(u.id) ? 'var(--accent)' : 'transparent',
              border: `1px solid ${selected.includes(u.id) ? 'var(--accent)' : 'var(--border)'}`,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              {selected.includes(u.id) && <span style={{ color: '#fff', fontSize: 10, lineHeight: 1 }}>✓</span>}
            </div>
            <span style={{ fontSize: 13, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{u.email}</span>
          </div>
        ))}
        {selected.length > 1 && (
          <div style={{ fontSize: 12, color: 'var(--accent)', marginTop: 4 }}>{selected.length}명 선택됨</div>
        )}
      </div>

      {/* Right panel */}
      <div style={{ flex: 1 }}>
        {selected.length === 0 && (
          <p style={{ color: 'var(--text-muted)', fontSize: 13 }}>왼쪽에서 사용자를 선택하세요</p>
        )}

        {selected.length === 1 && singleUser && (
          <>
            <div style={{ fontWeight: 600, marginBottom: 12 }}>{singleUser.email}</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {ALL_MENUS.map(menu => (
                <div
                  key={menu}
                  style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 12px', borderRadius: 6, background: 'var(--surface-2)' }}
                >
                  <span>{MENU_LABELS[menu]}</span>
                  <button
                    onClick={() => toggleSinglePerm(singleUser.id, menu, singleUser.permissions[menu])}
                    style={{
                      padding: '3px 14px', borderRadius: 20, border: 'none', cursor: 'pointer', fontSize: 12, fontWeight: 600,
                      background: singleUser.permissions[menu] ? 'var(--accent)' : 'var(--surface-3)',
                      color: singleUser.permissions[menu] ? '#fff' : 'var(--text-muted)',
                    }}
                  >
                    {singleUser.permissions[menu] ? 'ON' : 'OFF'}
                  </button>
                </div>
              ))}
            </div>
          </>
        )}

        {selected.length > 1 && (
          <>
            <div style={{ fontWeight: 600, marginBottom: 4, color: 'var(--accent)' }}>{selected.length}명에게 일괄 적용</div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 12 }}>아래 권한을 선택한 사용자 전체에 적용합니다</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {ALL_MENUS.map(menu => (
                <div
                  key={menu}
                  style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 12px', borderRadius: 6, background: 'var(--surface-2)' }}
                >
                  <span>{MENU_LABELS[menu]}</span>
                  <button
                    onClick={() => setBulkPerms(p => ({ ...p, [menu]: !p[menu] }))}
                    style={{
                      padding: '3px 14px', borderRadius: 20, border: 'none', cursor: 'pointer', fontSize: 12, fontWeight: 600,
                      background: bulkPerms[menu] ? 'var(--accent)' : 'var(--surface-3)',
                      color: bulkPerms[menu] ? '#fff' : 'var(--text-muted)',
                    }}
                  >
                    {bulkPerms[menu] ? 'ON' : 'OFF'}
                  </button>
                </div>
              ))}
            </div>
            <button
              onClick={applyBulk}
              disabled={saving}
              style={{ marginTop: 16, width: '100%', padding: '10px', borderRadius: 6, border: 'none', cursor: 'pointer', background: 'var(--accent)', color: '#fff', fontWeight: 600, fontSize: 14 }}
            >
              {saving ? '적용 중...' : `${selected.length}명에게 적용`}
            </button>
          </>
        )}
      </div>
    </div>
  )
}

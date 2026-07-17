import { useState, useEffect, useRef } from 'react'
import api from '../api'
import { useToast } from './Toast'
import useIsMobile from '../hooks/useIsMobile'
import Input from './ui/Input'
import EditPanel, { ALL_MENUS, MENU_LABELS, PermChip, PermBadges, DefaultPermissionsSection } from './PermissionPanel'

export default function PermissionManager() {
  const isMobile = useIsMobile()
  const { showToast } = useToast()
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
  const savedMsgTimerRef = useRef(null)

  useEffect(() => {
    api.get('/api/admin/users').then(r => setUsers(r.data))
  }, [])

  const normalUsers = users.filter(u => u.role !== 'admin')
  const adminUsers = users.filter(u => u.role === 'admin')
  const filtered = [...adminUsers, ...normalUsers].filter(u =>
    u.email.toLowerCase().includes(search.toLowerCase())
  )
  const displayed = filtered.slice(0, renderCount)
  const filteredNormalUsers = normalUsers.filter(u =>
    u.email.toLowerCase().includes(search.toLowerCase())
  )

  useEffect(() => { setRenderCount(20) }, [search])

  useEffect(() => {
    return () => clearTimeout(savedMsgTimerRef.current)
  }, [])

  useEffect(() => {
    if (!sentinelRef.current) return
    const obs = new IntersectionObserver(entries => {
      if (entries[0].isIntersecting) setRenderCount(c => c + 20)
    })
    obs.observe(sentinelRef.current)
    return () => obs.disconnect()
  }, [isMobile])

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
      clearTimeout(savedMsgTimerRef.current)
      savedMsgTimerRef.current = setTimeout(() => setSavedMsg(false), 2000)
    } catch {
      showToast('권한 변경에 실패했습니다.', 'error')
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
      showToast(`${selectedIds.length}명 권한을 일괄 적용했습니다.`, 'success')
      setSelectedIds([])
      closePanel()
    } catch {
      showToast('일괄 권한 적용에 실패했습니다.', 'error')
    } finally {
      setSaving(false)
    }
  }

  async function deleteUser(user) {
    if (!window.confirm(`${user.email} 계정을 삭제하시겠습니까?\n모든 데이터가 삭제됩니다.`)) return
    try {
      await api.delete(`/api/admin/users/${user.id}`)
      setUsers(prev => prev.filter(u => u.id !== user.id))
      setSelectedIds(prev => prev.filter(id => id !== user.id))
      if (editingUser?.id === user.id) closePanel()
      showToast(`${user.email} 계정을 삭제했습니다.`, 'success')
    } catch {
      showToast('사용자 삭제에 실패했습니다.', 'error')
    }
  }

  const allNormalSelected = filteredNormalUsers.length > 0 && filteredNormalUsers.every(u => selectedIds.includes(u.id))

  const SearchAndTable = (
    <div>
      {/* 검색창 */}
      <div style={{ padding: '10px 14px', borderBottom: '1px solid var(--border)' }}>
        <Input value={search} onChange={e => setSearch(e.target.value)} placeholder="이메일로 검색..." />
      </div>

      {/* 다중선택 액션바 */}
      {selectedIds.length > 0 && (
        <div style={{
          padding: '8px 14px', background: 'var(--accent-soft)',
          borderBottom: '1px solid var(--border)',
          display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap',
        }}>
          <span style={{ fontSize: 12, fontWeight: 600 }}>{selectedIds.length}명 선택됨</span>
          <button className="link-btn" onClick={() => setSelectedIds(filteredNormalUsers.map(u => u.id))} style={{ fontSize: 12 }}>전체선택</button>
          <button className="link-btn" onClick={() => setSelectedIds([])} style={{ fontSize: 12 }}>선택해제</button>
          <button
            onClick={openBulk}
            style={{
              marginLeft: 'auto', padding: '5px 14px', borderRadius: 6, border: 'none',
              background: 'var(--text)', color: 'var(--bg)', fontSize: 12, fontWeight: 600, cursor: 'pointer',
            }}
          >
            일괄 권한 적용 →
          </button>
        </div>
      )}

      {/* 테이블 헤더 */}
      <div style={{
        display: 'grid', gridTemplateColumns: '36px 1fr auto 60px',
        padding: '12px 14px', borderBottom: '1px solid var(--border)',
        fontSize: 11.5, fontWeight: 500, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em',
      }}>
        <div>
          <input
            type="checkbox"
            checked={allNormalSelected}
            onChange={() => setSelectedIds(allNormalSelected ? [] : filteredNormalUsers.map(u => u.id))}
            style={{ cursor: 'pointer' }}
          />
        </div>
        <div>이메일</div>
        <div>권한</div>
        <div />
      </div>

      {/* 테이블 행 */}
      {displayed.map((u) => {
        const isAdmin = u.role === 'admin'
        const isSelected = selectedIds.includes(u.id)
        return (
          <div
            key={u.id}
            className="admin-row"
            style={{
              display: 'grid', gridTemplateColumns: '36px 1fr auto 60px',
              padding: '10px 14px', alignItems: 'center',
              ...(isSelected && { background: 'var(--accent-soft)' }),
              borderBottom: '1px solid var(--border)',
            }}
          >
            {/* 체크박스 */}
            <div>
              {!isAdmin && (
                <input
                  type="checkbox"
                  checked={isSelected}
                  onChange={() => setSelectedIds(prev =>
                    prev.includes(u.id) ? prev.filter(id => id !== u.id) : [...prev, u.id]
                  )}
                  style={{ cursor: 'pointer' }}
                />
              )}
              {isAdmin && <span style={{ fontSize: 14 }}>👑</span>}
            </div>

            {/* 이메일 */}
            <div style={{ fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {u.email}
            </div>

            {/* 권한 뱃지 */}
            <div style={{ paddingRight: 12 }}>
              {isAdmin
                ? <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>전체 허용</span>
                : <PermBadges permissions={u.permissions} />
              }
            </div>

            {/* 편집/삭제 */}
            <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end', alignItems: 'center' }}>
              {!isAdmin && (
                <>
                  <button
                    onClick={() => openEdit(u)}
                    style={{
                      padding: '4px 10px', borderRadius: 5, border: '1px solid var(--border)',
                      background: 'transparent', fontSize: 12, cursor: 'pointer', color: 'var(--text)',
                    }}
                  >
                    편집
                  </button>
                  {!u.oauth_provider && (
                    <button
                      onClick={() => deleteUser(u)}
                      style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-error)', fontSize: 16, lineHeight: 1, padding: '0 2px' }}
                      title="삭제"
                    >×</button>
                  )}
                </>
              )}
            </div>
          </div>
        )
      })}

      {/* 무한스크롤 sentinel */}
      <div ref={sentinelRef} style={{ height: 1 }} />
    </div>
  )

  const panelOpen = editingUser !== null

  // 일괄 모드일 때 selectedIds.length 를 pendingPerms에 임시 첨부 (EditPanel 타이틀용)
  const panelPerms = editingUser === 'bulk'
    ? { ...pendingPerms, _count: selectedIds.length }
    : pendingPerms

  return (
    <div>
      <DefaultPermissionsSection />

      {!isMobile && (
        <div style={{
          display: 'grid',
          gridTemplateColumns: panelOpen ? '60% 40%' : '100%',
          transition: 'grid-template-columns 0.2s ease',
          border: '1px solid var(--border)', borderRadius: 10, overflow: 'hidden',
        }}>
          <div style={{ minWidth: 0 }}>
            {SearchAndTable}
          </div>
          {panelOpen && (
            <EditPanel
              editingUser={editingUser}
              pendingPerms={panelPerms}
              setPendingPerms={setPendingPerms}
              onSave={editingUser === 'bulk' ? saveBulk : saveSingle}
              onClose={closePanel}
              saving={saving}
              savedMsg={savedMsg}
            />
          )}
        </div>
      )}

      {isMobile && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {/* 검색창 */}
          <div style={{ border: '1px solid var(--border)', borderRadius: 10, padding: '10px 14px' }}>
            <Input value={search} onChange={e => setSearch(e.target.value)} placeholder="이메일로 검색..." />
          </div>

          {/* 아코디언 카드 리스트 */}
          {displayed.map(u => {
            const isAdmin = u.role === 'admin'
            const isExpanded = editingUser?.id === u.id
            return (
              <div key={u.id} style={{ border: `1px solid ${isExpanded ? 'var(--text)' : 'var(--border)'}`, borderRadius: 10, overflow: 'hidden', transition: 'border-color 0.15s' }}>
                {/* 카드 헤더 */}
                <div
                  onClick={() => { if (!isAdmin) isExpanded ? closePanel() : openEdit(u) }}
                  style={{
                    padding: '12px 14px', cursor: isAdmin ? 'default' : 'pointer',
                    background: isExpanded ? 'var(--accent-soft)' : 'transparent',
                    display: 'flex', flexDirection: 'column', gap: 6,
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    {isAdmin && <span style={{ fontSize: 14 }}>👑</span>}
                    <span style={{ fontSize: 13, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
                      {u.email}
                    </span>
                    {!isAdmin && <span style={{ fontSize: 11, color: 'var(--text-muted)', flexShrink: 0 }}>{isExpanded ? '▲' : '▼'}</span>}
                  </div>
                  {!isExpanded && (
                    <div>
                      {isAdmin
                        ? <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>전체 허용</span>
                        : <PermBadges permissions={u.permissions} />
                      }
                    </div>
                  )}
                </div>

                {/* 아코디언 확장 영역 */}
                {isExpanded && (
                  <div style={{ padding: '14px', borderTop: '1px solid var(--border)', display: 'flex', flexDirection: 'column', gap: 14 }}>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                      {ALL_MENUS.map(menu => (
                        <PermChip
                          key={menu}
                          label={MENU_LABELS[menu]}
                          on={pendingPerms[menu]}
                          onClick={() => setPendingPerms(p => ({ ...p, [menu]: !p[menu] }))}
                        />
                      ))}
                    </div>
                    <button
                      onClick={saveSingle}
                      disabled={saving}
                      style={{
                        width: '100%', padding: '11px', borderRadius: 8, border: 'none',
                        background: savedMsg ? 'var(--accent-soft)' : 'var(--text)',
                        color: savedMsg ? 'var(--text)' : 'var(--bg)',
                        fontWeight: 600, fontSize: 13,
                        cursor: saving ? 'default' : 'pointer', opacity: saving ? 0.6 : 1,
                        transition: 'all 0.2s',
                      }}
                    >
                      {savedMsg ? '저장됨 ✓' : saving ? '저장 중...' : '저장'}
                    </button>
                  </div>
                )}
              </div>
            )
          })}

          {/* 무한스크롤 sentinel (모바일) */}
          <div ref={sentinelRef} style={{ height: 1 }} />
        </div>
      )}
    </div>
  )
}

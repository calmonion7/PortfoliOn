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

function EditPanel({ editingUser, pendingPerms, setPendingPerms, onSave, onClose, saving, savedMsg }) {
  const isBulk = editingUser === 'bulk'
  const title = isBulk
    ? `${pendingPerms._count ?? ''}명에게 일괄 적용`
    : editingUser?.email ?? ''

  return (
    <div style={{
      borderLeft: '1px solid var(--border)',
      padding: '16px 20px',
      display: 'flex', flexDirection: 'column', gap: 16,
      minWidth: 0,
    }}>
      {/* 헤더 */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <div style={{ fontSize: 13, fontWeight: 600, wordBreak: 'break-all' }}>{title}</div>
          {isBulk && (
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 3 }}>
              선택한 사용자 전체에 동일하게 적용됩니다
            </div>
          )}
        </div>
        <button
          onClick={onClose}
          style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 18, color: 'var(--text-3)', lineHeight: 1, flexShrink: 0, marginLeft: 8 }}
        >×</button>
      </div>

      {/* 권한 칩 */}
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

      {/* 저장 버튼 */}
      <button
        onClick={onSave}
        disabled={saving}
        style={{
          width: '100%', padding: '10px', borderRadius: 8, border: 'none',
          background: savedMsg ? 'var(--accent-soft)' : 'var(--text)',
          color: savedMsg ? 'var(--text)' : 'var(--bg)',
          fontWeight: 600, fontSize: 13,
          cursor: saving ? 'default' : 'pointer', opacity: saving ? 0.6 : 1,
          transition: 'all 0.2s',
        }}
      >
        {savedMsg ? '저장됨 ✓' : saving ? '저장 중...' : isBulk ? '적용' : '저장'}
      </button>
    </div>
  )
}

function BottomSheet({ user, perms, setPerms, onSave, onClose, saving, savedMsg }) {
  if (!user) return null
  return (
    <>
      {/* 딤 배경 */}
      <div
        onClick={onClose}
        style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 100,
        }}
      />
      {/* 시트 */}
      <div style={{
        position: 'fixed', bottom: 0, left: 0, right: 0, zIndex: 101,
        background: 'var(--bg)', borderRadius: '16px 16px 0 0',
        padding: '20px 20px 32px',
        boxShadow: '0 -4px 24px rgba(0,0,0,0.15)',
        display: 'flex', flexDirection: 'column', gap: 16,
      }}>
        {/* 핸들 */}
        <div style={{ width: 36, height: 4, borderRadius: 2, background: 'var(--border)', margin: '0 auto -8px' }} />

        {/* 이메일 */}
        <div style={{ fontSize: 13, fontWeight: 600, wordBreak: 'break-all', textAlign: 'center' }}>
          {user.email}
        </div>

        {/* 권한 칩 */}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, justifyContent: 'center' }}>
          {ALL_MENUS.map(menu => (
            <PermChip
              key={menu}
              label={MENU_LABELS[menu]}
              on={perms[menu]}
              onClick={() => setPerms(p => ({ ...p, [menu]: !p[menu] }))}
            />
          ))}
        </div>

        {/* 저장 버튼 */}
        <button
          onClick={onSave}
          disabled={saving}
          style={{
            width: '100%', padding: '12px', borderRadius: 10, border: 'none',
            background: savedMsg ? 'var(--accent-soft)' : 'var(--text)',
            color: savedMsg ? 'var(--text)' : 'var(--bg)',
            fontWeight: 600, fontSize: 14,
            cursor: saving ? 'default' : 'pointer', opacity: saving ? 0.6 : 1,
          }}
        >
          {savedMsg ? '저장됨 ✓' : saving ? '저장 중...' : '저장'}
        </button>
      </div>
    </>
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

  const allNormalSelected = normalUsers.length > 0 && normalUsers.every(u => selectedIds.includes(u.id))

  const SearchAndTable = (
    <div>
      {/* 검색창 */}
      <div style={{ padding: '10px 14px', borderBottom: '1px solid var(--border)' }}>
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="이메일로 검색..."
          style={{
            width: '100%', padding: '7px 10px', borderRadius: 6, fontSize: 13,
            border: '1px solid var(--border)', background: 'var(--surface-2)',
            color: 'var(--text)', boxSizing: 'border-box',
          }}
        />
      </div>

      {/* 다중선택 액션바 */}
      {selectedIds.length > 0 && (
        <div style={{
          padding: '8px 14px', background: 'var(--accent-soft)',
          borderBottom: '1px solid var(--border)',
          display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap',
        }}>
          <span style={{ fontSize: 12, fontWeight: 600 }}>{selectedIds.length}명 선택됨</span>
          <button className="link-btn" onClick={() => setSelectedIds(normalUsers.map(u => u.id))} style={{ fontSize: 12 }}>전체선택</button>
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
        padding: '8px 14px', borderBottom: '1px solid var(--border)',
        fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em',
      }}>
        <div>
          <input
            type="checkbox"
            checked={allNormalSelected}
            onChange={() => setSelectedIds(allNormalSelected ? [] : normalUsers.map(u => u.id))}
            style={{ cursor: 'pointer' }}
          />
        </div>
        <div>이메일</div>
        <div>권한</div>
        <div />
      </div>

      {/* 테이블 행 */}
      {displayed.map((u, i) => {
        const isAdmin = u.role === 'admin'
        const isSelected = selectedIds.includes(u.id)
        return (
          <div
            key={u.id}
            style={{
              display: 'grid', gridTemplateColumns: '36px 1fr auto 60px',
              padding: '10px 14px', alignItems: 'center',
              background: isSelected ? 'var(--accent-soft)' : i % 2 === 1 ? 'var(--surface-2)' : 'transparent',
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
                      style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--down)', fontSize: 16, lineHeight: 1, padding: '0 2px' }}
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
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="이메일로 검색..."
              style={{
                width: '100%', padding: '7px 10px', borderRadius: 6, fontSize: 13,
                border: '1px solid var(--border)', background: 'var(--surface-2)',
                color: 'var(--text)', boxSizing: 'border-box',
              }}
            />
          </div>

          {/* 카드 리스트 */}
          {displayed.map(u => {
            const isAdmin = u.role === 'admin'
            return (
              <div
                key={u.id}
                onClick={() => { if (!isAdmin) openEdit(u) }}
                style={{
                  border: '1px solid var(--border)', borderRadius: 10, padding: '12px 14px',
                  cursor: isAdmin ? 'default' : 'pointer',
                  display: 'flex', flexDirection: 'column', gap: 6,
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  {isAdmin && <span style={{ fontSize: 14 }}>👑</span>}
                  <span style={{ fontSize: 13, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {u.email}
                  </span>
                </div>
                <div>
                  {isAdmin
                    ? <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>전체 허용</span>
                    : <PermBadges permissions={u.permissions} />
                  }
                </div>
              </div>
            )
          })}

          {/* 무한스크롤 sentinel (모바일) */}
          <div ref={sentinelRef} style={{ height: 1 }} />

          {/* 바텀 시트 */}
          <BottomSheet
            user={editingUser !== 'bulk' ? editingUser : null}
            perms={pendingPerms}
            setPerms={setPendingPerms}
            onSave={saveSingle}
            onClose={closePanel}
            saving={saving}
            savedMsg={savedMsg}
          />
        </div>
      )}
    </div>
  )
}

import { useState, useEffect, useRef } from 'react'
import api from '../api'
import { useToast } from './Toast'

export const ALL_MENUS = ['portfolio', 'research', 'market', 'guru', 'settings']
export const MENU_LABELS = {
  portfolio: '종목관리', research: '리서치', market: '시장',
  guru: '구루', settings: '설정',
}

export function PermChip({ label, on, onClick }) {
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

export function PermBadges({ permissions }) {
  const active = ALL_MENUS.filter(m => permissions?.[m])
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

export function DefaultPermissionsSection() {
  const [defaults, setDefaults] = useState(Object.fromEntries(ALL_MENUS.map(m => [m, false])))
  const [saved, setSaved] = useState(false)
  const timerRef = useRef(null)
  const savedTimerRef = useRef(null)
  const { showToast } = useToast()

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
        clearTimeout(savedTimerRef.current)
        savedTimerRef.current = setTimeout(() => setSaved(false), 2000)
      } catch (e) {
        console.error('[PermissionPanel] 기본 권한 저장(/admin/default-permissions) 실패', e)
        showToast('기본 권한 저장에 실패했습니다.', 'error')
        api.get('/api/admin/default-permissions').then(r => setDefaults(r.data))
      }
    }, 500)
  }

  useEffect(() => {
    return () => {
      clearTimeout(timerRef.current)
      clearTimeout(savedTimerRef.current)
    }
  }, [])

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

export default function EditPanel({ editingUser, pendingPerms, setPendingPerms, onSave, onClose, saving, savedMsg }) {
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

export function BottomSheet({ user, perms, setPerms, onSave, onClose, saving, savedMsg }) {
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

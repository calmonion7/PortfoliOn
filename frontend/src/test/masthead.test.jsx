import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

const authMock = vi.fn()
vi.mock('../contexts/AuthContext', () => ({
  useAuth: () => authMock(),
}))
vi.mock('../utils/analytics', () => ({ trackEvent: vi.fn() }))
vi.mock('../api', () => ({
  default: { get: vi.fn() },
}))

import Masthead from '../components/Masthead'
import { ToastProvider } from '../components/Toast'

const noop = () => {}

// Masthead가 흡수한 GlobalSearch(desktop)가 useToast()를 쓰므로 ToastProvider로 감싼다.
function renderMasthead(ui) {
  return render(<ToastProvider><MemoryRouter>{ui}</MemoryRouter></ToastProvider>)
}

// task#191(ADR-0026): Sidebar(ADR-0025, 삭제됨) 대체 후 마스트헤드가 동일한
// useAuth().menuPermissions/role 권한 매핑을 따르는지 검증.
describe('Masthead 권한별 카테고리 노출', () => {
  it('research·portfolio 권한만 있으면 해당 카테고리만 보이고 시장/구루/설정/행동은 숨는다', () => {
    authMock.mockReturnValue({ menuPermissions: ['research', 'portfolio'], role: 'user', loading: false })
    renderMasthead(<Masthead theme="light" setTheme={noop} onLogout={noop} />)
    // 카테고리 아이콘(sketches/Icon*)의 <title>도 같은 라벨 텍스트라 span으로 좁힌다.
    expect(screen.getByText('리서치', { selector: 'span' })).toBeInTheDocument()
    expect(screen.getByText('포트폴리오', { selector: 'span' })).toBeInTheDocument()
    expect(screen.queryByText('시장')).toBeNull()
    expect(screen.queryByText('구루')).toBeNull()
    expect(screen.queryByTitle('설정')).toBeNull()
    expect(screen.queryByTitle('행동')).toBeNull()
  })

  it('role=admin이면 menuPermissions와 무관하게 행동(관리자) 링크가 노출된다', () => {
    authMock.mockReturnValue({ menuPermissions: [], role: 'admin', loading: false })
    renderMasthead(<Masthead theme="light" setTheme={noop} onLogout={noop} />)
    expect(screen.getByTitle('행동')).toBeInTheDocument()
  })

  it('loading 중에는 카테고리가 렌더되지 않는다', () => {
    authMock.mockReturnValue({ menuPermissions: ['research'], role: 'user', loading: true })
    renderMasthead(<Masthead theme="light" setTheme={noop} onLogout={noop} />)
    expect(screen.queryByText('리서치')).toBeNull()
  })
})

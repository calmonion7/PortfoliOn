import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

const authMock = vi.fn()
vi.mock('../contexts/AuthContext', () => ({
  useAuth: () => authMock(),
}))
vi.mock('../utils/analytics', () => ({ trackEvent: vi.fn() }))

import Sidebar from '../components/Sidebar'

// task#172 S1: 사이드바 섹션 노출은 useAuth().menuPermissions/role 매핑을 따른다(ADR-0025).
describe('Sidebar 권한별 섹션 노출', () => {
  it('research·portfolio 권한만 있으면 해당 섹션만 보이고 시장/구루/설정/행동은 숨는다', () => {
    authMock.mockReturnValue({ menuPermissions: ['research', 'portfolio'], role: 'user', loading: false })
    render(<MemoryRouter><Sidebar /></MemoryRouter>)
    expect(screen.getByText('리서치')).toBeInTheDocument()
    expect(screen.getByText('포트폴리오')).toBeInTheDocument()
    expect(screen.queryByText('시장')).toBeNull()
    expect(screen.queryByText('구루')).toBeNull()
    expect(screen.queryByText('설정')).toBeNull()
    expect(screen.queryByText('행동')).toBeNull()
  })

  it('role=admin이면 menuPermissions와 무관하게 행동(관리자) 링크가 노출된다', () => {
    authMock.mockReturnValue({ menuPermissions: [], role: 'admin', loading: false })
    render(<MemoryRouter><Sidebar /></MemoryRouter>)
    expect(screen.getByText('행동')).toBeInTheDocument()
  })

  it('loading 중에는 섹션이 렌더되지 않는다', () => {
    authMock.mockReturnValue({ menuPermissions: ['research'], role: 'user', loading: true })
    render(<MemoryRouter><Sidebar /></MemoryRouter>)
    expect(screen.queryByText('리서치')).toBeNull()
  })
})

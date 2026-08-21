import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'

// task#324 (ADR-0047) — 리포트 계열의 경계가 화면에 반영됐는지.
// ⓒ `/analyst-reports`의 성격 전환(admin 관리 화면 / 비-admin 리다이렉트)
// ⓓ 리포트 목록의 admin 전용 발행 관리 링크
// ⓔ 리포트 목록의 「심층」 배지
// 각 축은 반드시 **대조군과 쌍**으로 둔다 — 한쪽만 재면 「누구나 리다이렉트」·「모두에게 링크 노출」도 통과한다.

const authMock = vi.fn(() => ({ role: 'user', loading: false }))
vi.mock('../contexts/AuthContext', () => ({ useAuth: () => authMock() }))
vi.mock('../pages/AnalystReports', () => ({ default: () => <div>ADMIN_MGMT_SCREEN</div> }))

import AnalystReportsRoute from '../routes/AnalystReportsRoute'
import TickerListItem from '../components/reports/TickerListItem'
import StockCard from '../components/reports/StockCard'

const renderRoute = () => render(
  <MemoryRouter initialEntries={['/analyst-reports']}>
    <Routes>
      <Route path="/analyst-reports" element={<AnalystReportsRoute />} />
      <Route path="/reports" element={<div>STOCK_REPORTS_PAGE</div>} />
    </Routes>
  </MemoryRouter>
)

beforeEach(() => { vi.clearAllMocks(); authMock.mockReturnValue({ role: 'user', loading: false }) })

describe('/analyst-reports 성격 전환 (task#324 S4ⓒ)', () => {
  it('비-admin은 종목 리포트로 리다이렉트된다', () => {
    renderRoute()
    expect(screen.getByText('STOCK_REPORTS_PAGE')).toBeTruthy()
    expect(screen.queryByText('ADMIN_MGMT_SCREEN')).toBeNull()
  })

  it('대조군 — admin은 리다이렉트되지 않고 관리 화면을 본다', () => {
    authMock.mockReturnValue({ role: 'admin', loading: false })
    renderRoute()
    expect(screen.getByText('ADMIN_MGMT_SCREEN')).toBeTruthy()
    expect(screen.queryByText('STOCK_REPORTS_PAGE')).toBeNull()
  })

  it('대조군 — 권한 확정 전(loading)에는 어느 쪽으로도 보내지 않는다', () => {
    // loading 중 리다이렉트하면 admin이 자기 화면에 못 들어간다(새로고침 시 재현되는 결함).
    authMock.mockReturnValue({ role: undefined, loading: true })
    renderRoute()
    expect(screen.queryByText('STOCK_REPORTS_PAGE')).toBeNull()
    expect(screen.queryByText('ADMIN_MGMT_SCREEN')).toBeNull()
  })
})

// ── ⓔ 「심층」 배지 — 두 렌더러가 같은 계약을 진다 ─────────────────────────────
const INFO = { category: 'holdings', market: 'US', dates: ['2026-08-20'], summary: { market: 'US', price: 10 } }
const common = {
  ticker: 'AAPL', info: INFO, pnl: null, guruMap: {}, isAdmin: false,
  generating: null, genProgress: { done: 0, total: 0, failed: [] }, touchStyle: {},
  openDetail: vi.fn(), generateOne: vi.fn(), openEdit: vi.fn(), handleDelete: vi.fn(),
  handleGlobalDelete: vi.fn(), setPromoteTarget: vi.fn(), handlePinToggle: vi.fn(),
}

describe('리포트 목록 「심층」 배지 (task#324 S4ⓔ)', () => {
  it.each([
    ['사이드바 행', (props) => <TickerListItem {...props} selected={{}} view="list" />],
    ['카드', (props) => <StockCard {...props} />],
  ])('%s — 발행물이 있으면 배지가 뜨고 없으면 안 뜬다(대조군 동봉)', (_label, ui) => {
    const withPub = render(<MemoryRouter>{ui({ ...common, hasPub: true })}</MemoryRouter>)
    expect(withPub.getByText('심층')).toBeTruthy()
    withPub.unmount()
    const without = render(<MemoryRouter>{ui({ ...common, hasPub: false })}</MemoryRouter>)
    expect(without.queryByText('심층')).toBeNull()
  })
})

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'

// task#324 (ADR-0047) — 리포트 계열의 경계가 화면에 반영됐는지.
// ⓒ `/analyst-reports` — task#396(결정 5 개정)에서 비-admin 리다이렉트를 없애고 목록을 전 사용자에게 다시 열었다.
//    관리 수단 3종(대상 지정·즉시 발행·종목 단위 삭제)은 같은 화면 안에서 admin에게만 보인다(ADR-0027 ② 유지).
// ⓔ 리포트 목록의 「심층」 배지
// 각 축은 반드시 **대조군과 쌍**으로 둔다 — 한쪽만 재면 「누구나 리다이렉트」·「모두에게 도구 노출」도 통과한다.

const authMock = vi.fn(() => ({ role: 'user', loading: false }))
vi.mock('../contexts/AuthContext', () => ({ useAuth: () => authMock() }))
vi.mock('../api', () => ({ default: { get: vi.fn(), put: vi.fn(), post: vi.fn(), delete: vi.fn() } }))
vi.mock('../components/Toast', () => ({ useToast: () => ({ showToast: vi.fn() }) }))

import api from '../api'
import AnalystReports from '../pages/AnalystReports'
import TickerListItem from '../components/reports/TickerListItem'
import StockCard from '../components/reports/StockCard'

const PUBS = [{ ticker: '000660', name: 'SK하이닉스', published_date: '2026-10-21', title: '판', tally: { go: 1 } }]

// App.jsx와 같은 배선(`/analyst-reports` → AnalystReports)에 `/reports` 착지점을 둔다. 이 축은 페이지가 스스로
// 튕기지 않는지만 본다 — App.jsx 배선 자체(옛 AnalystReportsRoute 게이트 제거)는 라이브 프로브 uat215가 비-admin URL 유지로 잰다.
const renderRoute = () => render(
  <MemoryRouter initialEntries={['/analyst-reports']}>
    <Routes>
      <Route path="/analyst-reports" element={<AnalystReports />} />
      <Route path="/reports" element={<div>STOCK_REPORTS_PAGE</div>} />
    </Routes>
  </MemoryRouter>
)

beforeEach(() => {
  vi.clearAllMocks()
  authMock.mockReturnValue({ role: 'user', loading: false })
  api.get.mockImplementation((url) => Promise.resolve({ data: url === '/api/analyst-reports' ? { reports: PUBS } : [] }))
})

describe('/analyst-reports 전 사용자 재개방 (task#396)', () => {
  it('비-admin은 리다이렉트되지 않고 발행물 목록을 보며, 관리 도구는 없다', async () => {
    renderRoute()
    expect(await screen.findByText('SK하이닉스')).toBeTruthy()
    expect(screen.queryByText('STOCK_REPORTS_PAGE')).toBeNull()
    expect(screen.queryByText('자동 발행 대상 관리')).toBeNull()
  })

  it('대조군 — admin은 같은 화면에서 관리 도구까지 본다', async () => {
    authMock.mockReturnValue({ role: 'admin', loading: false })
    renderRoute()
    expect(await screen.findByText('자동 발행 대상 관리')).toBeTruthy()
    expect(screen.queryByText('STOCK_REPORTS_PAGE')).toBeNull()
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

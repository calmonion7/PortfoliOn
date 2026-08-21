import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

// task#M1: 사이드바 클릭(TickerListItem→openDetail, navigate 없이 내부 state만 변경)으로
// 상세가 다른 티커로 바뀐 뒤, 전역검색으로 같은 티커를 재선택(initialTicker 값은 불변, 새 네비게이션)해도
// 딥링크 effect가 재발동해 그 티커 상세로 돌아와야 한다(navKey=location.key가 트리거).
vi.mock('../api', () => ({ default: { get: vi.fn(() => Promise.resolve({ data: {} })) } }))
// task#324: 리포트 목록에 admin 전용 「심층 발행 관리 →」 링크가 생겼다 → 역할을 갈아탈 수 있어야 하고
// Link 렌더에 Router 컨텍스트가 필요하다(아래 renderReports 래퍼).
const authMock = vi.fn(() => ({ role: 'user', loading: false }))
vi.mock('../contexts/AuthContext', () => ({ useAuth: () => authMock() }))
vi.mock('../components/Toast', () => ({ useToast: () => ({ showToast: vi.fn() }) }))
vi.mock('../hooks/useIsMobile', () => ({ default: () => false }))
vi.mock('../hooks/usePortfolioData', () => ({ default: () => ({ stocks: [], watchlist: [], fetchAll: vi.fn() }) }))
vi.mock('../hooks/useReportList', () => ({
  default: () => ({
    reportList: {
      AAA: { category: 'holdings', market: 'US', dates: ['2026-07-01'], summary: { market: 'US' } },
      BBB: { category: 'holdings', market: 'US', dates: ['2026-07-02'], summary: { market: 'US' } },
    },
    listLoading: false, guruMap: {}, fetchList: vi.fn(), applyList: vi.fn(),
    holdingsCount: 2, watchlistCount: 0, watchlistWarnCount: 0, watchlistLowCount: 0, watchlistHighCount: 0,
    _targetPct: () => null, _hasWarning: () => false, _isUngenerated: () => false,
    ungeneratedTickers: [], ungeneratedCount: 0,
  }),
}))
vi.mock('../hooks/useReportFilters', () => ({
  default: () => ({
    activeEntries: [
      ['AAA', { category: 'holdings', market: 'US', dates: ['2026-07-01'], summary: { market: 'US' } }],
      ['BBB', { category: 'holdings', market: 'US', dates: ['2026-07-02'], summary: { market: 'US' } }],
    ],
    tabEntries: [], mCountAll: 2, mCountKR: 0, mCountUS: 2,
    sortCol: null, handleSort: vi.fn(), sortArrow: () => '',
    marketFilter: 'ALL', setMarketFilter: vi.fn(),
    watchlistSub: 'low', setWatchlistSub: vi.fn(),
  }),
}))
vi.mock('../hooks/useStockManagement', () => ({
  default: () => ({
    modalOpen: false, setModalOpen: vi.fn(), editing: null, setEditing: vi.fn(), addMode: 'holding',
    promoteTarget: null, setPromoteTarget: vi.fn(), mutError: '',
    handleSave: vi.fn(), handleDelete: vi.fn(), handleGlobalDelete: vi.fn(), handlePromote: vi.fn(),
    handlePinToggle: vi.fn(), openEdit: vi.fn(), openAdd: vi.fn(),
  }),
}))
vi.mock('../hooks/useReportGeneration', () => ({
  default: () => ({ generating: null, genProgress: { done: 0, total: 0, failed: [] }, generateOne: vi.fn(), generateBatch: vi.fn(), cleanup: vi.fn() }),
}))
vi.mock('../components/reports/ReportDetailTabs', () => ({
  default: ({ ticker }) => <div data-testid="detail-tabs">{ticker}</div>,
}))
vi.mock('../components/reports/ReportDetailHeader', () => ({ default: () => null }))
vi.mock('../components/reports/ReportFilters', () => ({ default: () => null }))
vi.mock('../components/reports/StockCard', () => ({ default: () => null }))
vi.mock('../components/reports/TickerListItem', () => ({
  default: ({ ticker, openDetail }) => {
    const dateFor = { AAA: '2026-07-01', BBB: '2026-07-02' }
    return <button onClick={() => openDetail(ticker, dateFor[ticker])}>{`SIDEBAR_${ticker}`}</button>
  },
}))

import { MemoryRouter } from 'react-router-dom'
import Reports from '../pages/Reports'

const renderReports = (props) => render(<MemoryRouter><Reports {...props} /></MemoryRouter>)

describe('리포트 딥링크 재진입 — navKey 변경 시 상세 갱신 (task#M1)', () => {
  it('같은 initialTicker라도 navKey가 바뀌면 딥링크 상세 진입이 재발동해 사이드바로 바뀐 상세를 되돌린다', () => {
    const { rerender } = renderReports({ initialTicker: 'AAA', navKey: 'key1' })
    expect(screen.getByTestId('detail-tabs')).toHaveTextContent('AAA')

    // 사이드바 클릭(navigate 없이 내부 state만 변경)으로 상세가 BBB로 전환
    fireEvent.click(screen.getByText('SIDEBAR_BBB'))
    expect(screen.getByTestId('detail-tabs')).toHaveTextContent('BBB')

    // 전역검색으로 같은 AAA를 재선택 — initialTicker는 동일(AAA)하지만 새 네비게이션이라 navKey가 바뀐다
    rerender(<MemoryRouter><Reports initialTicker="AAA" navKey="key2" /></MemoryRouter>)
    expect(screen.getByTestId('detail-tabs')).toHaveTextContent('AAA')
  })
})

// task#324 S4ⓓ — nav에서 「심층 리포트」가 빠진 대신 admin이 발행 관리 화면에 도달하는 경로.
// 「보인다」만 재면 도달을 증명하지 못하므로 href까지 단언하고, 비-admin 부재를 대조군으로 둔다.
describe('리포트 목록 — admin 발행 관리 링크 (task#324)', () => {
  it('admin에게는 /analyst-reports로 가는 링크가 있다', () => {
    authMock.mockReturnValue({ role: 'admin', loading: false })
    renderReports({ initialTicker: null, navKey: 'k' })
    const link = screen.getByRole('link', { name: /심층 발행 관리/ })
    expect(link.getAttribute('href')).toBe('/analyst-reports')
  })

  it('대조군 — 비-admin에게는 그 링크가 없다', () => {
    authMock.mockReturnValue({ role: 'user', loading: false })
    renderReports({ initialTicker: null, navKey: 'k' })
    expect(screen.queryByRole('link', { name: /심층 발행 관리/ })).toBeNull()
  })
})

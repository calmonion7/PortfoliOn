import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

// task#378 (B83) — `/reports` 딥링크(initialTicker)가 리포트를 열 수 없는 종목에서 목록에 조용히 멈추지 않는다.
// 분기는 CONTEXT 「추적 상태」 4값을 따른다: 날짜 있음 → 상세 · 추적 중·날짜 0 → 미생성 안내 ·
// 미추적(조회 성공 + 목록에 없음) → 안내 + 관심종목 추가 · 모름(listFailed) → 「미추적」이라 말하지 않는다.
// 그리고 딥링크는 한 내비게이션(navKey)당 한 번만 상세를 연다 — 목록 재조회가 사용자를 다시 끌고 가지 않는다.
vi.mock('../api', () => ({ default: { get: vi.fn(() => Promise.resolve({ data: {} })), post: vi.fn() } }))
vi.mock('../contexts/AuthContext', () => ({ useAuth: () => ({ role: 'user', loading: false }) }))
vi.mock('../components/Toast', () => ({ useToast: () => ({ showToast: vi.fn() }) }))
vi.mock('../hooks/useIsMobile', () => ({ default: () => false }))
vi.mock('../hooks/usePortfolioData', () => ({ default: () => ({ stocks: [], watchlist: [], fetchAll: vi.fn() }) }))

// 목록 상태는 테스트가 바꾼 뒤 rerender로 반영한다(재조회 = listLoading true → false).
let listState
const fetchList = vi.fn()
vi.mock('../hooks/useReportList', () => ({
  default: () => ({
    reportList: listState.reportList,
    listLoading: listState.listLoading,
    listFailed: listState.listFailed,
    guruMap: {}, fetchList, applyList: vi.fn(), refreshList: vi.fn(),
    holdingsCount: 1, watchlistCount: 0, watchlistWarnCount: 0, watchlistLowCount: 0, watchlistHighCount: 0,
    _targetPct: () => null, _hasWarning: () => false, _isUngenerated: () => false,
    ungeneratedTickers: [], ungeneratedCount: 0,
  }),
}))
vi.mock('../hooks/useReportFilters', () => ({
  default: () => ({
    activeEntries: Object.entries(listState.reportList),
    tabEntries: [], mCountAll: 1, mCountKR: 0, mCountUS: 1,
    sortCol: null, handleSort: vi.fn(), sortArrow: () => '',
    marketFilter: 'ALL', setMarketFilter: vi.fn(),
    watchlistSub: 'low', setWatchlistSub: vi.fn(),
  }),
}))
vi.mock('../hooks/useReportGeneration', () => ({
  default: () => ({ generating: null, genProgress: { done: 0, total: 0, failed: [] }, generateOne: vi.fn(), generateBatch: vi.fn() }),
}))
vi.mock('../components/reports/ReportDetailTabs', () => ({
  default: ({ ticker }) => <div data-testid="detail-tabs">{ticker}</div>,
}))
vi.mock('../components/reports/ReportDetailHeader', () => ({ default: () => null }))
vi.mock('../components/reports/ReportFilters', () => ({ default: () => null }))
vi.mock('../components/reports/StockCard', () => ({ default: () => null }))
vi.mock('../components/reports/TickerListItem', () => ({ default: () => null }))
// 모달은 받은 계약(모드·프리필)만 드러낸다 — 실제 폼 동작은 StockModal 자체 테스트의 몫.
vi.mock('../components/StockModal', () => ({
  default: ({ mode, prefill }) => (
    <div data-testid="stock-modal" data-mode={mode} data-ticker={prefill?.ticker ?? ''}
         data-market={prefill?.market ?? ''} data-name={prefill?.name ?? ''} />
  ),
}))

import { MemoryRouter } from 'react-router-dom'
import Reports from '../pages/Reports'

const ui = (props) => <MemoryRouter><Reports {...props} /></MemoryRouter>
const viewOf = (container) => container.querySelector('.reports-layout').getAttribute('data-view')
const tracked = (dates) => ({ AAA: { category: 'holdings', market: 'US', dates, summary: { market: 'US' } } })

beforeEach(() => {
  vi.clearAllMocks()
  listState = { reportList: tracked(['2026-07-01']), listLoading: false, listFailed: false }
})

describe('리포트 딥링크 — 추적 상태별 도착 (task#378, B83)', () => {
  it('① 날짜 있는 티커 → 상세로 진입하고 안내 배너는 없다 (양성 대조군)', () => {
    const { container } = render(ui({ initialTicker: 'AAA', navKey: 'k1' }))
    expect(viewOf(container)).toBe('detail')
    expect(screen.getByTestId('detail-tabs')).toHaveTextContent('AAA')
    expect(screen.queryByTestId('deeplink-notice')).toBeNull()
  })

  it('② 추적 중인데 날짜 0 → 「아직 리포트가 생성되지 않았습니다」, 추가 버튼 없음', () => {
    listState.reportList = tracked([])
    const { container } = render(ui({ initialTicker: 'AAA', navKey: 'k1' }))
    expect(viewOf(container)).toBe('list')
    const notice = screen.getByTestId('deeplink-notice')
    expect(notice).toHaveTextContent('AAA')
    expect(notice).toHaveTextContent('아직 리포트가 생성되지 않았습니다')
    expect(notice).not.toHaveTextContent('추적하지 않는')
    expect(screen.queryByTestId('deeplink-add-watch')).toBeNull()
  })

  it('③ 미추적(조회 성공 + 목록에 없음) US → 안내 + 버튼, 누르면 관심 모드 모달이 QCOM·US로 열린다', () => {
    const { container } = render(ui({ initialTicker: 'qcom', navKey: 'k1' }))
    expect(viewOf(container)).toBe('list')
    const notice = screen.getByTestId('deeplink-notice')
    expect(notice).toHaveTextContent('QCOM')
    expect(notice).toHaveTextContent('추적하지 않는 종목')
    expect(screen.queryByTestId('stock-modal')).toBeNull()
    fireEvent.click(screen.getByTestId('deeplink-add-watch'))
    const modal = screen.getByTestId('stock-modal')
    expect(modal.getAttribute('data-mode')).toBe('watchlist')
    expect(modal.getAttribute('data-ticker')).toBe('QCOM')
    expect(modal.getAttribute('data-market')).toBe('US')
    // 회사명 칸이 required라 티커로 시드한다 — 백엔드 resolve_name이 「이름 == 티커」를 실명으로 바꾼다.
    expect(modal.getAttribute('data-name')).toBe('QCOM')
  })

  it('안내가 나타나면 화면 안으로 스크롤한다 (업체표 하단에서 넘어와도 보이게)', () => {
    const spy = vi.fn()
    Element.prototype.scrollIntoView = spy
    render(ui({ initialTicker: 'QCOM', navKey: 'k1' }))
    expect(spy).toHaveBeenCalledTimes(1)
    expect(spy.mock.contexts[0]).toBe(screen.getByTestId('deeplink-notice'))
    delete Element.prototype.scrollIntoView
  })

  it('③ 미추적 KR(6자리 숫자) → 시장이 KR로 프리필된다', () => {
    render(ui({ initialTicker: '005930', navKey: 'k1' }))
    fireEvent.click(screen.getByTestId('deeplink-add-watch'))
    const modal = screen.getByTestId('stock-modal')
    expect(modal.getAttribute('data-ticker')).toBe('005930')
    expect(modal.getAttribute('data-market')).toBe('KR')
  })

  it('④ 모름(listFailed) → 「추적하지 않는」이라 말하지 않고 버튼도 없다', () => {
    listState = { reportList: {}, listLoading: false, listFailed: true }
    render(ui({ initialTicker: 'QCOM', navKey: 'k1' }))
    expect(screen.queryByText(/추적하지 않는/)).toBeNull()
    expect(screen.queryByTestId('deeplink-add-watch')).toBeNull()
    expect(screen.queryByTestId('deeplink-notice')).toBeNull()
    expect(screen.getByTestId('report-list-error')).toBeInTheDocument()   // 기존 실패 UI는 그대로
  })

  it('로딩 중에는 안내를 띄우지 않는다 (미조회 ≠ 미추적)', () => {
    listState = { reportList: {}, listLoading: true, listFailed: false }
    render(ui({ initialTicker: 'QCOM', navKey: 'k1' }))
    expect(screen.queryByTestId('deeplink-notice')).toBeNull()
  })

  it('⑤ 한 navKey에서 상세를 연 뒤 목록 재조회가 상세를 다시 열지 않는다', () => {
    const { container, rerender } = render(ui({ initialTicker: 'AAA', navKey: 'k1' }))
    expect(viewOf(container)).toBe('detail')
    fireEvent.click(screen.getByText('← 목록으로'))
    expect(viewOf(container)).toBe('list')
    // 다른 종목 수정·삭제 등으로 목록이 다시 온다
    listState = { ...listState, listLoading: true }
    rerender(ui({ initialTicker: 'AAA', navKey: 'k1' }))
    listState = { ...listState, listLoading: false, reportList: tracked(['2026-07-01']) }
    rerender(ui({ initialTicker: 'AAA', navKey: 'k1' }))
    expect(viewOf(container)).toBe('list')
  })

  it('⑥ 같은 navKey에서 처음엔 날짜 0 → 재조회 후 날짜가 생기면 그때 상세가 열린다', () => {
    listState.reportList = tracked([])
    const { container, rerender } = render(ui({ initialTicker: 'AAA', navKey: 'k1' }))
    expect(viewOf(container)).toBe('list')
    listState = { ...listState, listLoading: true }
    rerender(ui({ initialTicker: 'AAA', navKey: 'k1' }))
    listState = { ...listState, listLoading: false, reportList: tracked(['2026-07-03']) }
    rerender(ui({ initialTicker: 'AAA', navKey: 'k1' }))
    expect(viewOf(container)).toBe('detail')
    expect(screen.getByTestId('detail-tabs')).toHaveTextContent('AAA')
    expect(screen.queryByTestId('deeplink-notice')).toBeNull()
  })
})

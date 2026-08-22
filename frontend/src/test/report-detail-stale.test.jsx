/**
 * B49 — 세대 가드 형제 집합 **2차**: `pages/Reports.jsx` 상세 fetch(HIGH·주 인스턴스)와
 * `pages/AnalystReport.jsx`의 두 이펙트.
 *
 * ⚠️ 이 둘은 `key={ticker}` 보호를 **받지 못한다**:
 *   ⓐ `Reports.jsx`의 `selected`는 **그 컴포넌트 자신의 상태**라, 자식에 걸린
 *      `key={selected.ticker}`가 재마운트하는 것은 `ReportDetailTabs`뿐이고 부모의 fetch가 아니다.
 *   ⓑ `AnalystReport`는 `ReportDetailTabs.jsx`가 **`key` 없이** 렌더하고 「이전 판」 버튼이
 *      부모의 `deepDate`만 갈아끼우므로 **같은 마운트 내** 레이스다.
 * 즉 `stale-response-guard.test.jsx`가 "key를 벗긴 가정"으로 재는 것들과 달리, 이 둘은 **지금 활성**이다.
 *
 * 판정은 `settle`로 마이크로/매크로태스크를 모두 배수한 뒤 plain expect로 한다
 * (`waitFor`는 재시도가 타이밍을 세탁해 이빨을 지운다 — 형제 파일 주석 참조).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, act } from '@testing-library/react'

const getMock = vi.fn()
vi.mock('../api', () => ({ default: { get: (...a) => getMock(...a), post: vi.fn() } }))
vi.mock('../contexts/AuthContext', () => ({ useAuth: () => ({ role: 'user', loading: false }) }))
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
// 상세 본문의 **출처**를 화면에 노출하는 스텁 — 이 마커가 헤더 티커와 갈리는 것이 B49의 증상이다.
vi.mock('../components/reports/ReportDetailTabs', () => ({
  default: ({ ticker, summary, loading }) => (
    <div data-testid="detail-tabs">
      <span data-testid="detail-header-ticker">{ticker}</span>
      <span data-testid="detail-body-ticker">{summary?.from ?? (loading ? 'LOADING' : 'NONE')}</span>
    </div>
  ),
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
// AnalystReport 하위 무거운 섹션은 이 파일의 관심(레이스)과 무관하므로 스텁.
vi.mock('../components/reports/SegmentAnalysisSection.jsx', () => ({ default: () => null }))

import { MemoryRouter } from 'react-router-dom'
import Reports from '../pages/Reports'
import AnalystReport from '../pages/AnalystReport'

function deferred() {
  let resolve, reject
  const promise = new Promise((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}

const settle = async (fn) => {
  await act(async () => {
    fn()
    await Promise.resolve()
    await new Promise(r => setTimeout(r, 25))
  })
}

beforeEach(() => { getMock.mockReset() })

// ── ⓐ Reports.jsx 상세 fetch — B49 주 인스턴스(HIGH) ─────────────────────────
describe('Reports 상세 fetch — 옛 종목 응답이 새 종목 화면을 덮지 않는다', () => {
  const renderReports = () => render(<MemoryRouter><Reports /></MemoryRouter>)

  it('⚠️ A→B 연속 선택 후 A가 늦게 착지해도 본문이 A로 덮이지 않는다', async () => {
    const a = deferred()
    getMock.mockImplementation((url) => {
      if (url.includes('/api/report/AAA/')) return a.promise
      if (url.includes('/api/report/BBB/')) return Promise.resolve({ data: { summary: { from: 'BBB' } } })
      return Promise.resolve({ data: {} })
    })
    renderReports()
    await settle(() => screen.getByText('SIDEBAR_AAA').click())   // A 선택(응답 보류)
    await settle(() => screen.getByText('SIDEBAR_BBB').click())   // B 선택(즉시 해소)
    expect(screen.getByTestId('detail-header-ticker').textContent).toBe('BBB')
    expect(screen.getByTestId('detail-body-ticker').textContent).toBe('BBB')

    await settle(() => a.resolve({ data: { summary: { from: 'AAA' } } }))
    expect(screen.getByTestId('detail-header-ticker').textContent).toBe('BBB')
    expect(screen.getByTestId('detail-body-ticker').textContent).toBe('BBB')   // A가 새지 않았다
  })

  it('✅ 대조군 — 경합이 없으면 선택한 종목의 상세가 정상 렌더된다', async () => {
    getMock.mockImplementation((url) => {
      if (url.includes('/api/report/AAA/')) return Promise.resolve({ data: { summary: { from: 'AAA' } } })
      return Promise.resolve({ data: {} })
    })
    renderReports()
    await settle(() => screen.getByText('SIDEBAR_AAA').click())
    expect(screen.getByTestId('detail-body-ticker').textContent).toBe('AAA')
  })

  it('⚠️ B 요청이 실패하면 A 수치를 유지하지 않고 **실패로 표시**한다(`.catch` 부재 결함)', async () => {
    getMock.mockImplementation((url) => {
      if (url.includes('/api/report/AAA/')) return Promise.resolve({ data: { summary: { from: 'AAA' } } })
      if (url.includes('/api/report/BBB/')) return Promise.reject(new Error('boom'))
      return Promise.resolve({ data: {} })
    })
    renderReports()
    await settle(() => screen.getByText('SIDEBAR_AAA').click())
    expect(screen.getByTestId('detail-body-ticker').textContent).toBe('AAA')

    await settle(() => screen.getByText('SIDEBAR_BBB').click())
    expect(screen.getByTestId('detail-header-ticker').textContent).toBe('BBB')
    expect(screen.getByTestId('detail-body-ticker').textContent).not.toBe('AAA')  // 옛 수치 잔존 금지
    expect(screen.getByTestId('report-detail-error')).toBeTruthy()                // 실패는 실패로
  })

  it('✅ 대조군 — 성공 시에는 실패 배너를 렌더하지 않는다', async () => {
    getMock.mockImplementation((url) => {
      if (url.includes('/api/report/AAA/')) return Promise.resolve({ data: { summary: { from: 'AAA' } } })
      return Promise.resolve({ data: {} })
    })
    renderReports()
    await settle(() => screen.getByText('SIDEBAR_AAA').click())
    expect(screen.queryByTestId('report-detail-error')).toBeNull()
  })
})

// ── ⓑ AnalystReport — 「이전 판」 전환(같은 마운트 내 레이스) ─────────────────
describe('AnalystReport — 「이전 판」을 빠르게 두 번 바꿀 때', () => {
  const D1 = '2026-08-01'
  const D2 = '2026-08-03'
  const pub = (d) => ({
    ticker: 'TST', name: '테스트', market: 'US', published_date: d, rating: 'buy',
    title: `논지-${d}`, valuation_method: 'DCF', risks: '리스크',
    fair_value_low: 100, fair_value_high: 120, points: [],
    data: { market: 'US', price: 110 },
  })
  const renderRep = (date) => render(
    <MemoryRouter><AnalystReport embedded ticker="TST" date={date} onSelectDate={() => {}} /></MemoryRouter>
  )

  it('⚠️ 낡은 판(D1) 응답이 현재 판(D2) 본문을 덮지 않는다', async () => {
    const d1 = deferred()
    getMock.mockImplementation((url) => {
      if (url.endsWith(`/${D1}`)) return d1.promise
      if (url.endsWith(`/${D2}`)) return Promise.resolve({ data: pub(D2) })
      return Promise.resolve({ data: { reports: [{ published_date: D1 }, { published_date: D2 }] } })
    })
    const { rerender } = renderRep(D1)                                    // D1 선택(보류)
    await settle(() => rerender(
      <MemoryRouter><AnalystReport embedded ticker="TST" date={D2} onSelectDate={() => {}} /></MemoryRouter>
    ))
    expect(screen.getByText('논지-2026-08-03')).toBeTruthy()

    await settle(() => d1.resolve({ data: pub(D1) }))
    expect(screen.getByText('논지-2026-08-03')).toBeTruthy()
    expect(screen.queryByText('논지-2026-08-01')).toBeNull()
    expect(document.body.textContent).not.toContain(`${D1} 발행`)
  })

  it('⚠️ 낡은 이력 응답이 「이전 판」 목록에 **지금 보고 있는 판**을 남기지 않는다', async () => {
    const hist1 = deferred()
    let histCalls = 0
    getMock.mockImplementation((url) => {
      if (url.endsWith(`/${D1}`) || url.endsWith(`/${D2}`)) {
        return Promise.resolve({ data: pub(url.endsWith(`/${D1}`) ? D1 : D2) })
      }
      histCalls += 1
      // 첫 이력 요청(D1 렌더가 낸 것)만 보류한다 — 그 응답의 `filter(d => d !== D1)`는 D2를 남긴다.
      if (histCalls === 1) return hist1.promise
      return Promise.resolve({ data: { reports: [{ published_date: D1 }, { published_date: D2 }] } })
    })
    const { rerender } = renderRep(D1)
    await settle(() => rerender(
      <MemoryRouter><AnalystReport embedded ticker="TST" date={D2} onSelectDate={() => {}} /></MemoryRouter>
    ))
    // 현재 D2 → 「이전 판」에는 D1만 있어야 한다.
    await settle(() => hist1.resolve({ data: { reports: [{ published_date: D1 }, { published_date: D2 }] } }))
    const olderRow = screen.getByText('이전 판').parentElement
    expect(olderRow.textContent).toContain(D1)
    expect(olderRow.textContent).not.toContain(D2)   // 자기 자신으로 가는 링크가 남지 않았다
  })

  it('✅ 대조군 — 경합이 없으면 선택한 판이 정상 렌더되고 이력도 표시된다', async () => {
    getMock.mockImplementation((url) => {
      if (url.endsWith(`/${D2}`)) return Promise.resolve({ data: pub(D2) })
      return Promise.resolve({ data: { reports: [{ published_date: D1 }, { published_date: D2 }] } })
    })
    renderRep(D2)
    await settle(() => {})
    expect(screen.getByText('논지-2026-08-03')).toBeTruthy()
    expect(screen.getByText('이전 판').parentElement.textContent).toContain(D1)
  })
})

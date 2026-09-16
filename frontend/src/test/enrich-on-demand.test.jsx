/**
 * 온디맨드 갱신 — 리포트 상세 진입 시 `POST /api/stocks/{t}/enrich/request` + 유계 폴링 (task#355, ADR 260916-132605 결정 2·3).
 *
 * **왜 `pages/Reports`를 렌더하는가.** 훅 단독 렌더는 소비처 배선(`useEffect(() => cleanup, [cleanup])`류 함정,
 * task#343)을 태우지 않는다 — 여기서는 페이지를 마운트하고 사이드바 클릭으로 상세에 진입해 POST가 실제로
 * 나가는지까지 잰다. 마운트 방식은 `report-detail-stale.test.jsx`를 재사용한다.
 *
 * 폴링은 유계다: 30초 간격 · 최대 MAX_TICKS · 연속 실패 MAX_FAIL_STREAK · 언마운트·종목 변경 시 중단.
 * 무한 경로(task#343의 두 결함)가 여기 다시 생기지 않도록 상한 두 축을 **직접** 잰다.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, act } from '@testing-library/react'

const getMock = vi.fn()
const postMock = vi.fn()
const showToast = vi.fn()
vi.mock('../api', () => ({ default: { get: (...a) => getMock(...a), post: (...a) => postMock(...a) } }))
vi.mock('../contexts/AuthContext', () => ({ useAuth: () => ({ role: 'user', loading: false }) }))
vi.mock('../components/Toast', () => ({ useToast: () => ({ showToast }) }))
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
vi.mock('../components/reports/ReportDetailTabs', () => ({ default: ({ ticker }) => <div data-testid="detail-tabs">{ticker}</div> }))
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
import { POLL_INTERVAL_MS, MAX_TICKS, MAX_FAIL_STREAK } from '../hooks/useEnrichOnDemand'

const REQ = '/api/stocks/AAA/enrich/request'
const DETAIL = '/api/report/AAA/2026-07-01'
const detailGets = () => getMock.mock.calls.filter(([u]) => u === DETAIL).length
const requestPosts = () => postMock.mock.calls.filter(([u]) => u === REQ).length

const settle = (fn) => act(async () => { fn?.(); await vi.advanceTimersByTimeAsync(50) })
const tick = (n = 1) => act(async () => { await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS * n) })
const renderReports = () => render(<MemoryRouter><Reports /></MemoryRouter>)

/** 상세 GET 응답기 — enriched_at을 호출 순서대로 돌려준다(마지막 값 반복). */
const detailSequence = (values) => {
  let i = 0
  return (url) => {
    if (url === DETAIL) {
      const v = values[Math.min(i, values.length - 1)]; i += 1
      if (v instanceof Error) return Promise.reject(v)
      return Promise.resolve({ data: { summary: {}, enriched_at: v } })
    }
    return Promise.resolve({ data: {} })
  }
}

beforeEach(() => {
  vi.useFakeTimers()
  getMock.mockReset(); postMock.mockReset(); showToast.mockReset()
})
afterEach(() => { vi.useRealTimers() })

describe('온디맨드 갱신 — Reports 상세 진입', () => {
  it('ⓐ 상세 진입 시 갱신 요청 POST를 정확히 1회 보낸다', async () => {
    getMock.mockImplementation(detailSequence(['2026-09-01T00:00:00Z']))
    postMock.mockResolvedValue({ data: { fired: false, reason: 'fresh' } })
    renderReports()
    await settle(() => screen.getByText('SIDEBAR_AAA').click())
    expect(requestPosts()).toBe(1)
  })

  it('ⓑ fired:false → 토스트 0 · 폴링 0 (상세 GET은 진입 시 1회뿐)', async () => {
    getMock.mockImplementation(detailSequence(['2026-09-01T00:00:00Z']))
    postMock.mockResolvedValue({ data: { fired: false, reason: 'fresh' } })
    renderReports()
    await settle(() => screen.getByText('SIDEBAR_AAA').click())
    await tick(3)
    expect(showToast).not.toHaveBeenCalled()
    expect(detailGets()).toBe(1)
  })

  it('ⓑ′ 백엔드 미배포(POST 404) → 조용히 무시: 토스트 0 · 폴링 0', async () => {
    getMock.mockImplementation(detailSequence([null]))
    postMock.mockRejectedValue(Object.assign(new Error('404'), { response: { status: 404 } }))
    renderReports()
    await settle(() => screen.getByText('SIDEBAR_AAA').click())
    await tick(2)
    expect(showToast).not.toHaveBeenCalled()
    expect(detailGets()).toBe(1)
  })

  it('ⓒ fired:true → 토스트 1회 + 30초 간격 폴링이 3틱 이상 지속된다', async () => {
    getMock.mockImplementation(detailSequence([null]))
    postMock.mockResolvedValue({ data: { fired: true, reason: 'stale' } })
    renderReports()
    await settle(() => screen.getByText('SIDEBAR_AAA').click())
    expect(showToast).toHaveBeenCalledTimes(1)
    expect(showToast.mock.calls[0][0]).toMatch(/갱신을 요청/)
    await tick(3)
    expect(detailGets()).toBeGreaterThanOrEqual(1 + 3)
  })

  it('ⓓ enriched_at 변경 → 갱신 토스트 + 상세 재조회 1회 + 폴링 중단', async () => {
    // 진입 GET: null · 폴 1: null(baseline) · 폴 2: 새 값 · 재조회: 새 값
    getMock.mockImplementation(detailSequence([null, null, '2026-09-16T02:10:00Z']))
    postMock.mockResolvedValue({ data: { fired: true, reason: 'stale' } })
    renderReports()
    await settle(() => screen.getByText('SIDEBAR_AAA').click())
    await tick(2)
    await settle()
    expect(showToast).toHaveBeenCalledTimes(2)
    expect(showToast.mock.calls[1][0]).toMatch(/갱신됐습니다/)
    const afterRefresh = detailGets()
    expect(afterRefresh).toBe(1 + 2 + 1)   // 진입 1 + 폴 2 + 재조회 1
    await tick(3)
    expect(detailGets()).toBe(afterRefresh) // 중단됐다
  })

  it('ⓔ 언마운트 후에는 폴링 GET이 더 나가지 않는다', async () => {
    getMock.mockImplementation(detailSequence([null]))
    postMock.mockResolvedValue({ data: { fired: true, reason: 'stale' } })
    const { unmount } = renderReports()
    await settle(() => screen.getByText('SIDEBAR_AAA').click())
    await tick(1)
    const before = detailGets()
    unmount()
    await tick(3)
    expect(detailGets()).toBe(before)
  })

  it('ⓕ 값이 안 바뀌면 MAX_TICKS에서 멈춘다(무한 폴링 금지)', async () => {
    getMock.mockImplementation(detailSequence([null]))
    postMock.mockResolvedValue({ data: { fired: true, reason: 'stale' } })
    renderReports()
    await settle(() => screen.getByText('SIDEBAR_AAA').click())
    await tick(MAX_TICKS + 5)
    expect(detailGets()).toBe(1 + MAX_TICKS)
    expect(showToast).toHaveBeenCalledTimes(1)
  })

  it('ⓖ 폴링이 연속 MAX_FAIL_STREAK회 실패하면 멈춘다', async () => {
    let n = 0
    getMock.mockImplementation((url) => {
      if (url !== DETAIL) return Promise.resolve({ data: {} })
      n += 1
      return n === 1 ? Promise.resolve({ data: { summary: {}, enriched_at: null } }) : Promise.reject(new Error('boom'))
    })
    postMock.mockResolvedValue({ data: { fired: true, reason: 'stale' } })
    renderReports()
    await settle(() => screen.getByText('SIDEBAR_AAA').click())
    await tick(MAX_FAIL_STREAK + 4)
    expect(detailGets()).toBe(1 + MAX_FAIL_STREAK)
  })
})

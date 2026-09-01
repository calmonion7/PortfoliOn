/**
 * §7.4 — 리포트 목록의 3상태: 「미조회 · 0건 · 실패」 (task#343 S2)
 *
 * **결함**: `useReportList::fetchList`와 `Reports.jsx`의 `?scope=all` fetch에 `.catch`가 없어,
 * 백엔드 blip이 `reportList={}` / `othersData=null` + `loading=false`로 붕괴했다. 그러면 화면이
 *
 *     「리포트가 없습니다.」
 *     「설정 페이지에서 "지금 생성" 버튼을 눌러 첫 리포트를 만드세요.」
 *
 * 를 렌더한다 — 앞줄은 **사실이 아닌 단정**이고 뒷줄은 그 위에 **잘못된 행동을 지시**한다.
 * 사용자는 "내 리포트가 사라졌다"로 읽고 불필요한 재생성을 누른다(task#307의 3상태 규율).
 *
 * **왜 훅 반환값이 아니라 렌더를 재는가.** 같은 훅의 `hasFetched`가 정확히 반례다 — 상태는
 * 있는데 **아무도 구조분해하지 않아** 화면에 아무 영향이 없다. 3상태를 만들고 소비처가 안 읽으면
 * 이 결함은 그대로다. 그래서 축은 전부 「화면에 무엇이 렌더되는가」로 쓴다.
 *
 * **대조군이 쌍으로 필요한 이유**: 음성 축(실패 시 빈 상태 부재)만 두면 「항상 실패로 표시」라는
 * 과잉교정이 통과한다. 성공+0건에서 빈 상태가 **그대로 렌더되는지**를 함께 못박는다
 * (빈 결과는 사실이므로 지우면 안 된다).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, act, fireEvent } from '@testing-library/react'

const getMock = vi.fn()
vi.mock('../api', () => ({ default: { get: (...a) => getMock(...a), post: vi.fn(), put: vi.fn(), delete: vi.fn() } }))
vi.mock('../contexts/AuthContext', () => ({ useAuth: () => ({ role: 'admin', loading: false }) }))
vi.mock('../components/Toast', () => ({ useToast: () => ({ showToast: vi.fn() }) }))
vi.mock('../hooks/useIsMobile', () => ({ default: () => false }))
vi.mock('../hooks/usePortfolioData', () => ({ default: () => ({ stocks: [], watchlist: [], fetchAll: vi.fn() }) }))
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
// 상세/카드 렌더는 이 파일의 관심(빈 상태 vs 실패 상태)과 무관하므로 스텁.
vi.mock('../components/reports/ReportDetailTabs', () => ({ default: () => null }))
vi.mock('../components/reports/ReportDetailHeader', () => ({ default: () => null }))
vi.mock('../components/reports/StockCard', () => ({ default: () => null }))
vi.mock('../components/reports/TickerListItem', () => ({ default: () => null }))
// ⚠️ `useReportList`·`useReportFilters`·`ReportFilters`는 **일부러 실물**을 쓴다 —
//    `.catch` 부재가 바로 그 훅의 결함이고, 탭 전환도 실제 버튼으로 해야 others 경로를 탄다.

import { MemoryRouter } from 'react-router-dom'
import Reports from '../pages/Reports'

const renderReports = () => render(<MemoryRouter><Reports /></MemoryRouter>)

/** 마이크로/매크로태스크를 모두 배수한다(`waitFor`는 재시도가 타이밍을 세탁해 이빨을 지운다). */
const settle = async (fn) => {
  await act(async () => {
    if (fn) fn()
    await Promise.resolve()
    await new Promise(r => setTimeout(r, 25))
  })
}

/** `/api/report/list`(내 목록)만 골라 응답을 정한다. 나머지 부가 조회는 전부 무해한 빈 값. */
function mockList({ mine, others }) {
  getMock.mockImplementation((url) => {
    if (url === '/api/report/list') return mine()
    if (url === '/api/report/list?scope=all') return others ? others() : Promise.resolve({ data: {} })
    if (url === '/api/analyst-reports') return Promise.resolve({ data: { reports: [] } })
    if (url === '/api/guru/stats/popularity') return Promise.resolve({ data: [] })
    return Promise.resolve({ data: {} })
  })
}

const ok = (data) => () => Promise.resolve({ data })
const boom = () => () => Promise.reject(new Error('500 Internal Server Error'))

beforeEach(() => {
  getMock.mockReset()
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})

// ── 내 목록 (holdings 탭) ──────────────────────────────────────────────────────
describe('리포트 목록 조회 실패는 「없음」이라고 말하지 않는다', () => {
  it('ⓐ /api/report/list 실패 → 「리포트가 없습니다」와 「지금 생성」 오지시가 렌더되지 않는다', async () => {
    mockList({ mine: boom() })
    await settle(renderReports)

    expect(screen.queryByText(/리포트가 없습니다/)).toBeNull()
    // 오지시가 이 결함의 핵심 — 없는 리포트를 "생성하라"고 시키면 사용자가 헛수고를 한다.
    expect(screen.queryByText(/지금 생성/)).toBeNull()
    expect(screen.queryByText('리포트 없음')).toBeNull()   // 사이드바의 형제 빈 상태도 함께
  })

  it('ⓑ 같은 조건에서 실패 배너(role=alert)와 「다시 시도」가 렌더된다', async () => {
    mockList({ mine: boom() })
    await settle(renderReports)

    const banner = screen.getByTestId('report-list-error')
    expect(banner.getAttribute('role')).toBe('alert')
    expect(banner.textContent).toContain('불러오지 못했습니다')
    expect(screen.getByText('다시 시도')).toBeTruthy()
  })

  it('ⓒ 대조군 — 성공 + 0건이면 빈 상태와 「지금 생성」 안내가 **그대로** 렌더된다', async () => {
    mockList({ mine: ok({}) })
    await settle(renderReports)

    // 빈 결과는 사실이다. 이 축이 없으면 「항상 실패로 표시」라는 과잉교정이 통과한다.
    expect(screen.getByText(/리포트가 없습니다/)).toBeTruthy()
    expect(screen.getByText(/지금 생성/)).toBeTruthy()
    expect(screen.queryByTestId('report-list-error')).toBeNull()
  })

  it('ⓓ 「다시 시도」가 목록을 다시 묻고, 성공하면 실패 표시가 걷힌다', async () => {
    let fail = true
    getMock.mockImplementation((url) => {
      if (url === '/api/report/list') {
        return fail ? Promise.reject(new Error('500')) : Promise.resolve({ data: {} })
      }
      if (url === '/api/analyst-reports') return Promise.resolve({ data: { reports: [] } })
      return Promise.resolve({ data: {} })
    })
    await settle(renderReports)
    expect(screen.getByTestId('report-list-error')).toBeTruthy()

    fail = false
    await settle(() => fireEvent.click(screen.getByText('다시 시도')))

    expect(screen.queryByTestId('report-list-error')).toBeNull()
    expect(screen.getByText(/리포트가 없습니다/)).toBeTruthy()   // 이제 「0건」은 사실이다
  })
})

// ── 그외 탭 (?scope=all, admin 전용) ──────────────────────────────────────────
describe('그외 탭도 동형으로 3상태를 지킨다', () => {
  const openOthers = async () => {
    await settle(renderReports)
    await settle(() => fireEvent.click(screen.getByText(/그외/)))
  }

  it('ⓐ ?scope=all 실패 → 빈 상태 대신 실패 배너가 렌더된다', async () => {
    mockList({ mine: ok({}), others: boom() })
    await openOthers()

    expect(screen.queryByText(/리포트가 없습니다/)).toBeNull()
    expect(screen.getByTestId('report-list-error').getAttribute('role')).toBe('alert')
  })

  it('ⓑ 대조군 — ?scope=all 성공 + 0건이면 빈 상태가 그대로 렌더된다', async () => {
    mockList({ mine: ok({}), others: ok({}) })
    await openOthers()

    expect(screen.getByText(/리포트가 없습니다/)).toBeTruthy()
    expect(screen.queryByTestId('report-list-error')).toBeNull()
    // 그외 탭에는 원래 「지금 생성」 오지시가 없다(남의 종목이므로) — 그 성질을 함께 못박는다.
    expect(screen.queryByText(/지금 생성/)).toBeNull()
  })
})

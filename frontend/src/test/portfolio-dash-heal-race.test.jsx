// task#379 S2 — Portfolio 대시보드 자가복구(task#102, 최대 3회)와 fetchDashboard 세대 가드의 상호작용.
//
// 세대 가드는 낡은 세대의 finally·catch를 무시한다. 자가복구 이펙트는 `!dashboardLoading`을 보고
// 돌므로, 가드가 로딩을 영원히 켜 두면 재시도가 멈추고(카드 0 + 스켈레톤 고착), 반대로 로딩이
// 엇갈리게 꺼지면 재시도가 상한을 넘을 수 있다. 두 축을 못박는다:
//   ⓐ 대시보드가 계속 비면 정확히 3회 재시도 후 소진 안내(「다시 시도」)가 뜬다
//   ⓑ 마운트 요청과 탭 클릭 요청이 겹쳐도(낡은 세대 착지) 같은 상한으로 수렴한다
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

vi.mock('../api', () => ({ default: { get: vi.fn(), delete: vi.fn(), post: vi.fn() } }))
vi.mock('../hooks/useIsMobile', () => ({ default: () => false }))

import api from '../api'
import Portfolio from '../pages/Portfolio'

// jsdom 미구현 — useCountUp·useReveal이 쓴다.
window.matchMedia = window.matchMedia || (() => ({ matches: true, addEventListener() {}, removeEventListener() {} }))
globalThis.IntersectionObserver = globalThis.IntersectionObserver || class { observe() {} unobserve() {} disconnect() {} }

const flush = () => act(() => new Promise((r) => setTimeout(r, 0)))
const dashCalls = () => api.get.mock.calls.filter(c => c[0] === '/api/stocks/dashboard').length

function mockEmptyDashboard({ firstDash } = {}) {
  let n = 0
  api.get.mockImplementation((url) => {
    if (url === '/api/portfolio') return Promise.resolve({ data: { stocks: [{ ticker: 'AAA', market: 'US' }], watchlist: [] } })
    if (url === '/api/stocks/dashboard') {
      n += 1
      if (n === 1 && firstDash) return firstDash
      return Promise.resolve({ data: { holdings: [], totals: null } })
    }
    return Promise.resolve({ data: {} })
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  api.delete.mockResolvedValue({})
})

describe('Portfolio 대시보드 자가복구 × 세대 가드', () => {
  it('ⓐ 대시보드가 계속 비면 3회 재시도 후 「다시 시도」로 소진된다', async () => {
    mockEmptyDashboard()
    render(<MemoryRouter><Portfolio /></MemoryRouter>)
    for (let i = 0; i < 10; i++) await flush()
    expect(dashCalls()).toBe(4)   // 마운트 1 + 자가복구 3
    expect(screen.getByText('다시 시도')).toBeInTheDocument()
  })

  it('ⓑ 마운트 요청이 탭 클릭 요청보다 늦게 착지해도 같은 상한으로 수렴한다', async () => {
    let resolveFirst
    const first = new Promise((r) => { resolveFirst = r })
    mockEmptyDashboard({ firstDash: first })
    render(<MemoryRouter><Portfolio /></MemoryRouter>)
    await flush()
    const dashTab = screen.getAllByText('대시보드').find(el => el.tagName === 'BUTTON')
    fireEvent.click(dashTab)   // 마운트 요청이 아직 in-flight
    for (let i = 0; i < 10; i++) await flush()
    resolveFirst({ data: { holdings: [], totals: null } })   // 낡은 세대 착지
    for (let i = 0; i < 10; i++) await flush()
    expect(dashCalls()).toBe(5)   // 마운트 1 + 탭 1 + 자가복구 3
    expect(screen.getByText('다시 시도')).toBeInTheDocument()
  })
})

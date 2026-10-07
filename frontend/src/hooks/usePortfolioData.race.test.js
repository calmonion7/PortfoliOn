// task#379 S2 — usePortfolioData fetchAll·fetchDashboard 세대 가드(B49 §7.3).
//
// fetchAll은 마운트·추가/삭제 후(useStockManagement.refreshAfterMutation)에서, fetchDashboard는
// 마운트·탭 클릭·↺(캐시 무효화)·자가복구에서 불린다. 겹치면 옛 응답이 새 목록/카드를 덮고,
// 먼저 끝난 요청의 finally가 진행 중인 요청의 로딩을 끄며, ↺ 무효화 뒤 옛 캐시 응답이 덮는다.
// (15초 시세 폴링 ↔ 대시보드 가격 얽힘은 다음 폴링이 자가 해소하므로 범위 밖.)
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'

vi.mock('../api', () => ({ default: { get: vi.fn(), delete: vi.fn() } }))

import api from '../api'
import usePortfolioData from './usePortfolioData'

function deferred() {
  let resolve, reject
  const promise = new Promise((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}
const flush = () => act(() => new Promise((r) => setTimeout(r, 0)))

// 지정 URL 호출마다 차례로 deferred를 돌려준다. 나머지는 빈 성공.
function mockQueue(target, n) {
  const ds = Array.from({ length: n }, deferred)
  let i = 0
  api.get.mockImplementation((url) => {
    if (url === target) return ds[i++].promise
    if (url === '/api/portfolio') return Promise.resolve({ data: { stocks: [], watchlist: [] } })
    if (url === '/api/portfolio/prices') return Promise.resolve({ data: {} })
    return Promise.resolve({ data: {} })
  })
  return ds
}
const pf = (...t) => ({ data: { stocks: t.map(ticker => ({ ticker })), watchlist: [] } })
const dash = (...t) => ({ data: { holdings: t.map(ticker => ({ ticker })), totals: null } })

beforeEach(() => {
  vi.clearAllMocks()
  api.delete.mockResolvedValue({})
})

describe('usePortfolioData fetchAll — 세대 가드', () => {
  it('옛 목록 응답이 늦게 착지해도 새 목록을 덮지 않는다', async () => {
    const [r0, r1] = mockQueue('/api/portfolio', 2)
    const { result } = renderHook(() => usePortfolioData())
    act(() => { result.current.fetchAll() })   // 추가 뒤 재조회

    r1.resolve(pf('AAA', 'BBB'))
    await flush()
    r0.resolve(pf('AAA'))
    await flush()
    expect(result.current.stocks.map(s => s.ticker)).toEqual(['AAA', 'BBB'])
  })

  it('옛 요청의 finally가 진행 중인 새 요청의 로딩을 끄지 않는다', async () => {
    const [r0, r1] = mockQueue('/api/portfolio', 2)
    const { result } = renderHook(() => usePortfolioData())
    act(() => { result.current.fetchAll() })

    r0.reject(new Error('late'))
    await flush()
    expect(result.current.listLoading).toBe(true)

    r1.resolve(pf('AAA'))
    await flush()
    expect(result.current.listLoading).toBe(false)
  })
})

describe('usePortfolioData fetchDashboard — 세대 가드', () => {
  it('↺ 무효화 뒤 옛 캐시 응답이 늦게 착지해도 새 카드를 덮지 않는다', async () => {
    const [d0, d1] = mockQueue('/api/stocks/dashboard', 2)
    const { result } = renderHook(() => usePortfolioData())
    act(() => { result.current.fetchDashboard() })                    // 마운트(캐시)
    await act(async () => { result.current.fetchDashboard({ invalidate: true }) })   // ↺

    d1.resolve(dash('AAA', 'BBB'))
    await flush()
    d0.resolve(dash('OLD'))
    await flush()
    expect(result.current.dashboardCards.map(c => c.ticker)).toEqual(['AAA', 'BBB'])
  })

  it('먼저 끝난 요청의 finally가 진행 중인 요청의 로딩을 끄지 않는다', async () => {
    const [d0, d1] = mockQueue('/api/stocks/dashboard', 2)
    const { result } = renderHook(() => usePortfolioData())
    act(() => { result.current.fetchDashboard() })
    act(() => { result.current.fetchDashboard() })   // 탭 클릭

    d0.resolve(dash('AAA'))
    await flush()
    expect(result.current.dashboardLoading).toBe(true)

    d1.resolve(dash('AAA'))
    await flush()
    expect(result.current.dashboardLoading).toBe(false)
  })

  it('옛 요청의 실패가 새 카드 위에 에러를 남기지 않는다', async () => {
    const [d0, d1] = mockQueue('/api/stocks/dashboard', 2)
    const { result } = renderHook(() => usePortfolioData())
    act(() => { result.current.fetchDashboard() })
    act(() => { result.current.fetchDashboard() })

    d1.resolve(dash('AAA'))
    await flush()
    d0.reject(new Error('late'))
    await flush()
    expect(result.current.dashboardError).toBeNull()
  })
})

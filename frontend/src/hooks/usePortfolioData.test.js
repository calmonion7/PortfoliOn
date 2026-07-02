import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'

vi.mock('../api', () => ({
  default: { get: vi.fn(), delete: vi.fn() },
}))
import api from '../api'
import usePortfolioData from './usePortfolioData'

beforeEach(() => {
  vi.clearAllMocks()
  // Default: /portfolio succeeds, prices succeeds, other calls resolve silently
  api.get.mockImplementation((url) => {
    if (url === '/api/portfolio') return Promise.resolve({ data: { stocks: [], watchlist: [] } })
    if (url === '/api/portfolio/prices') return Promise.resolve({ data: {} })
    if (url === '/api/market/fx') return Promise.resolve({ data: {} })
    if (url === '/api/digest/latest') return Promise.resolve({ data: {} })
    if (url === '/api/stocks/dashboard') return Promise.resolve({ data: { holdings: [], totals: null } })
    return Promise.resolve({ data: {} })
  })
  api.delete.mockResolvedValue({})
})

// S1 — #39: /api/portfolio reject → listLoading=false, hasFetched=false
describe('usePortfolioData — S1 fetchAll error handling', () => {
  it('/api/portfolio reject → listLoading false로 떨어짐', async () => {
    const err = new Error('network error')
    api.get.mockImplementation((url) => {
      if (url === '/api/portfolio') return Promise.reject(err)
      return Promise.resolve({ data: {} })
    })
    const { result } = renderHook(() => usePortfolioData())
    // Initially loading
    expect(result.current.listLoading).toBe(true)
    await waitFor(() => expect(result.current.listLoading).toBe(false))
  })

  it('/api/portfolio reject → hasFetched는 false 유지', async () => {
    const err = new Error('network error')
    api.get.mockImplementation((url) => {
      if (url === '/api/portfolio') return Promise.reject(err)
      return Promise.resolve({ data: {} })
    })
    const { result } = renderHook(() => usePortfolioData())
    await waitFor(() => expect(result.current.listLoading).toBe(false))
    expect(result.current.hasFetched).toBe(false)
  })

  it('/api/portfolio 성공 → hasFetched true', async () => {
    const { result } = renderHook(() => usePortfolioData())
    await waitFor(() => expect(result.current.hasFetched).toBe(true))
  })
})

// S2 — #23: dashboard fetch reject → dashboardError truthy
describe('usePortfolioData — S2 fetchDashboard error state', () => {
  it('fetchDashboard reject → dashboardError가 truthy로 전파됨', async () => {
    const dashErr = new Error('dashboard 500')
    api.get.mockImplementation((url) => {
      if (url === '/api/portfolio') return Promise.resolve({ data: { stocks: [{ ticker: 'AAPL' }], watchlist: [] } })
      if (url === '/api/portfolio/prices') return Promise.resolve({ data: {} })
      if (url === '/api/market/fx') return Promise.resolve({ data: {} })
      if (url === '/api/digest/latest') return Promise.resolve({ data: {} })
      if (url === '/api/stocks/dashboard') return Promise.reject(dashErr)
      return Promise.resolve({ data: {} })
    })
    const { result } = renderHook(() => usePortfolioData())
    await act(async () => { await result.current.fetchDashboard() })
    expect(result.current.dashboardError).toBeTruthy()
  })

  it('fetchDashboard 성공 후 dashboardError는 null로 클리어됨', async () => {
    const { result } = renderHook(() => usePortfolioData())

    // Fail first
    api.get.mockImplementation((url) => {
      if (url === '/api/stocks/dashboard') return Promise.reject(new Error('fail'))
      return Promise.resolve({ data: {} })
    })
    await act(async () => { await result.current.fetchDashboard() })
    expect(result.current.dashboardError).toBeTruthy()

    // Then succeed
    api.get.mockImplementation((url) => {
      if (url === '/api/stocks/dashboard') return Promise.resolve({ data: { holdings: [{ ticker: 'AAPL' }], totals: null } })
      return Promise.resolve({ data: {} })
    })
    await act(async () => { await result.current.fetchDashboard() })
    expect(result.current.dashboardError).toBeNull()
  })
})

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'

vi.mock('../api', () => ({
  default: { get: vi.fn(), post: vi.fn(), delete: vi.fn() },
}))
vi.mock('../components/Toast', () => ({ useToast: () => ({ showToast: vi.fn() }) }))

import api from '../api'
import useTrackedStocks from './useTrackedStocks'

beforeEach(() => {
  vi.clearAllMocks()
  api.get.mockResolvedValue({ data: [] })
  api.post.mockResolvedValue({})
  api.delete.mockResolvedValue({})
})

// 추적 상태는 4값이다 — 보유·관심·미추적·**모름**. 앞의 셋은 서버가 답을 준 사실이고,
// 모름은 답을 못 받은 상태다. 이 훅의 존재 이유가 그 넷째 값을 1급으로 다루는 것이다.
describe('useTrackedStocks — unknown을 1급 상태로', () => {
  it('B10 — 조회 성공 + 빈 결과는 미추적(unknown=false)이다, 모름이 아니다', async () => {
    api.get.mockResolvedValue({ data: [] })
    const { result } = renderHook(() => useTrackedStocks())
    await waitFor(() => expect(result.current.loaded).toBe(true))
    expect(result.current.unknown).toBe(false)
    expect(result.current.stockMap).toEqual({})
  })

  it('B11 — 조회 실패는 unknown=true (빈 맵으로 붕괴하지 않는다)', async () => {
    api.get.mockRejectedValue(new Error('boom'))
    const { result } = renderHook(() => useTrackedStocks())
    await waitFor(() => expect(result.current.unknown).toBe(true))
    expect(result.current.stockMap).toEqual({})
  })

  it('B12 — 토글 성공이면 그 티커 상태가 갱신된다', async () => {
    api.get
      .mockResolvedValueOnce({ data: [] })
      .mockResolvedValueOnce({ data: [{ ticker: 'AAPL', type: 'watchlist' }] })
    const { result } = renderHook(() => useTrackedStocks())
    await waitFor(() => expect(result.current.loaded).toBe(true))

    await act(async () => { await result.current.toggle('AAPL', 'Apple', false) })
    expect(api.post).toHaveBeenCalledWith('/api/watchlist', { ticker: 'AAPL', name: 'Apple' })
    await waitFor(() => expect(result.current.stockMap.AAPL).toBe('watchlist'))
    expect(result.current.unknown).toBe(false)
  })

  it('B12 — 토글 성공 후 reload가 실패해도 unknown으로 되돌리지 않는다', async () => {
    // 방금 성공한 그 티커의 상태는 확실히 아는 값이다 — 재조회 실패로 "모름"이 되면
    // 사용자가 방금 한 행동의 결과를 화면에서 잃는다.
    api.get
      .mockResolvedValueOnce({ data: [] })
      .mockRejectedValueOnce(new Error('reload 실패'))
    const { result } = renderHook(() => useTrackedStocks())
    await waitFor(() => expect(result.current.loaded).toBe(true))

    await act(async () => { await result.current.toggle('TSLA', 'Tesla', false) })
    await waitFor(() => expect(result.current.stockMap.TSLA).toBe('watchlist'))
    expect(result.current.unknown).toBe(false)
  })

  it('토글 실패는 re-throw하지 않는다 (토스트 계약 유지)', async () => {
    api.get.mockResolvedValue({ data: [] })
    api.post.mockRejectedValue(new Error('403'))
    const { result } = renderHook(() => useTrackedStocks())
    await waitFor(() => expect(result.current.loaded).toBe(true))
    await act(async () => {
      await expect(result.current.toggle('X', 'X', false)).resolves.toBeUndefined()
    })
  })
})

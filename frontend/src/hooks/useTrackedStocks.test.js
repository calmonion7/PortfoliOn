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

    const payload = { ticker: 'AAPL', name: 'Apple', market: 'US', exchange: '', security_type: 'EQUITY' }
    await act(async () => { await result.current.toggle(payload, false) })
    expect(api.post).toHaveBeenCalledWith('/api/watchlist', payload)
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

    const payload = { ticker: 'TSLA', name: 'Tesla', market: 'US', exchange: '', security_type: 'EQUITY' }
    await act(async () => { await result.current.toggle(payload, false) })
    await waitFor(() => expect(result.current.stockMap.TSLA).toBe('watchlist'))
    expect(result.current.unknown).toBe(false)
  })

  it('토글 실패는 re-throw하지 않는다 (토스트 계약 유지, task#244) — 반환값만 undefined→false로 변경(예외는 여전히 안 나간다)', async () => {
    api.get.mockResolvedValue({ data: [] })
    api.post.mockRejectedValue(new Error('403'))
    const { result } = renderHook(() => useTrackedStocks())
    await waitFor(() => expect(result.current.loaded).toBe(true))
    const payload = { ticker: 'X', name: 'X', market: 'US', exchange: '', security_type: 'EQUITY' }
    await act(async () => {
      await expect(result.current.toggle(payload, false)).resolves.toBe(false)
    })
  })

  // ── S1(a)(b)(c) — ADR-0032 계약 확장(task#273) ──────────────────────────────
  it('S1(a) — payload가 그대로 POST된다(5필드 보존, KR로 확인해 US 기본값에 안 기대는지 검증)', async () => {
    api.get
      .mockResolvedValueOnce({ data: [] })
      .mockResolvedValueOnce({ data: [{ ticker: '005930', type: 'watchlist' }] })
    const { result } = renderHook(() => useTrackedStocks())
    await waitFor(() => expect(result.current.loaded).toBe(true))

    const payload = { ticker: '005930', name: '삼성전자', market: 'KR', exchange: 'KS', security_type: 'EQUITY' }
    await act(async () => { await result.current.toggle(payload, false) })
    expect(api.post).toHaveBeenCalledWith('/api/watchlist', payload)
  })

  it('S1(b) — pending이 in-flight 동안 그 티커를 담고 완료 후 비운다', async () => {
    let resolvePost
    api.post.mockImplementation(() => new Promise(res => { resolvePost = res }))
    const { result } = renderHook(() => useTrackedStocks())
    await waitFor(() => expect(result.current.loaded).toBe(true))

    const payload = { ticker: 'AAPL', name: 'Apple', market: 'US', exchange: '', security_type: 'EQUITY' }
    let togglePromise
    act(() => { togglePromise = result.current.toggle(payload, false) })
    await waitFor(() => expect(result.current.pending.has('AAPL')).toBe(true))

    await act(async () => {
      resolvePost({})
      await togglePromise
    })
    expect(result.current.pending.has('AAPL')).toBe(false)
  })

  it('S1(b) — 이미 pending인 티커는 즉시 false를 반환하고 요청을 보내지 않는다(중복 클릭 가드)', async () => {
    let resolvePost
    api.post.mockImplementation(() => new Promise(res => { resolvePost = res }))
    const { result } = renderHook(() => useTrackedStocks())
    await waitFor(() => expect(result.current.loaded).toBe(true))

    const payload = { ticker: 'AAPL', name: 'Apple', market: 'US', exchange: '', security_type: 'EQUITY' }
    let firstPromise
    act(() => { firstPromise = result.current.toggle(payload, false) })
    await waitFor(() => expect(result.current.pending.has('AAPL')).toBe(true))

    let secondResult
    await act(async () => { secondResult = await result.current.toggle(payload, false) })
    expect(secondResult).toBe(false)
    expect(api.post).toHaveBeenCalledTimes(1)

    await act(async () => { resolvePost({}); await firstPromise })
  })

  // ── 적대적 리뷰 렌즈2 — reload() 세대 가드(B27과 같은 레이스 클래스) ──────────
  it('레이스 — 먼저 시작한 reload가 나중에 시작한 reload보다 늦게 도착해도 최신 상태를 덮지 않는다', async () => {
    // 마운트 시 자동 reload(R0)를 의도적으로 미해결로 두고, 그 사이 두 번째 reload(R1,
    // toggle 후 reload를 흉내)를 즉시 해결시켜 "나중에 시작 → 먼저 도착" 순서 역전을 재현.
    let resolveStale
    const stalePending = new Promise((res) => { resolveStale = res })
    let call = 0
    api.get.mockImplementation(() => {
      call += 1
      if (call === 1) return stalePending
      return Promise.resolve({ data: [{ ticker: 'AAPL', type: 'watchlist' }] })
    })

    const { result } = renderHook(() => useTrackedStocks())

    await act(async () => { await result.current.reload() })
    expect(result.current.stockMap).toEqual({ AAPL: 'watchlist' })

    // R0(마운트 reload)가 이제야 빈 데이터로 도착 — 최신(R1) 상태를 덮으면 회귀.
    await act(async () => {
      resolveStale({ data: [] })
      await new Promise((r) => setTimeout(r, 0))
    })
    expect(result.current.stockMap).toEqual({ AAPL: 'watchlist' })
  })

  it('S1(c) — 성공 시 true, 실패 시 false를 반환한다', async () => {
    api.get.mockResolvedValue({ data: [] })
    const { result } = renderHook(() => useTrackedStocks())
    await waitFor(() => expect(result.current.loaded).toBe(true))

    const payload = { ticker: 'AAPL', name: 'Apple', market: 'US', exchange: '', security_type: 'EQUITY' }
    let ok
    await act(async () => { ok = await result.current.toggle(payload, false) })
    expect(ok).toBe(true)

    api.post.mockRejectedValueOnce(new Error('403'))
    let fail
    await act(async () => { fail = await result.current.toggle({ ...payload, ticker: 'MSFT' }, false) })
    expect(fail).toBe(false)
  })
})

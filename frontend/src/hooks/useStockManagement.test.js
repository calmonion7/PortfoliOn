import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'

vi.mock('../api', () => ({
  default: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn(), patch: vi.fn() },
}))
import api from '../api'
import useStockManagement from './useStockManagement'

const makeArgs = (over = {}) => ({
  holdingMap: { AAPL: { ticker: 'AAPL', market: 'US', quantity: 10, avg_cost: 100 } },
  watchMap: { TSLA: { ticker: 'TSLA', market: 'US' } },
  fetchList: vi.fn(),
  fetchAll: vi.fn(),
  showToast: vi.fn(),
  activeTab: 'holdings',
  setActiveTab: vi.fn(),
  ...over,
})

beforeEach(() => {
  vi.clearAllMocks()
  window.confirm = vi.fn()
})

describe('useStockManagement — handleSave', () => {
  it('추가×보유: portfolio POST·추가 토스트·모달 닫힘·editing 클리어·refresh', async () => {
    api.post.mockResolvedValue({ data: {} })
    const args = makeArgs({ activeTab: 'holdings' })
    const { result } = renderHook(() => useStockManagement(args))
    act(() => result.current.openAdd())
    await act(async () => { await result.current.handleSave({ ticker: 'NVDA' }) })
    expect(api.post).toHaveBeenCalledWith('/api/portfolio', { ticker: 'NVDA' })
    expect(args.showToast).toHaveBeenCalledWith('NVDA 추가됐습니다')
    expect(result.current.modalOpen).toBe(false)
    expect(result.current.editing).toBe(null)
    expect(args.fetchList).toHaveBeenCalled()
    expect(args.fetchAll).toHaveBeenCalled()
  })
  it('추가×관심: watchlist POST', async () => {
    api.post.mockResolvedValue({ data: {} })
    const args = makeArgs({ activeTab: 'watchlist' })
    const { result } = renderHook(() => useStockManagement(args))
    act(() => result.current.openAdd())
    await act(async () => { await result.current.handleSave({ ticker: 'AMD' }) })
    expect(api.post).toHaveBeenCalledWith('/api/watchlist', { ticker: 'AMD' })
  })
  it('수정×보유: portfolio PUT·수정 토스트', async () => {
    api.put.mockResolvedValue({ data: {} })
    const args = makeArgs()
    const { result } = renderHook(() => useStockManagement(args))
    act(() => result.current.openEdit('AAPL', 'holdings'))
    await act(async () => { await result.current.handleSave({ quantity: 5 }) })
    expect(api.put).toHaveBeenCalledWith('/api/portfolio/AAPL', { quantity: 5 })
    expect(args.showToast).toHaveBeenCalledWith('AAPL 수정됐습니다')
  })
  it('수정×관심: watchlist PUT', async () => {
    api.put.mockResolvedValue({ data: {} })
    const args = makeArgs()
    const { result } = renderHook(() => useStockManagement(args))
    act(() => result.current.openEdit('TSLA', 'watchlist'))
    await act(async () => { await result.current.handleSave({ quantity: 1 }) })
    expect(api.put).toHaveBeenCalledWith('/api/watchlist/TSLA', { quantity: 1 })
  })
  it('추가 시 report_queued면 pollReportGeneration(setInterval 15s) 트리거', async () => {
    api.post.mockResolvedValue({ data: { report_queued: true } })
    const setIntervalSpy = vi.spyOn(globalThis, 'setInterval').mockReturnValue(1)
    const args = makeArgs({ activeTab: 'holdings' })
    const { result } = renderHook(() => useStockManagement(args))
    await act(async () => { await result.current.handleSave({ ticker: 'nvda' }) })
    expect(setIntervalSpy).toHaveBeenCalledWith(expect.any(Function), 15000)
    setIntervalSpy.mockRestore()
  })
  it('언마운트 시 폴링 인터벌 해제 — 이탈 후 타이머 진행해도 showToast 미발화', async () => {
    vi.useFakeTimers()
    // 히스토리 조회는 항상 빈 배열 반환(리포트 미생성 상태 유지)
    api.post.mockResolvedValue({ data: { report_queued: true } })
    api.get.mockResolvedValue({ data: [] })
    const args = makeArgs({ activeTab: 'holdings' })
    const { result, unmount } = renderHook(() => useStockManagement(args))
    await act(async () => { await result.current.handleSave({ ticker: 'NVDA' }) })
    unmount()
    // 언마운트 후 6틱(maxAttempts) 경과
    await act(async () => { vi.advanceTimersByTime(15000 * 6) })
    expect(args.showToast).not.toHaveBeenCalledWith(expect.stringContaining('실패'), 'warning')
    vi.useRealTimers()
  })
  it('실패: mutError 세팅·에러 토스트·throw', async () => {
    api.post.mockRejectedValue({ response: { data: { detail: '중복' } } })
    const args = makeArgs({ activeTab: 'holdings' })
    const { result } = renderHook(() => useStockManagement(args))
    await act(async () => {
      await expect(result.current.handleSave({ ticker: 'X' })).rejects.toBeTruthy()
    })
    expect(args.showToast).toHaveBeenCalledWith('중복', 'error')
    expect(result.current.mutError).toBe('중복')
  })
})

describe('useStockManagement — handleDelete', () => {
  it('confirm 취소면 삭제 안 함', async () => {
    window.confirm = vi.fn().mockReturnValue(false)
    const args = makeArgs()
    const { result } = renderHook(() => useStockManagement(args))
    await act(async () => { await result.current.handleDelete('AAPL', false) })
    expect(api.delete).not.toHaveBeenCalled()
  })
  it('관심(isWatch=true): 완전삭제 confirm·watchlist DELETE·삭제 토스트', async () => {
    window.confirm = vi.fn().mockReturnValue(true)
    api.delete.mockResolvedValue({})
    const args = makeArgs()
    const { result } = renderHook(() => useStockManagement(args))
    await act(async () => { await result.current.handleDelete('TSLA', true) })
    expect(window.confirm).toHaveBeenCalledWith('TSLA를 완전히 삭제하시겠습니까?')
    expect(api.delete).toHaveBeenCalledWith('/api/watchlist/TSLA')
    expect(args.showToast).toHaveBeenCalledWith('TSLA 삭제됐습니다')
  })
  it('보유(isWatch=false): 관심이동 confirm·portfolio DELETE', async () => {
    window.confirm = vi.fn().mockReturnValue(true)
    api.delete.mockResolvedValue({})
    const args = makeArgs()
    const { result } = renderHook(() => useStockManagement(args))
    await act(async () => { await result.current.handleDelete('AAPL', false) })
    expect(window.confirm).toHaveBeenCalledWith('AAPL를 보유종목에서 제거하고 관심종목으로 이동합니까?')
    expect(api.delete).toHaveBeenCalledWith('/api/portfolio/AAPL')
  })
})

describe('useStockManagement — handlePromote', () => {
  it('성공: promote POST·setActiveTab(holdings)·promoteTarget 클리어·refresh', async () => {
    api.post.mockResolvedValue({})
    const args = makeArgs()
    const { result } = renderHook(() => useStockManagement(args))
    act(() => result.current.setPromoteTarget({ ticker: 'TSLA', market: 'US' }))
    await act(async () => { await result.current.handlePromote({ quantity: 3, avg_cost: 200 }) })
    expect(api.post).toHaveBeenCalledWith('/api/watchlist/TSLA/promote', { quantity: 3, avg_cost: 200 })
    expect(args.setActiveTab).toHaveBeenCalledWith('holdings')
    expect(result.current.promoteTarget).toBe(null)
    expect(args.fetchList).toHaveBeenCalled()
    expect(args.fetchAll).toHaveBeenCalled()
  })
})

describe('useStockManagement — handlePinToggle', () => {
  it('성공: portfolio/{ticker}/pin PATCH·목록 재조회', async () => {
    api.patch.mockResolvedValue({ data: { ticker: 'TSLA', pinned: true } })
    const args = makeArgs()
    const { result } = renderHook(() => useStockManagement(args))
    await act(async () => { await result.current.handlePinToggle('TSLA', true) })
    expect(api.patch).toHaveBeenCalledWith('/api/portfolio/TSLA/pin', { pinned: true })
    expect(args.fetchList).toHaveBeenCalled()
  })
  it('실패: 에러 토스트·목록 재조회 안 함', async () => {
    api.patch.mockRejectedValue({ response: { data: { detail: '핀 실패' } } })
    const args = makeArgs()
    const { result } = renderHook(() => useStockManagement(args))
    await act(async () => { await result.current.handlePinToggle('TSLA', true) })
    expect(args.showToast).toHaveBeenCalledWith('핀 실패', 'error')
    expect(args.fetchList).not.toHaveBeenCalled()
  })
})

describe('useStockManagement — openEdit / openAdd', () => {
  it('openEdit: map에서 종목 찾아 editing 세팅·modalOpen', () => {
    const args = makeArgs()
    const { result } = renderHook(() => useStockManagement(args))
    act(() => result.current.openEdit('AAPL', 'holdings'))
    expect(result.current.modalOpen).toBe(true)
    expect(result.current.editing).toMatchObject({ ticker: 'AAPL', isWatch: false })
  })
  it('openEdit: map에 없으면 기본값(market US)으로 editing', () => {
    const args = makeArgs()
    const { result } = renderHook(() => useStockManagement(args))
    act(() => result.current.openEdit('UNKNOWN', 'watchlist'))
    expect(result.current.editing).toMatchObject({ ticker: 'UNKNOWN', market: 'US', isWatch: true })
  })
  it('openAdd: activeTab=watchlist면 addMode=watchlist·modalOpen', () => {
    const args = makeArgs({ activeTab: 'watchlist' })
    const { result } = renderHook(() => useStockManagement(args))
    act(() => result.current.openAdd())
    expect(result.current.addMode).toBe('watchlist')
    expect(result.current.modalOpen).toBe(true)
  })
  it('openAdd: activeTab=holdings면 addMode=holding', () => {
    const args = makeArgs({ activeTab: 'holdings' })
    const { result } = renderHook(() => useStockManagement(args))
    act(() => result.current.openAdd())
    expect(result.current.addMode).toBe('holding')
  })
})

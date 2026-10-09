// task#383 — 생성 후 목록 세대 편입(Ⓑ) · 밀린 생성 요청(ⓐ) · 카드 클릭 진입 게이트.
// 재현은 「새 요청을 in-flight로 붙잡고 옛 응답이 마지막에 착지」하도록 짠다(새 요청이 마지막이면 주입이 0 FAIL).
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act, render, fireEvent } from '@testing-library/react'

const showToast = vi.fn()
vi.mock('../api', () => ({ default: { get: vi.fn(), post: vi.fn() } }))
vi.mock('../components/Toast', () => ({ useToast: () => ({ showToast }) }))

import api from '../api'
import useReportList from '../hooks/useReportList'
import useReportGeneration from '../hooks/useReportGeneration'
import StockCard from '../components/reports/StockCard.jsx'
import TickerListItem from '../components/reports/TickerListItem.jsx'

function deferred() {
  let resolve, reject
  const promise = new Promise((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}
const listOf = (...tickers) => ({ data: { stocks: Object.fromEntries(tickers.map(t => [t, { dates: [], category: 'holdings' }])) } })
const errStatus = (status) => Object.assign(new Error(`status ${status}`), { response: { status, data: { detail: 'x' } } })

beforeEach(() => {
  vi.clearAllMocks()
})

describe('Ⓑ 조용한 재조회 — 목록 세대 편입', () => {
  function setup(listResponses) {
    const q = [...listResponses]
    api.get.mockImplementation((url) => {
      if (url === '/api/report/list') return q.shift().promise
      return Promise.resolve({ data: [] })
    })
  }

  it('붙잡힌 옛 refreshList 응답이 나중에 착지해도 새 fetchList 목록을 덮지 않는다', async () => {
    const d0 = deferred(), dRefresh = deferred(), dUser = deferred()
    setup([d0, dRefresh, dUser])
    const { result } = renderHook(() => useReportList())
    await act(async () => { d0.resolve(listOf('A')) })

    act(() => { result.current.refreshList() })          // 옛 요청(붙잡음)
    act(() => { result.current.fetchList() })            // 사용자 재조회 = 더 새 요청
    await act(async () => { dUser.resolve(listOf('A', 'NEW')) })
    await act(async () => { dRefresh.resolve(listOf('A')) }) // 옛 응답이 마지막에 착지
    expect(Object.keys(result.current.reportList).sort()).toEqual(['A', 'NEW'])
  })

  it('진행 중이던 fetchList를 밀어낸 뒤에도 listLoading이 풀린다(로딩 고착 방지)', async () => {
    const d0 = deferred(), dFetch = deferred(), dRefresh = deferred()
    setup([d0, dFetch, dRefresh])
    const { result } = renderHook(() => useReportList())
    await act(async () => { d0.resolve(listOf('A')) })

    act(() => { result.current.fetchList() })
    expect(result.current.listLoading).toBe(true)
    act(() => { result.current.refreshList() })          // fetchList를 밀어낸다
    await act(async () => { dRefresh.resolve(listOf('A', 'B')) })
    expect(result.current.listLoading).toBe(false)
    await act(async () => { dFetch.resolve(listOf('A')) }) // 밀려난 응답은 무시
    expect(Object.keys(result.current.reportList).sort()).toEqual(['A', 'B'])
  })

  it('refreshList는 listLoading을 켜지 않는다(스켈레톤 깜빡임 없음)', async () => {
    const d0 = deferred(), dRefresh = deferred()
    setup([d0, dRefresh])
    const { result } = renderHook(() => useReportList())
    await act(async () => { d0.resolve(listOf('A')) })
    act(() => { result.current.refreshList() })
    expect(result.current.listLoading).toBe(false)
    await act(async () => { dRefresh.resolve(listOf('A')) })
  })

  it('밀려난 옛 refreshList의 실패는 경고도 상태도 만지지 않는다(catch 게이트)', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const d0 = deferred(), dOld = deferred(), dNew = deferred()
    setup([d0, dOld, dNew])
    const { result } = renderHook(() => useReportList())
    await act(async () => { d0.resolve(listOf('A')) })
    act(() => { result.current.refreshList() })
    act(() => { result.current.fetchList() })
    await act(async () => { dNew.resolve(listOf('A', 'NEW')) })
    await act(async () => { dOld.reject(new Error('late')) })
    expect(warn).not.toHaveBeenCalled()
    expect(result.current.listFailed).toBe(false)
    warn.mockRestore()
  })

  it('refreshList 실패 시 기존 목록을 유지하고 listFailed를 세우지 않는다', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const d0 = deferred(), dRefresh = deferred()
    setup([d0, dRefresh])
    const { result } = renderHook(() => useReportList())
    await act(async () => { d0.resolve(listOf('A')) })
    act(() => { result.current.refreshList() })
    await act(async () => { dRefresh.reject(new Error('boom')) })
    expect(Object.keys(result.current.reportList)).toEqual(['A'])
    expect(result.current.listFailed).toBe(false)
    warn.mockRestore()
  })
})

describe('ⓐ 밀린 생성 요청 — 늦은 응답 규칙', () => {
  async function startAThenB() {
    const dA = deferred()
    let n = 0
    api.post.mockImplementation(() => (n++ === 0 ? dA.promise : Promise.resolve({})))
    api.get.mockResolvedValue({ data: { running: true, done: 0, total: 1, failed: [] } })
    const hook = renderHook(() => useReportGeneration({ onRefreshList: vi.fn() }))
    let pA, pB
    act(() => { pA = hook.result.current.generateOne('AAA') })
    await act(async () => { pB = hook.result.current.generateOne('BBB'); await pB })
    return { ...hook, dA, pA }
  }

  it('늦은 성공 — 아무것도 안 한다(B의 generating 유지·폴링 재시작 없음)', async () => {
    vi.useFakeTimers()
    const { result, dA, pA } = await startAThenB()
    const getsBefore = api.get.mock.calls.length
    await act(async () => { dA.resolve({}); await pA })
    expect(result.current.generating).toBe('BBB')
    await act(async () => { await vi.advanceTimersByTimeAsync(1600) })
    // 폴러는 B의 것 하나뿐 — A 성공이 새로 시작해 틱이 2배가 되지 않는다
    expect(api.get.mock.calls.length - getsBefore).toBe(1)
    // A 성공이 폴링을 가로채면 완료 토스트가 A 이름으로 뜬다 — B의 폴러만 살아 있어야 한다
    api.get.mockResolvedValue({ data: { running: false, done: 1, total: 1, failed: [] } })
    await act(async () => { await vi.advanceTimersByTimeAsync(1600) })
    expect(showToast.mock.calls.map(c => c[0])).toEqual(['BBB 리포트 생성 완료'])
    result.current.cleanup(); vi.useRealTimers()
  })

  it('늦은 409 — 경고 토스트·폴링 재시작·generating 변경 없음', async () => {
    vi.useFakeTimers()
    const { result, dA, pA } = await startAThenB()
    await act(async () => { dA.reject(errStatus(409)); await pA })
    expect(showToast).not.toHaveBeenCalled()
    expect(result.current.generating).toBe('BBB')
    result.current.cleanup(); vi.useRealTimers()
  })

  it('늦은 실패 — generating 불변, 종목명 붙은 실패 토스트 1회', async () => {
    vi.useFakeTimers()
    const { result, dA, pA } = await startAThenB()
    await act(async () => { dA.reject(errStatus(500)); await pA })
    expect(result.current.generating).toBe('BBB')
    expect(showToast).toHaveBeenCalledTimes(1)
    expect(showToast.mock.calls[0][0]).toContain('AAA')
    expect(showToast.mock.calls[0][1]).toBe('error')
    result.current.cleanup(); vi.useRealTimers()
  })

  it('generateBatch 늦은 실패 — 「일괄 생성 요청 실패」', async () => {
    vi.useFakeTimers()
    const dA = deferred()
    let n = 0
    api.post.mockImplementation(() => (n++ === 0 ? dA.promise : Promise.resolve({})))
    api.get.mockResolvedValue({ data: { running: true, done: 0, total: 1, failed: [] } })
    const { result } = renderHook(() => useReportGeneration({ onRefreshList: vi.fn() }))
    let pA
    act(() => { pA = result.current.generateBatch(['X', 'Y']) })
    await act(async () => { await result.current.generateOne('BBB') })
    await act(async () => { dA.reject(errStatus(500)); await pA })
    expect(result.current.generating).toBe('BBB')
    expect(showToast.mock.calls.map(c => c[0])).toEqual(['일괄 생성 요청 실패'])
    result.current.cleanup(); vi.useRealTimers()
  })
})

describe('진입 게이트 — 생성 중 카드 본문 클릭', () => {
  const noReport = { dates: [], summary: null, market: 'US' }
  const base = (over) => ({
    ticker: 'AAPL', info: noReport, pnl: null, guruMap: {}, isAdmin: false,
    genProgress: { done: 0, total: 0, failed: [] }, touchStyle: {},
    openDetail: vi.fn(), generateOne: vi.fn(), openEdit: vi.fn(), handleDelete: vi.fn(),
    handleGlobalDelete: vi.fn(), setPromoteTarget: vi.fn(), handlePinToggle: vi.fn(),
    selected: { ticker: null }, view: 'list', ...over,
  })

  for (const [name, Comp, cls] of [['StockCard', StockCard, '.stock-card'], ['TickerListItem', TickerListItem, '.report-item']]) {
    it(`${name} — 생성 중이면 generateOne을 부르지 않는다`, () => {
      const p = base({ generating: 'MSFT' })
      const { container } = render(<Comp {...p} />)
      fireEvent.click(container.querySelector(cls))
      expect(p.generateOne).not.toHaveBeenCalled()
    })
    it(`${name} — 생성 중이 아니면 여전히 generateOne을 부른다(양성 축)`, () => {
      const p = base({ generating: null })
      const { container } = render(<Comp {...p} />)
      fireEvent.click(container.querySelector(cls))
      expect(p.generateOne).toHaveBeenCalledWith('AAPL')
    })
  }
})

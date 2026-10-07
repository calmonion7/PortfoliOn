// task#379 S2 — useReportList::fetchList 세대 가드(B49 §7.3).
//
// fetchList는 마운트·↺·종목 추가/삭제/핀 후·생성 완료 후 여러 곳에서 불린다. 두 호출이 겹쳐
// 옛 응답이 늦게 착지하면 방금 추가한 종목이 목록에서 사라지고, 옛 finally가 로딩을 끄며,
// 옛 실패가 새 목록 위에 「조회 실패」를 띄운다. 새 요청을 in-flight로 붙잡은 채 옛 응답을 착지시킨다.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'

vi.mock('../api', () => ({ default: { get: vi.fn() } }))

import api from '../api'
import useReportList from './useReportList'

function deferred() {
  let resolve, reject
  const promise = new Promise((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}
const list = (...tickers) => ({ data: { stocks: Object.fromEntries(tickers.map(t => [t, { category: 'watchlist', dates: [] }])) } })
const flush = () => act(() => new Promise((r) => setTimeout(r, 0)))

// /api/report/list 호출마다 차례로 deferred를 돌려준다(0번 = 마운트).
function mockLists(n) {
  const ds = Array.from({ length: n }, deferred)
  let i = 0
  api.get.mockImplementation((url) => {
    if (url === '/api/report/list') return ds[i++].promise
    return Promise.resolve({ data: [] })   // 구루 인기도
  })
  return ds
}

beforeEach(() => { vi.clearAllMocks() })

describe('useReportList fetchList — 세대 가드', () => {
  it('옛 목록 응답이 늦게 착지해도 새 목록을 덮지 않는다', async () => {
    const [r0, r1] = mockLists(2)
    const { result } = renderHook(() => useReportList())
    act(() => { result.current.fetchList() })   // 종목 추가 뒤 재조회

    r1.resolve(list('AAA', 'BBB'))
    await flush()
    r0.resolve(list('AAA'))   // 마운트 응답이 마지막에 착지
    await flush()
    expect(Object.keys(result.current.reportList)).toEqual(['AAA', 'BBB'])
  })

  it('옛 요청의 finally가 진행 중인 새 요청의 로딩을 끄지 않는다', async () => {
    const [r0, r1] = mockLists(2)
    const { result } = renderHook(() => useReportList())
    act(() => { result.current.fetchList() })

    r0.resolve(list('AAA'))
    await flush()
    expect(result.current.listLoading).toBe(true)

    r1.resolve(list('AAA', 'BBB'))
    await flush()
    expect(result.current.listLoading).toBe(false)
  })

  it('옛 요청의 실패가 새 목록 위에 조회 실패를 띄우지 않는다', async () => {
    const [r0, r1] = mockLists(2)
    const { result } = renderHook(() => useReportList())
    act(() => { result.current.fetchList() })

    r1.resolve(list('AAA', 'BBB'))
    await flush()
    r0.reject(new Error('late'))
    await flush()
    expect(result.current.listFailed).toBe(false)
  })
})

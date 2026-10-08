// 폴링 틱 겹침 (task#380 S4 N4+N14)
//
// 응답이 인터벌(1.5s)보다 느리면(배포 직후 백엔드 수 분 무응답) 틱이 쌓여 순서 없이 착지한다:
// 진행률이 뒤로 가고 완료 처리가 두 번 일어난다. 또 새 폴링을 시작한 뒤 옛 틱이 늦게 착지하면
// 옛 틱이 새 인터벌을 `_stopPoll`하고 옛 `onDone`을 부른다.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, render, act, fireEvent } from '@testing-library/react'

const showToast = vi.fn()
vi.mock('../api', () => ({ default: { get: vi.fn(), post: vi.fn() } }))
vi.mock('../components/Toast', () => ({ useToast: () => ({ showToast }) }))
vi.mock('../contexts/AuthContext', () => ({ useAuth: () => ({ role: 'admin' }) }))

import api from '../api'
import useReportGeneration from '../hooks/useReportGeneration'
import ReportManualGen from '../pages/ReportManualGen'

/** url별로 호출을 세고, 응답을 `handlers[url](n)`(n=1부터)이 주는 promise로 돌려준다. */
function stub(handlers) {
  const calls = {}
  api.get.mockImplementation((url) => {
    calls[url] = (calls[url] || 0) + 1
    const h = handlers[url]
    return h ? h(calls[url]) : Promise.resolve({ data: {} })
  })
  return calls
}
function deferred() {
  let resolve
  const p = new Promise((r) => { resolve = r })
  return { p, resolve }
}
const tick = (ms) => act(async () => { await vi.advanceTimersByTimeAsync(ms) })

beforeEach(() => { vi.clearAllMocks(); vi.useFakeTimers() })
afterEach(() => { vi.useRealTimers() })

describe('useReportGeneration — 틱 겹침', () => {
  it('이전 틱이 in-flight이면 다음 틱은 요청하지 않는다', async () => {
    api.post.mockResolvedValue({ data: {} })
    const d1 = deferred()
    const calls = stub({
      '/api/report/progress': (n) => (n === 1 ? d1.p : Promise.resolve({ data: { running: true, done: 5, total: 10, failed: [] } })),
    })
    const { result } = renderHook(() => useReportGeneration({ onApplyList: vi.fn() }))
    await act(async () => { await result.current.generateBatch(['A']) })

    await tick(1600 * 4) // 틱 4번 분량 동안 tick-1이 안 돌아옴
    expect(calls['/api/report/progress']).toBe(1)

    await act(async () => { d1.resolve({ data: { running: true, done: 2, total: 10, failed: [] } }) })
    await tick(1600)
    expect(calls['/api/report/progress']).toBe(2) // 풀리면 다시 돈다(stall 아님)
    expect(result.current.genProgress.done).toBe(5)
  })

  it('새 폴링 시작 뒤 옛 틱이 착지해도 새 인터벌을 죽이지 않고 옛 onDone도 안 부른다', async () => {
    api.post.mockResolvedValue({ data: {} })
    const d1 = deferred()
    const calls = stub({
      '/api/report/progress': (n) => (n === 1 ? d1.p : Promise.resolve({ data: { running: true, done: 1, total: 9, failed: [] } })),
      '/api/report/list': () => Promise.resolve({ data: [] }),
    })
    const { result } = renderHook(() => useReportGeneration({ onApplyList: vi.fn() }))
    await act(async () => { await result.current.generateBatch(['A']) })
    await tick(1600) // P1 tick-1 in flight
    await act(async () => { await result.current.generateBatch(['B']) }) // P2 시작
    await tick(1600)
    const before = calls['/api/report/progress']

    // 옛 틱이 「완료」로 착지
    await act(async () => { d1.resolve({ data: { running: false, done: 2, total: 2, failed: [] } }) })
    await tick(1600 * 3)

    expect(calls['/api/report/progress']).toBeGreaterThan(before) // P2 인터벌 생존
    expect(showToast.mock.calls.filter(c => /생성 완료/.test(c[0])).length).toBe(0) // 옛 onDone 미호출
  })

  it('옛 틱이 「실패」로 늦게 착지해도 새 폴링의 in-flight 표지를 풀지 않는다(catch 경로 세대)', async () => {
    api.post.mockResolvedValue({ data: {} })
    let rejectOld
    const old = new Promise((_, rej) => { rejectOld = rej })
    const p2 = deferred()
    const calls = stub({
      '/api/report/progress': (n) => (n === 1 ? old : n === 2 ? p2.p : Promise.resolve({ data: { running: true, done: 1, total: 9, failed: [] } })),
    })
    const { result } = renderHook(() => useReportGeneration({ onApplyList: vi.fn() }))
    await act(async () => { await result.current.generateBatch(['A']) })
    await tick(1600) // P1 tick-1 in flight
    await act(async () => { await result.current.generateBatch(['B']) }) // P2 시작
    await tick(1600) // P2 tick-1(n=2) in flight
    expect(calls['/api/report/progress']).toBe(2)

    await act(async () => { rejectOld(new Error('stale')) }) // 옛 틱이 실패로 착지
    await tick(1600 * 3)
    expect(calls['/api/report/progress']).toBe(2) // P2 틱이 아직 대기 중 — 겹친 요청 없음
  })
})

describe('ReportManualGen — 틱 겹침', () => {
  async function mount() {
    const calls = {}
    const held = { progress: deferred(), backfill: deferred() }
    api.get.mockImplementation((url) => {
      calls[url] = (calls[url] || 0) + 1
      if (url.startsWith('/api/report/list')) {
        return Promise.resolve({ data: { stocks: { AAPL: { market: 'US', is_mine: true, dates: [], summary: { name: 'Apple' } } }, last_scheduled_date: { KR: '2026-01-02', US: '2026-01-02' } } })
      }
      if (url === '/api/report/progress') return calls[url] === 1 ? held.progress.p : Promise.resolve({ data: { running: true, done: 5, total: 10, current: 'X' } })
      if (url === '/api/report/backfill/progress') return calls[url] === 1 ? held.backfill.p : Promise.resolve({ data: { running: true, done: 5, total: 10, current: 'X', created: 0 } })
      return Promise.resolve({ data: {} })
    })
    api.post.mockResolvedValue({ data: {} })
    const utils = render(<ReportManualGen />)
    await tick(10)
    return { ...utils, calls, held }
  }

  it('생성 폴링: tick-1이 in-flight이면 추가 요청이 없다', async () => {
    const { getByText, calls, held } = await mount()
    await act(async () => { fireEvent.click(getByText(/지금 생성/)) })
    await tick(1600 * 4)
    expect(calls['/api/report/progress']).toBe(1)
    await act(async () => { held.progress.resolve({ data: { running: true, done: 2, total: 10, current: 'X' } }) })
    await tick(1600)
    expect(calls['/api/report/progress']).toBe(2)
  })

  it('백필 폴링: tick-1이 in-flight이면 추가 요청이 없다', async () => {
    const { getByText, calls, held } = await mount()
    await act(async () => { fireEvent.click(getByText('과거 스냅샷 생성')) })
    await tick(1600 * 4)
    expect(calls['/api/report/backfill/progress']).toBe(1)
    await act(async () => { held.backfill.resolve({ data: { running: true, done: 2, total: 10, current: 'X', created: 0 } }) })
    await tick(1600)
    expect(calls['/api/report/backfill/progress']).toBe(2)
  })
})

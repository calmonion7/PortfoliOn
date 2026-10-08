// task#380 S4 — 응답이 폴링 간격보다 느리면 틱이 겹쳐 진행률이 역행한다. 직전 틱이 끝나기 전엔 건너뛴다.
import { render, screen, fireEvent, act } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('../api', () => ({ default: { get: vi.fn(), post: vi.fn() } }))
vi.mock('../contexts/AuthContext', () => ({ useAuth: () => ({ role: 'admin' }) }))

import api from '../api'
import GuruCrawlNow from '../pages/GuruCrawlNow'
import ConsensusSettings from '../pages/ConsensusSettings'
import LeverageBackfillSettings from '../pages/LeverageBackfillSettings'

// progress URL의 get만 보류(deferred)시킨다. n번째 요청은 done=n을 돌려줄 예정.
let pending, seq
function holdProgress(url, mk) {
  pending = []
  seq = 0
  api.get.mockImplementation((u) => {
    if (u === url) {
      const n = ++seq
      return new Promise((resolve) => pending.push(() => resolve({ data: mk(n) })))
    }
    return Promise.resolve({ data: { last_updated: 'x', total: 0, min_date: null, by_year: [] } })
  })
  api.post.mockResolvedValue({ data: {} })
}
// 보류된 응답을 역순(= 늦게 온 옛 응답이 마지막)으로 해소한다.
const flushReverse = async () => {
  const fns = pending.splice(0)
  for (const f of fns.reverse()) await act(async () => { f() })
}
const wait = (ms) => act(async () => { await vi.advanceTimersByTimeAsync(ms) })
const progressCalls = (url) => api.get.mock.calls.filter(c => c[0] === url).length

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true })
  api.get.mockReset()
  api.post.mockReset()
})
afterEach(() => vi.useRealTimers())

const CASES = [
  {
    name: 'GuruCrawlNow', Page: GuruCrawlNow, url: '/api/guru/crawl/progress', interval: 2000, btn: '지금 갱신',
    mk: (n) => ({ running: true, done: n, total: 9, current: 'M', result: null }),
    shown: (n) => screen.getByText(`${n} / 9`),
  },
  {
    name: 'ConsensusSettings', Page: ConsensusSettings, url: '/api/consensus/batch/progress', interval: 1500, btn: '지금 수집/백필',
    mk: (n) => ({ running: true, done: n, total: 9, current: 'M' }),
    shown: (n) => screen.getByRole('button', { name: `M (${n}/9)` }),
  },
  {
    name: 'LeverageBackfillSettings', Page: LeverageBackfillSettings, url: '/api/market/leverage/backfill/progress', interval: 2000,
    btn: /백필 시작/,
    mk: (n) => ({ running: true, done: n, total: 9, current: 'M', error: '' }),
    shown: (n) => screen.getByRole('button', { name: `M (${n}/9)` }),
  },
]

describe.each(CASES)('$name 폴링 틱 겹침', ({ Page, url, interval, btn, mk, shown }) => {
  async function start() {
    holdProgress(url, mk)
    render(<Page />)
    fireEvent.click(await screen.findByRole('button', { name: btn }))
    await wait(0)
  }

  it('직전 틱이 안 끝났으면 요청을 더 보내지 않는다', async () => {
    await start()
    await wait(interval * 4)
    expect(progressCalls(url)).toBe(1)
  })

  it('늦게 온 옛 응답이 최신 진행률을 덮지 않는다', async () => {
    await start()
    await wait(interval * 3)
    await flushReverse()
    const maxDone = progressCalls(url)   // 겹친 틱이 있었다면 3, 없었다면 1
    shown(maxDone)
  })

  it('응답이 끝나면 다음 틱이 다시 나간다 (플래그 해제)', async () => {
    await start()
    await wait(interval)
    await flushReverse()
    await wait(interval)
    expect(progressCalls(url)).toBe(2)
  })
})

describe('GuruCrawlNow 완료 처리 1회', () => {
  it('종료 응답이 겹쳐 와도 managers 재조회는 1회다', async () => {
    holdProgress('/api/guru/crawl/progress', () => ({ running: false, done: 9, total: 9, current: '', result: 'saved', fresh: 9 }))
    render(<GuruCrawlNow />)
    fireEvent.click(await screen.findByRole('button', { name: '지금 갱신' }))
    await wait(0)
    await wait(2000 * 3)
    await flushReverse()
    expect(progressCalls('/api/guru/managers')).toBe(2)   // 마운트 1 + 완료 1
  })
})

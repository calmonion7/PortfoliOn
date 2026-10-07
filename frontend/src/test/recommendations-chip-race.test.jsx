// task#379 S1 — Recommendations handleChip 레이스(B49 §7.3).
//
// 칩 A→B 연타 시 A 응답이 늦게 착지하면 B 칩 아래 A 목록이 뜨고, A의 finally가 B의
// 스켈레톤을 끄며, A의 실패가 B 화면에 토스트를 띄운다. 또 칩을 바꾼 뒤 그 요청이 실패하면
// 옛 칩의 목록이 새 칩 아래 남는다(보존). 새 요청을 in-flight로 붙잡은 채 옛 응답을 착지시킨다.
// (마운트 요청은 진행 중 페이지 전체가 스켈레톤이라 칩을 누를 수 없다 — 마운트↔칩 경로는 도달 불가.)
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

const { showToast } = vi.hoisted(() => ({ showToast: vi.fn() }))
vi.mock('../api', () => ({ default: { get: vi.fn(), post: vi.fn() } }))
vi.mock('../components/Toast', () => ({ useToast: () => ({ showToast }) }))

import api from '../api'
import Recommendations from '../pages/Recommendations'

function deferred() {
  let resolve, reject
  const promise = new Promise((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}
const rec = (name) => ({ data: { discovery: [{ ticker: `T${name.length}${name.charCodeAt(0)}`, name, market: 'KR', exchange: 'KS', score: 7, flags: [] }],
  watchlist: [], holdings: [], as_of: '2026-10-01' } })
const flush = () => act(() => new Promise((r) => setTimeout(r, 0)))

function mockChips(byMarket) {
  api.get.mockImplementation((url, config) => {
    if (url === '/api/stocks') return Promise.resolve({ data: [] })
    if (url === '/api/guru/managers') return Promise.resolve({ data: { managers: [] } })
    if (url === '/api/recommendations') {
      const m = config?.params?.market
      return m ? byMarket[m].promise : Promise.resolve(rec('전체종목'))
    }
    return Promise.resolve({ data: [] })
  })
}

async function mount() {
  render(<MemoryRouter><Recommendations /></MemoryRouter>)
  await screen.findByText('전체종목')
}

beforeEach(() => { vi.clearAllMocks() })

describe('Recommendations handleChip — 세대 가드', () => {
  it('옛 칩 응답이 늦게 착지해도 새 칩 목록을 덮지 않는다', async () => {
    const kr = deferred(); const us = deferred()
    mockChips({ KR: kr, US: us })
    await mount()
    fireEvent.click(screen.getByText('국내'))
    fireEvent.click(screen.getByText('해외'))

    us.resolve(rec('해외종목'))
    await flush()
    kr.resolve(rec('국내종목'))   // 옛 칩이 마지막에 착지
    await flush()
    expect(screen.getByText('해외종목')).toBeInTheDocument()
    expect(screen.queryByText('국내종목')).not.toBeInTheDocument()
  })

  it('옛 칩 요청의 finally가 진행 중인 새 칩의 스켈레톤을 끄지 않는다', async () => {
    const kr = deferred(); const us = deferred()
    mockChips({ KR: kr, US: us })
    await mount()
    fireEvent.click(screen.getByText('국내'))
    fireEvent.click(screen.getByText('해외'))

    kr.resolve(rec('국내종목'))   // 새 칩(US)은 아직 in-flight
    await flush()
    expect(screen.queryByText('국내종목')).not.toBeInTheDocument()
    expect(screen.queryByText('전체종목')).not.toBeInTheDocument()
    // 스켈레톤이 꺼지면 null 목록이 「실패」 문구로 그려진다 — 진행 중에 실패를 말하면 안 된다.
    expect(screen.queryByText('발굴 목록을 불러오지 못했습니다.')).not.toBeInTheDocument()

    us.resolve(rec('해외종목'))
    await flush()
    expect(screen.getByText('해외종목')).toBeInTheDocument()
  })

  it('옛 칩 요청의 실패가 새 칩 화면에 토스트를 띄우지 않는다', async () => {
    const kr = deferred(); const us = deferred()
    mockChips({ KR: kr, US: us })
    await mount()
    fireEvent.click(screen.getByText('국내'))
    fireEvent.click(screen.getByText('해외'))

    us.resolve(rec('해외종목'))
    await flush()
    kr.reject(new Error('late'))
    await flush()
    expect(showToast).not.toHaveBeenCalled()
    expect(screen.getByText('해외종목')).toBeInTheDocument()
  })

  it('실패한 칩을 다시 누르면 재조회한다(실패 문구에서 빠져나갈 길)', async () => {
    const kr = deferred(); const kr2 = deferred()
    let n = 0
    mockChips({ KR: { get promise() { return (n++ === 0 ? kr : kr2).promise } } })
    await mount()
    fireEvent.click(screen.getByText('국내'))
    kr.reject(new Error('down'))
    await flush()
    expect(screen.getByText('발굴 목록을 불러오지 못했습니다.')).toBeInTheDocument()

    fireEvent.click(screen.getByText('국내'))
    kr2.resolve(rec('국내종목'))
    await flush()
    expect(screen.getByText('국내종목')).toBeInTheDocument()
  })

  it('칩을 바꾼 요청이 실패하면 옛 칩 목록을 새 칩 아래 남기지 않는다(보존)', async () => {
    const kr = deferred()
    mockChips({ KR: kr })
    await mount()
    fireEvent.click(screen.getByText('국내'))
    kr.reject(new Error('down'))
    await flush()
    expect(screen.queryByText('전체종목')).not.toBeInTheDocument()
    expect(showToast).toHaveBeenCalled()
  })
})

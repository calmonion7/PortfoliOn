// task#379 S1 — Ranking.jsx onRowClick 모달 레이스(B49 §7.3).
//
// 행 클릭은 history → 스냅샷 2단 조회 뒤 모달을 detail로 바꾼다. 세대 가드가 없으면
// ① 닫은 모달을 늦은 응답이 다시 열고 ② A→B 연속 클릭 시 B 모달에 A 리포트가 뜨며
// ③ 먼저 끝난 A의 finally가 아직 진행 중인 B의 스피너를 끈다.
// 각 케이스는 새 요청을 in-flight로 붙잡은 채 낡은 응답을 착지시킨다 — 새 요청을 먼저
// 해소하는 픽스처는 가드를 지워도 초록이다.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

vi.mock('../api', () => ({ default: { get: vi.fn(), post: vi.fn(), delete: vi.fn() } }))
vi.mock('../components/Toast', () => ({ useToast: () => ({ showToast: vi.fn() }) }))
vi.mock('../hooks/useIsMobile', () => ({ default: () => false }))

import api from '../api'
import Ranking from '../pages/Ranking'

globalThis.IntersectionObserver = class {
  observe() {} unobserve() {} disconnect() {}
}

const row = (ticker) => ({ ticker, name: `${ticker} Corp`, exchange: 'US', price: 1, change_pct: 1,
  trading_value: 1, trading_volume: 1, rank: 1 })

function deferred() {
  let resolve
  const promise = new Promise((r) => { resolve = r })
  return { promise, resolve }
}

// history 응답을 티커별로 제어한다. 스냅샷 본문 조회는 즉시 해소.
function mockApi(history) {
  api.get.mockImplementation((url) => {
    if (url === '/api/stocks') return Promise.resolve({ data: [] })
    if (url.startsWith('/api/rankings')) return Promise.resolve({ data: { items: [row('AAA'), row('BBB')] } })
    const m = url.match(/^\/api\/report\/([A-Z]+)\/history$/)
    if (m) return history[m[1]]
    const s = url.match(/^\/api\/report\/([A-Z]+)\/\d{4}-\d{2}-\d{2}$/)
    if (s) return Promise.resolve({ data: { summary: { name: `${s[1]} 리포트`, market: 'US' } } })
    return Promise.resolve({ data: [] })
  })
}

const SNAPSHOT = { data: [{ date: '2026-10-01', has_snapshot: true }] }
const flush = () => act(() => new Promise((r) => setTimeout(r, 0)))

beforeEach(() => { vi.clearAllMocks() })

describe('Ranking onRowClick — 세대 가드', () => {
  it('닫은 모달을 늦게 도착한 응답이 다시 열지 않는다', async () => {
    const a = deferred()
    mockApi({ AAA: a.promise })
    render(<MemoryRouter><Ranking /></MemoryRouter>)
    fireEvent.click(await screen.findByText('AAA'))
    expect(document.querySelector('.modal-overlay')).not.toBeNull()

    fireEvent.mouseDown(document.querySelector('.modal-overlay'))
    expect(document.querySelector('.modal-overlay')).toBeNull()

    a.resolve(SNAPSHOT)
    await flush()
    expect(document.querySelector('.modal-overlay')).toBeNull()
  })

  it('A→B 연속 클릭 뒤 A가 늦게 착지해도 B 모달에 A 리포트가 뜨지 않는다', async () => {
    const a = deferred()
    const b = deferred()
    mockApi({ AAA: a.promise, BBB: b.promise })
    render(<MemoryRouter><Ranking /></MemoryRouter>)
    fireEvent.click(await screen.findByText('AAA'))
    fireEvent.click(screen.getByText('BBB'))

    // B가 먼저 끝나(스냅샷 없음 → 기본정보 모달) 스피너가 내려간 뒤에 A가 착지해야
    // 낡은 A 리포트가 화면에 드러난다 — B가 마지막이면 B가 덮어 가드 없이도 초록이다.
    b.resolve({ data: [] })
    await flush()
    a.resolve(SNAPSHOT)
    await flush()
    expect(screen.queryByText('AAA 리포트')).not.toBeInTheDocument()
    expect(document.querySelector('.modal').textContent).toContain('BBB')
  })

  it('먼저 끝난 A의 finally가 진행 중인 B의 스피너를 끄지 않는다', async () => {
    const a = deferred()
    const b = deferred()
    mockApi({ AAA: a.promise, BBB: b.promise })
    render(<MemoryRouter><Ranking /></MemoryRouter>)
    fireEvent.click(await screen.findByText('AAA'))
    fireEvent.click(screen.getByText('BBB'))

    a.resolve({ data: [] })   // A: 스냅샷 없음 → finally
    await flush()
    expect(screen.getByText('리서치 불러오는 중입니다.')).toBeInTheDocument()

    b.resolve({ data: [] })
    await flush()
    expect(screen.queryByText('리서치 불러오는 중입니다.')).not.toBeInTheDocument()
  })
})

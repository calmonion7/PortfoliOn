// task#379 S1 — Calendar 월 이펙트 레이스(B49 §7.3).
//
// `›` 연타 시 옛 달 요청이 늦게 착지하면 헤더는 새 달인데 이벤트는 옛 달 것으로 덮이고
// (셀이 비어 보인다), 옛 요청의 finally가 새 요청의 스켈레톤을 끄고, 옛 요청의 실패가
// 새 달 화면을 에러로 바꾼다. 새 요청을 in-flight로 붙잡은 채 옛 응답을 착지시킨다.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

vi.mock('../api', () => ({ default: { get: vi.fn(), delete: vi.fn() } }))
vi.mock('../components/Toast', () => ({ useToast: () => ({ showToast: vi.fn() }) }))
vi.mock('../hooks/useIsMobile', () => ({ default: () => false }))

import api from '../api'
import Calendar from '../pages/Calendar'

function deferred() {
  let resolve, reject
  const promise = new Promise((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}

const ym = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
const now = new Date()
const CUR = ym(now)
const NEXT = ym(new Date(now.getFullYear(), now.getMonth() + 1, 1))
// 각 달 15일의 이벤트 1건 — 타입 미상이라 셀에 '●' 마커로 그려진다.
const ev = (m) => ({ data: { events: [{ date: `${m}-15`, type: 'zz', title: `ev-${m}` }] } })

const flush = () => act(() => new Promise((r) => setTimeout(r, 0)))
const dots = () => screen.queryAllByText('●').length

function mockMonths(pending) {
  api.get.mockImplementation((url) => {
    const m = url.match(/month=(\d{4}-\d{2})$/)?.[1]
    if (pending[m]) return pending[m].promise
    return Promise.resolve({ data: { events: [] } })   // 인접 달 프리페치
  })
}

beforeEach(() => { vi.clearAllMocks() })

describe('Calendar 월 이펙트 — 취소 가드', () => {
  it('옛 달 응답이 늦게 착지해도 새 달 이벤트를 덮지 않는다', async () => {
    const cur = deferred()
    const next = deferred()
    mockMonths({ [CUR]: cur, [NEXT]: next })
    render(<MemoryRouter><Calendar /></MemoryRouter>)
    fireEvent.click(screen.getByLabelText('다음 달'))

    next.resolve(ev(NEXT))
    await flush()
    expect(dots()).toBe(1)

    cur.resolve(ev(CUR))   // 옛 달이 마지막에 착지
    await flush()
    expect(dots()).toBe(1)
  })

  it('옛 달 요청의 finally가 진행 중인 새 달의 스켈레톤을 끄지 않는다', async () => {
    const cur = deferred()
    const next = deferred()
    mockMonths({ [CUR]: cur, [NEXT]: next })
    render(<MemoryRouter><Calendar /></MemoryRouter>)
    fireEvent.click(screen.getByLabelText('다음 달'))

    cur.resolve(ev(CUR))
    await flush()
    expect(document.querySelector('.cal-grid')).toBeNull()   // 새 달은 아직 로딩

    next.resolve(ev(NEXT))
    await flush()
    expect(dots()).toBe(1)
  })

  it('옛 달 요청의 실패가 새 달 화면을 에러로 바꾸지 않는다', async () => {
    const cur = deferred()
    const next = deferred()
    mockMonths({ [CUR]: cur, [NEXT]: next })
    render(<MemoryRouter><Calendar /></MemoryRouter>)
    fireEvent.click(screen.getByLabelText('다음 달'))

    next.resolve(ev(NEXT))
    await flush()
    cur.reject(new Error('late'))
    await flush()
    expect(screen.queryByText('이벤트 불러오기 실패')).not.toBeInTheDocument()
    expect(dots()).toBe(1)
  })
})

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'

vi.mock('../api', () => ({ default: { get: vi.fn() } }))

import api from '../api'
import AdminAnalytics from './AdminAnalytics'

const defer = () => {
  let resolve, reject
  const promise = new Promise((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}
const hist = (name) => ({ data: [{ event_name: name, properties: {}, created_at: null }] })

let reqs
beforeEach(() => {
  reqs = { a: defer(), b: defer() }
  api.get.mockReset()
  api.get.mockImplementation((url) => {
    if (url.includes('/summary')) return Promise.resolve({ data: { dau: 1, total_events: 2, top_events: [] } })
    if (url.endsWith('/users')) return Promise.resolve({ data: [
      { user_id: 'a', email: 'a@x.com', total_events: 1 },
      { user_id: 'b', email: 'b@x.com', total_events: 1 },
    ] })
    if (url.endsWith('/users/a')) return reqs.a.promise
    if (url.endsWith('/users/b')) return reqs.b.promise
    throw new Error(url)
  })
})

// A 상세(held) → 목록 → B 상세(held)
async function openAThenBViaList() {
  render(<AdminAnalytics />)
  const buttons = await screen.findAllByText('상세')
  fireEvent.click(buttons[0])
  fireEvent.click(await screen.findByText('← 목록'))
  fireEvent.click((await screen.findAllByText('상세'))[1])
  await screen.findByText('이벤트 히스토리 (최근 200건)')
}

describe('AdminAnalytics showUserHistory 경합', () => {
  it('늦게 도착한 A 응답이 B 화면을 덮지 않고 스피너도 꺼져 있다', async () => {
    await openAThenBViaList()
    await act(async () => { reqs.b.resolve(hist('nav_market')) })
    expect(await screen.findByText('시장')).toBeTruthy()
    await act(async () => { reqs.a.resolve(hist('nav_guru')) })
    expect(screen.getByText('시장')).toBeTruthy()
    expect(screen.queryByText('구루')).toBeNull()
    expect(screen.queryByText('로딩 중...')).toBeNull()
  })

  it('늦게 reject된 A가 B의 히스토리를 비우지 않는다', async () => {
    await openAThenBViaList()
    await act(async () => { reqs.b.resolve(hist('nav_market')) })
    expect(await screen.findByText('시장')).toBeTruthy()
    await act(async () => { reqs.a.reject(new Error('boom')) })
    expect(screen.getByText('시장')).toBeTruthy()
  })

  it('B가 아직 in-flight일 때 늦은 A의 finally가 B 로딩을 끄지 않는다', async () => {
    await openAThenBViaList()
    expect(screen.getByText('로딩 중...')).toBeTruthy()
    await act(async () => { reqs.a.resolve(hist('nav_guru')) })
    expect(screen.getByText('로딩 중...')).toBeTruthy()
    expect(screen.queryByText('구루')).toBeNull()
    await act(async () => { reqs.b.resolve(hist('nav_market')) })
    await waitFor(() => expect(screen.getByText('시장')).toBeTruthy())
  })

  it('← 목록 후 A가 도착해도 다음 B의 로딩 상태를 건드리지 않는다(목록 증분)', async () => {
    render(<AdminAnalytics />)
    fireEvent.click((await screen.findAllByText('상세'))[0])
    fireEvent.click(await screen.findByText('← 목록'))
    await act(async () => { reqs.a.resolve(hist('nav_guru')) })
    // 목록 화면: A의 늦은 finally는 아무것도 바꾸지 않아야 하며, 이후 B를 열면 로딩 중이어야 한다
    fireEvent.click((await screen.findAllByText('상세'))[1])
    expect(await screen.findByText('로딩 중...')).toBeTruthy()
    expect(screen.queryByText('구루')).toBeNull()
  })
})

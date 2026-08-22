/**
 * B76 형제 — 랭킹 행 모달의 뉴스 조회 **실패**를 「없음」으로 붕괴시키던 것.
 *
 * `pages/Ranking.jsx::BasicInfo`는 이미 3값 관용구를 주석으로 선언(`null=로딩 중, []=없음`)하고
 * 있었는데 `.catch`만 `setNews([])`였다 — 그래서 5xx·타임아웃에서 화면이
 * **「관련 뉴스가 없습니다.」라고 단정**했다. 사용자는 그 종목에 뉴스가 실제로 없다고 읽고
 * 다른 소스를 찾지 않는다(실제로는 *물어보지 못한 것*).
 *
 * ⚠️ 자동 게이트는 이 클래스에 **원리적으로 블라인드**하다 — 타입도 렌더도 정상이고, 실패 케이스
 * 테스트가 없으면 아무것도 깨지지 않는다(task#307이 승급한 결함 클래스).
 *
 * 축은 항상 **3상태 전부**를 쌍으로 잰다: 미조회(로딩) · 0건(사실) · 실패. 실패만 재면
 * 「아무 뉴스 구역도 안 그리는 구현」에서도 통과한다(그건 기능 삭제다).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, act } from '@testing-library/react'

vi.mock('../api', () => ({ default: { get: vi.fn() } }))

import api from '../api'
import { BasicInfo } from '../pages/Ranking'

const ROW = {
  ticker: 'AAPL', name: 'Apple', market: 'US', price: 100, change_pct: 1.2,
  trading_value: 1e9, trading_volume: 1e6, market_cap: 3e12,
}
const NO_NEWS = '관련 뉴스가 없습니다.'
const LOADING = '뉴스 불러오는 중…'
const FAILED = '뉴스를 불러오지 못했습니다.'

const renderInfo = () => render(
  <BasicInfo row={ROW} market="US" adding={false} onAdd={() => {}} onClose={() => {}} />
)

const settle = async (fn) => {
  await act(async () => {
    fn()
    await Promise.resolve()
    await new Promise(r => setTimeout(r, 20))
  })
}

beforeEach(() => {
  api.get.mockReset()
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})

describe('BasicInfo 뉴스 — 미조회·0건·실패가 서로 다른 문구다', () => {
  it('⚠️ 조회 실패는 「없음」이라고 단정하지 않는다', async () => {
    api.get.mockRejectedValue(new Error('boom'))
    renderInfo()
    await waitFor(() => expect(screen.getByTestId('ranking-news-error')).toBeTruthy())
    expect(screen.getByText(FAILED)).toBeTruthy()
    expect(screen.queryByText(NO_NEWS)).toBeNull()   // ← 이 한 줄이 결함의 본체다
    expect(screen.queryByText(LOADING)).toBeNull()
  })

  it('✅ 대조군 — 조회 성공 + 0건은 **사실**이므로 그때는 「없음」이 뜬다', async () => {
    api.get.mockResolvedValue({ data: { news: [] } })
    renderInfo()
    await waitFor(() => expect(screen.getByText(NO_NEWS)).toBeTruthy())
    expect(screen.queryByTestId('ranking-news-error')).toBeNull()
  })

  it('미조회(in-flight) 동안에도 「없음」이라고 말하지 않는다', async () => {
    let resolve
    api.get.mockReturnValue(new Promise((res) => { resolve = res }))
    renderInfo()
    expect(screen.getByText(LOADING)).toBeTruthy()
    expect(screen.queryByText(NO_NEWS)).toBeNull()
    expect(screen.queryByTestId('ranking-news-error')).toBeNull()

    // ✅ 대조군 — 도착하면 목록이 렌더된다(로딩에 영구 갇히는 구현이 아니다).
    await settle(() => resolve({ data: { news: [{ title: '뉴스1', link: 'http://x', publisher: 'P', published_at: '2026-08-01' }] } }))
    expect(screen.getByText('뉴스1')).toBeTruthy()
    expect(screen.queryByText(LOADING)).toBeNull()
  })

  it('실패는 조용히 삼키지 않는다 — `[Ranking]` 마커로 warn(§4.5 graceful)', async () => {
    api.get.mockRejectedValue(new Error('boom'))
    renderInfo()
    await waitFor(() => expect(screen.getByTestId('ranking-news-error')).toBeTruthy())
    const msg = console.warn.mock.calls.map(c => String(c[0])).find(m => m.includes('[Ranking]'))
    expect(msg).toBeTruthy()
    expect(msg).toContain('뉴스 조회 실패')
  })

  it('실패는 캐시되지 않는다 — 재마운트가 다시 조회한다', async () => {
    api.get.mockRejectedValueOnce(new Error('boom'))
    const first = renderInfo()
    await waitFor(() => expect(screen.getByTestId('ranking-news-error')).toBeTruthy())
    first.unmount()

    api.get.mockResolvedValue({ data: { news: [] } })
    renderInfo()
    await waitFor(() => expect(screen.getByText(NO_NEWS)).toBeTruthy())
    expect(api.get).toHaveBeenCalledTimes(2)
  })
})

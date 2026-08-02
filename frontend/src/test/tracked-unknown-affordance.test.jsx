// B10·B11·B12 — 추적상태 조회가 실패하면 화면은 **액션을 제시하지 않는다**.
//
// 조회 실패가 "미추적"으로 붕괴하면 화면이 잘못된 동사를 제시한다: 이미 관심에 있는 종목에
// 「☆ 추가」를 보여 누르면 중복 추가가 되고(제거하려던 의도와 반대), 이미 추적 중인 종목을
// 검색하면 리포트가 아니라 추가 모달로 보낸다. `wrong < missing`의 어포던스 판이다.
//
// 여기서 판정하는 것은 **어떤 쓰기 요청도 나가지 않는다**는 것 — 시각 스타일이 아니라
// 부작용의 부재다(그래서 jsdom이 완전히 단언할 수 있다).
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

vi.mock('../api', () => ({ default: { get: vi.fn(), post: vi.fn(), delete: vi.fn() } }))
vi.mock('../components/Toast', () => ({ useToast: () => ({ showToast: vi.fn() }) }))
vi.mock('../hooks/useIsMobile', () => ({ default: () => false }))

import api from '../api'
import GuruStats from '../pages/GuruStats'
import GuruAllocation from '../pages/GuruAllocation'
import GuruManagers from '../pages/GuruManagers'

const STOCK = { ticker: 'AAPL', name: 'Apple', name_kr: '애플' }

/** /api/stocks만 실패시키고 나머지는 정상 — 본문은 살고 추적상태만 '모름'이 된다. */
function mockTrackedFailure(extra = {}) {
  api.get.mockImplementation((url) => {
    if (url === '/api/stocks') return Promise.reject(new Error('tracked down'))
    if (url in extra) return Promise.resolve({ data: extra[url] })
    return Promise.resolve({ data: [] })
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  api.post.mockResolvedValue({})
  api.delete.mockResolvedValue({})
})

describe('B10 — 추적상태 모름이면 토글 어포던스가 비활성이고 쓰기가 나가지 않는다', () => {
  it('GuruStats', async () => {
    mockTrackedFailure({
      '/api/guru/stats/popularity': [{ ...STOCK, count: 7 }],
      '/api/guru/stats/weighted': [{ ...STOCK, score: 0.5 }],
    })
    render(<GuruStats view="popularity" />)
    const btn = await screen.findByTitle('보유·관심 상태를 불러오지 못했습니다')
    expect(btn).toBeDisabled()
    fireEvent.click(btn)
    expect(api.post).not.toHaveBeenCalled()
    expect(api.delete).not.toHaveBeenCalled()
  })

  it('GuruAllocation', async () => {
    mockTrackedFailure({
      '/api/guru/stats/allocation': {
        total_value: 1000, manager_count: 83, all_manager_count: 83, all_total_value: 1000,
        ticker_count: 1, periods: { 'Q1 2026': 83 }, estimated_count: 0,
        last_updated: '2026-08-01T00:00:00',
        rows: [{ ticker: 'AAPL', name: 'Apple', name_kr: '애플', value: 1e9,
                 ratio: 10.0, holder_count: 3 }],
      },
    })
    render(<MemoryRouter><GuruAllocation /></MemoryRouter>)
    const btn = await screen.findByTitle('보유·관심 상태를 불러오지 못했습니다')
    expect(btn).toBeDisabled()
    fireEvent.click(btn)
    expect(api.post).not.toHaveBeenCalled()
    expect(api.delete).not.toHaveBeenCalled()
  })

  it('GuruManagers 배지 — span이라 aria-disabled로 알리고 클릭을 무시한다', async () => {
    mockTrackedFailure({
      '/api/guru/managers': { last_updated: '2026-07-01T00:00:00', managers: [
        { id: 'brk', name: 'Warren Buffett', firm: 'Berkshire', portfolio_value: 1e9, num_stocks: 1,
          top10: [{ rank: 1, ticker: 'AAPL', name: 'Apple', name_kr: '', weight_pct: 40 }] },
      ] },
    })
    render(<MemoryRouter><GuruManagers /></MemoryRouter>)
    const badge = await screen.findByText('AAPL')
    const el = badge.closest('[aria-disabled]') || badge
    expect(el).toHaveAttribute('aria-disabled', 'true')
    fireEvent.click(el)
    await waitFor(() => expect(api.post).not.toHaveBeenCalled())
    expect(api.delete).not.toHaveBeenCalled()
  })
})

// ── B10 원본 결함 — Ranking(task#273 S2부터 useTrackedStocks 사용)에도 같은 불변식.
// B11(Recommendations 쪽 원본 결함)은 이후 B32로 재구성돼 recommendations-s3s4.test.jsx로 이전됨 ──

import Ranking from '../pages/Ranking'

// jsdom엔 IntersectionObserver가 없다(Ranking의 무한스크롤 sentinel이 쓴다).
globalThis.IntersectionObserver = class {
  observe() {} unobserve() {} disconnect() {}
}

describe('B10 — Ranking: 관심목록 조회 실패 시 별표가 비활성이고 쓰기가 나가지 않는다', () => {
  it('실패를 빈 Set으로 남기면 등록된 종목의 별이 ☆로 보여 DELETE 대신 POST가 나간다', async () => {
    // task#273 S2 — 데이터 계층이 useTrackedStocks로 이전되며 조회처가 /api/watchlist에서
    // /api/stocks로 바뀌었다(훅 계약). 불변식(별표 비활성 + 쓰기 0건)은 그대로, 목킹 URL만 갱신.
    api.get.mockImplementation((url) => {
      if (url === '/api/stocks') return Promise.reject(new Error('tracked down'))
      if (url.startsWith('/api/ranking')) return Promise.resolve({ data: {
        items: [{ ticker: 'AAPL', name: 'Apple', market: 'US', price: 1, change_pct: 1,
                  trade_value: 1, volume: 1 }], has_more: false } })
      return Promise.resolve({ data: [] })
    })
    render(<MemoryRouter><Ranking /></MemoryRouter>)
    const star = await screen.findByTitle('관심종목 상태를 불러오지 못했습니다')
    expect(star).toBeDisabled()
    fireEvent.click(star)
    expect(api.post).not.toHaveBeenCalled()
    expect(api.delete).not.toHaveBeenCalled()
  })
})

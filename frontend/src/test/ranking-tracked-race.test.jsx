// task#273 S2·S4 — Ranking.jsx 추적 상태 데이터 계층 이전 + B27 레이스 가드 회귀.
//
// S2(a): 보유 종목 행은 액션이 무의미하므로 클릭 가능한 토글을 두지 않는다(CONTEXT 「추적 상태」
//        일반화 규칙). S2(b): 컴포넌트 market 상태가 아니라 행의 exchange에서 payload를 파생하므로
//        마켓 토글 레이스(B27) 창에서도 KR 행이 US로 저장되지 않는다(ADR-0032 §결정 3).
// S4: fetchPage의 reset 호출이 세대를 올려, 뒤늦게 도착한 옛 세대 응답이 새 화면을 덮지 못한다.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

vi.mock('../api', () => ({ default: { get: vi.fn(), post: vi.fn(), delete: vi.fn() } }))
vi.mock('../components/Toast', () => ({ useToast: () => ({ showToast: vi.fn() }) }))
vi.mock('../hooks/useIsMobile', () => ({ default: () => false }))

import api from '../api'
import Ranking from '../pages/Ranking'

// jsdom엔 IntersectionObserver가 없다(Ranking의 무한스크롤 sentinel이 쓴다).
globalThis.IntersectionObserver = class {
  observe() {} unobserve() {} disconnect() {}
}

beforeEach(() => {
  vi.clearAllMocks()
  api.post.mockResolvedValue({})
  api.delete.mockResolvedValue({})
})

describe('S2(a) — 보유 종목 행에는 클릭 가능한 토글이 없다', () => {
  it('holding 행은 「보유중」 표식만 렌더하고 api.post·api.delete는 호출되지 않는다', async () => {
    api.get.mockImplementation((url) => {
      if (url === '/api/stocks') return Promise.resolve({ data: [{ ticker: 'AAPL', type: 'holding' }] })
      if (url.startsWith('/api/rankings')) return Promise.resolve({ data: {
        items: [{ ticker: 'AAPL', name: 'Apple', exchange: 'US', price: 100, change_pct: 1,
                  trading_value: 1000, trading_volume: 10, rank: 1 }],
      } })
      return Promise.resolve({ data: [] })
    })

    render(<MemoryRouter><Ranking /></MemoryRouter>)

    const badge = await screen.findByText('보유중')
    expect(screen.queryByTitle('관심종목 추가')).not.toBeInTheDocument()
    expect(screen.queryByTitle('관심종목에서 제거')).not.toBeInTheDocument()

    fireEvent.click(badge)  // 클릭 핸들러가 없는 표식이므로 아무 것도 나가지 않아야 함
    expect(api.post).not.toHaveBeenCalled()
    expect(api.delete).not.toHaveBeenCalled()
  })
})

describe('S2(b) — 레이스 면역: payload는 컴포넌트 market이 아니라 행의 exchange에서 파생된다', () => {
  it('KR 행 렌더 중 마켓 토글을 US로 바꿔도 POST payload는 market:KR·exchange:KS로 유지된다', async () => {
    api.get.mockImplementation((url) => {
      if (url === '/api/stocks') return Promise.resolve({ data: [] })
      if (url.startsWith('/api/rankings')) return Promise.resolve({ data: {
        items: [{ ticker: '005930', name: '삼성전자', exchange: 'KS', price: 70000, change_pct: 1,
                  trading_value: 1000, trading_volume: 10, rank: 1, is_etf: false }],
      } })
      return Promise.resolve({ data: [] })
    })

    render(<MemoryRouter><Ranking /></MemoryRouter>)
    await screen.findByText('005930')

    // 마켓 토글 클릭 — 컴포넌트 market 상태를 'US'로 바꾼다(B27 레이스 창 재현)
    fireEvent.click(screen.getByRole('button', { name: '🇺🇸 해외' }))

    const star = await screen.findByTitle('관심종목 추가')
    fireEvent.click(star)

    await waitFor(() => expect(api.post).toHaveBeenCalled())
    expect(api.post).toHaveBeenCalledWith('/api/watchlist', expect.objectContaining({
      ticker: '005930', market: 'KR', exchange: 'KS',
    }))
  })
})

describe('S4 — B27: 옛 세대의 응답이 뒤늦게 도착해도 새 세대의 화면을 덮지 않는다', () => {
  it('KR 응답이 미해결인 채 해외로 전환하면, 뒤늦게 도착한 KR 응답이 렌더에 반영되지 않는다', async () => {
    let resolveKr
    const krPending = new Promise((resolve) => { resolveKr = resolve })

    api.get.mockImplementation((url, config) => {
      if (url === '/api/stocks') return Promise.resolve({ data: [] })
      if (url.startsWith('/api/rankings')) {
        if (config?.params?.market === 'KR') return krPending  // 초기 마운트 요청 — 의도적으로 미해결
        return Promise.resolve({ data: {
          items: [{ ticker: 'AAPL', name: 'Apple', exchange: 'US', price: 1, change_pct: 1,
                    trading_value: 1, trading_volume: 1, rank: 1 }],
        } })
      }
      return Promise.resolve({ data: [] })
    })

    render(<MemoryRouter><Ranking /></MemoryRouter>)

    // '해외' 전환 — 리셋 이펙트가 새 세대를 발급하고, 그 요청은 즉시 해결된다.
    fireEvent.click(screen.getByRole('button', { name: '🇺🇸 해외' }))
    await screen.findByText('AAPL')

    // 옛(KR) 세대 응답이 이제야 도착
    resolveKr({ data: {
      items: [{ ticker: '005930', name: '삼성전자', exchange: 'KS', price: 70000, change_pct: 1,
                trading_value: 1, trading_volume: 1, rank: 1 }],
    } })
    await new Promise((r) => setTimeout(r, 0))

    // 6자리 국내 티커가 렌더된 행에 0건이어야 한다(자동회복 없이 고착되던 실측 버그).
    const koreanTickers = screen.queryAllByText(/^\d{6}$/)
    expect(koreanTickers).toHaveLength(0)
  })
})

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

const navigateMock = vi.fn()
vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal()
  return { ...actual, useNavigate: () => navigateMock }
})

vi.mock('../api', () => ({ default: { get: vi.fn(), post: vi.fn(), delete: vi.fn() } }))
vi.mock('../hooks/useIsMobile', () => ({ default: () => false }))

import api from '../api'
import GuruManagers from './GuruManagers'

const MANAGERS = {
  last_updated: '2026-07-01T00:00:00',
  managers: [
    {
      id: 'brk', name: 'Warren Buffett', firm: 'Berkshire Hathaway',
      portfolio_value: 350000000000, num_stocks: 45,
      top10: [{ rank: 1, ticker: 'AAPL', name: 'Apple', name_kr: '', weight_pct: 40 }],
    },
  ],
}

function mockApi({ stocks = [] } = {}) {
  api.get.mockImplementation((url) =>
    url === '/api/guru/managers' ? Promise.resolve({ data: MANAGERS }) : Promise.resolve({ data: stocks })
  )
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('GuruManagers 카드 클릭 (task#226 S5)', () => {
  it('카드 본문 클릭 시 /guru/:id 로 navigate', async () => {
    mockApi()
    render(<GuruManagers />)
    const name = await screen.findByText('Warren Buffett')
    fireEvent.click(name)
    expect(navigateMock).toHaveBeenCalledWith('/guru/brk')
  })

  it('배지 클릭 시 navigate 미발생 + watchlist API 호출', async () => {
    mockApi()
    api.post.mockResolvedValue({})
    render(<GuruManagers />)
    const badge = await screen.findByText('AAPL')
    fireEvent.click(badge)
    expect(navigateMock).not.toHaveBeenCalled()
    expect(api.post).toHaveBeenCalledWith('/api/watchlist', { ticker: 'AAPL', name: 'Apple' })
  })
})

describe('GuruManagers 탑3 배지 흡수 (task#227 S1)', () => {
  it('상위 3위 배지에 비중%·보유 구루 수가 title이 아니라 텍스트 노드로 노출', async () => {
    mockApi()
    render(<GuruManagers />)
    await screen.findByText('Warren Buffett')
    const meta = await screen.findByText('40% · 1명')
    expect(meta.tagName).toBe('SPAN')
    expect(meta.getAttribute('title')).toBeNull()
  })
})

describe('GuruManagers 기본 정렬 (task#228 S1)', () => {
  // 종목수 순서(mid 10 < small 50 < big 90)를 규모 순서와 어긋나게 둬서, 구 기본값(종목수 오름차순)이면
  // ['Mid','Small','Big']이 나오도록 만든다 — 기본값이 되돌아가면 이 단언이 깨진다.
  const MANY = {
    last_updated: null,
    managers: [
      { id: 'small', name: 'Small Fund', firm: 'S', portfolio_value: 1_000_000_000,   num_stocks: 50, top10: [] },
      { id: 'big',   name: 'Big Fund',   firm: 'B', portfolio_value: 300_000_000_000, num_stocks: 90, top10: [] },
      { id: 'mid',   name: 'Mid Fund',   firm: 'M', portfolio_value: 50_000_000_000,  num_stocks: 10, top10: [] },
    ],
  }

  it('정렬 칩 클릭 없이 렌더 직후 카드 순서가 포트폴리오 규모 내림차순', async () => {
    api.get.mockImplementation((url) =>
      url === '/api/guru/managers' ? Promise.resolve({ data: MANY }) : Promise.resolve({ data: [] })
    )
    const { container } = render(<GuruManagers />)
    await screen.findByText('Big Fund')
    const names = [...container.querySelectorAll('.guru-name')].map(n => n.textContent)
    expect(names).toEqual(['Big Fund', 'Mid Fund', 'Small Fund'])
  })
})

describe('GuruManagers 빈 상태 안내 문구 (task#227 S5)', () => {
  it('실제 경로("설정 > 구루")를 안내하고 존재하지 않는 "크롤링 설정" 탭을 언급하지 않음', async () => {
    mockApi({ stocks: [] })
    api.get.mockImplementation((url) =>
      url === '/api/guru/managers' ? Promise.resolve({ data: { last_updated: null, managers: [] } }) : Promise.resolve({ data: [] })
    )
    render(<GuruManagers />)
    const empty = await screen.findByText(/데이터 없음/)
    expect(empty.textContent).not.toMatch(/크롤링 설정/)
    expect(empty.textContent).toMatch(/설정.*구루/)
  })
})

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

// api 모킹
vi.mock('../api', () => ({
  default: { get: vi.fn(), post: vi.fn() },
}))
vi.mock('../components/Toast', () => ({
  useToast: () => ({ showToast: vi.fn() }),
}))

import api from '../api'
import Recommendations from '../pages/Recommendations'
import RecCard from '../components/recommendations/RecCard'

// ────────────────────────────────────────────────
// 공통 fixture
// ────────────────────────────────────────────────
const makeRecData = (market) => ({
  discovery: [
    { ticker: 'TST', name: '테스트', market: market || 'KR', exchange: 'KS', score: 7.5, flags: [] },
  ],
  watchlist: [],
  holdings: [],
  as_of: '2026-07-01',
})

const makeRecDataWithWatchlist = () => ({
  discovery: [],
  watchlist: [
    { ticker: 'AAA', name: '분석있음', market: 'KR', exchange: 'KS', score: 8.0, flags: [], enriched: true },
    { ticker: 'BBB', name: '분석없음', market: 'US', exchange: '', score: 6.0, flags: [], enriched: false },
  ],
  holdings: [],
  as_of: '2026-07-01',
})

// ────────────────────────────────────────────────
// S3: 발굴 필터 칩
// ────────────────────────────────────────────────
describe('S3 발굴 필터 칩', () => {
  beforeEach(() => {
    api.get.mockImplementation((url) => {
      if (url === '/api/watchlist') return Promise.resolve({ data: [] })
      return Promise.resolve({ data: makeRecData() })
    })
  })

  it('전체/국내/해외 칩 3개가 렌더된다', async () => {
    render(<MemoryRouter><Recommendations /></MemoryRouter>)
    await waitFor(() => expect(screen.getByText('전체')).toBeInTheDocument())
    expect(screen.getByText('국내')).toBeInTheDocument()
    expect(screen.getByText('해외')).toBeInTheDocument()
  })

  it('초기 로드 시 market 파라미터 없이 호출한다', async () => {
    render(<MemoryRouter><Recommendations /></MemoryRouter>)
    await waitFor(() => screen.getByText('전체'))
    const recCall = api.get.mock.calls.find(c => c[0] === '/api/recommendations')
    expect(recCall[1]?.params?.market).toBeUndefined()
  })

  it('국내 칩 클릭 시 market=KR 파라미터로 재호출한다', async () => {
    render(<MemoryRouter><Recommendations /></MemoryRouter>)
    await waitFor(() => screen.getByText('국내'))
    fireEvent.click(screen.getByText('국내'))
    await waitFor(() => {
      const calls = api.get.mock.calls.filter(c => c[0] === '/api/recommendations')
      const hasKR = calls.some(c => c[1]?.params?.market === 'KR')
      expect(hasKR).toBe(true)
    })
  })

  it('해외 칩 클릭 시 market=US 파라미터로 재호출한다', async () => {
    render(<MemoryRouter><Recommendations /></MemoryRouter>)
    await waitFor(() => screen.getByText('해외'))
    fireEvent.click(screen.getByText('해외'))
    await waitFor(() => {
      const calls = api.get.mock.calls.filter(c => c[0] === '/api/recommendations')
      const hasUS = calls.some(c => c[1]?.params?.market === 'US')
      expect(hasUS).toBe(true)
    })
  })

  it('전체 칩 클릭 시 market 파라미터 없이 재호출한다', async () => {
    render(<MemoryRouter><Recommendations /></MemoryRouter>)
    await waitFor(() => screen.getByText('해외'))
    fireEvent.click(screen.getByText('해외'))
    await waitFor(() => {
      const calls = api.get.mock.calls.filter(c => c[0] === '/api/recommendations')
      expect(calls.some(c => c[1]?.params?.market === 'US')).toBe(true)
    })
    fireEvent.click(screen.getByText('전체'))
    await waitFor(() => {
      const calls = api.get.mock.calls.filter(c => c[0] === '/api/recommendations')
      // 마지막 호출에 market 없음
      const last = calls[calls.length - 1]
      expect(last[1]?.params?.market).toBeUndefined()
    })
  })
})

// ────────────────────────────────────────────────
// S4: 관심 카드 분석 상태
// ────────────────────────────────────────────────
describe('S4 관심 카드 분석 상태', () => {
  beforeEach(() => {
    api.get.mockImplementation((url) => {
      if (url === '/api/watchlist') return Promise.resolve({ data: [] })
      return Promise.resolve({ data: makeRecDataWithWatchlist() })
    })
  })

  it('enriched=true 카드에 "분석 보기" 링크가 렌더된다', async () => {
    render(<MemoryRouter><Recommendations /></MemoryRouter>)
    await waitFor(() => screen.getByText('분석있음'))
    expect(screen.getByText('분석 보기')).toBeInTheDocument()
  })

  it('enriched=false 카드에 "분석 대기 중" 배지가 렌더된다', async () => {
    render(<MemoryRouter><Recommendations /></MemoryRouter>)
    await waitFor(() => screen.getByText('분석없음'))
    expect(screen.getByText('분석 대기 중')).toBeInTheDocument()
  })

  it('"분석 보기"는 링크(a)이고 "분석 대기 중"은 스팬이다', async () => {
    render(<MemoryRouter><Recommendations /></MemoryRouter>)
    await waitFor(() => screen.getByText('분석 보기'))
    const link = screen.getByText('분석 보기').closest('a')
    expect(link).not.toBeNull()
    const badge = screen.getByText('분석 대기 중')
    expect(badge.tagName).not.toBe('A')
  })

  it('"분석 대기 중" 배지는 success/danger 클래스가 없다 (KR 가격 토큰 금지)', async () => {
    render(<MemoryRouter><Recommendations /></MemoryRouter>)
    await waitFor(() => screen.getByText('분석 대기 중'))
    const badge = screen.getByText('분석 대기 중')
    expect(badge.className).not.toMatch(/badge--success|badge--danger/)
  })
})

// ────────────────────────────────────────────────
// RecCard 단위: enriched prop 렌더 분기
// ────────────────────────────────────────────────
describe('RecCard footer 주입', () => {
  it('footer null 이면 미렌더', () => {
    const item = { ticker: 'X', name: '엑스', market: 'US', score: 5, flags: [] }
    const { container } = render(<MemoryRouter><RecCard item={item} /></MemoryRouter>)
    // footer 영역 없음 — 버튼/a 없음
    expect(container.querySelector('button')).toBeNull()
    expect(container.querySelector('a')).toBeNull()
  })
})

// ────────────────────────────────────────────────
// task#139: 추천 카드 구루 보유 개수 노출
// ────────────────────────────────────────────────
const GURU_FLAG = { label: '구루 신규 매수', kind: 'smart_money' }

const makeRecDataGuru = () => ({
  discovery: [
    { ticker: 'NVDA', name: '엔비디아', market: 'US', exchange: '', score: 9.1, flags: [GURU_FLAG] },
  ],
  watchlist: [],
  holdings: [],
  as_of: '2026-07-01',
})

// Buffett·Ackman 둘 다 NVDA를 top10에 보유 → count 2
const makeGuruManagers = () => ({
  managers: [
    { name: 'Buffett - BRK', firm: 'Berkshire', top10: [{ ticker: 'NVDA', weight_pct: 5.0, rank: 1 }] },
    { name: 'Ackman - PSH', firm: 'Pershing', top10: [{ ticker: 'NVDA', weight_pct: 3.0, rank: 2 }, { ticker: 'AAPL', weight_pct: 8.0, rank: 1 }] },
  ],
})

describe('구루 보유 개수 노출 (Recommendations 통합)', () => {
  it('구루 보유 종목 카드는 "구루 N명 보유"로 표시(칩 제자리 교체)', async () => {
    api.get.mockImplementation((url) => {
      if (url === '/api/watchlist') return Promise.resolve({ data: [] })
      if (url === '/api/guru/managers') return Promise.resolve({ data: makeGuruManagers() })
      return Promise.resolve({ data: makeRecDataGuru() })
    })
    render(<MemoryRouter><Recommendations /></MemoryRouter>)
    await waitFor(() => expect(screen.getByText('구루 2명 보유')).toBeInTheDocument())
    // 원본 이진 라벨은 사라진다
    expect(screen.queryByText('구루 신규 매수')).toBeNull()
  })

  it('구루 데이터 fetch 실패 시 원본 "구루 신규 매수" 칩 유지(graceful)', async () => {
    api.get.mockImplementation((url) => {
      if (url === '/api/watchlist') return Promise.resolve({ data: [] })
      if (url === '/api/guru/managers') return Promise.reject(new Error('fail'))
      return Promise.resolve({ data: makeRecDataGuru() })
    })
    render(<MemoryRouter><Recommendations /></MemoryRouter>)
    await waitFor(() => expect(screen.getByText('구루 신규 매수')).toBeInTheDocument())
    expect(screen.queryByText(/명 보유/)).toBeNull()
  })
})

describe('RecCard 구루 칩 제자리 교체 (단위)', () => {
  const guruItem = { ticker: 'NVDA', name: '엔비디아', market: 'US', score: 9, flags: [{ ...GURU_FLAG }] }

  it('guruCount>=1 이면 "구루 N명 보유"로 교체', () => {
    render(<MemoryRouter><RecCard item={guruItem} guruCount={3} /></MemoryRouter>)
    expect(screen.getByText('구루 3명 보유')).toBeInTheDocument()
    expect(screen.queryByText('구루 신규 매수')).toBeNull()
  })

  it('guruCount 0(기본)이면 원본 칩 유지', () => {
    render(<MemoryRouter><RecCard item={guruItem} /></MemoryRouter>)
    expect(screen.getByText('구루 신규 매수')).toBeInTheDocument()
  })

  it('다른 스마트머니 칩(외인 순매수)은 교체되지 않는다', () => {
    const item = { ticker: 'X', market: 'KR', score: 5, flags: [{ label: '외인 5일 순매수', kind: 'smart_money' }] }
    render(<MemoryRouter><RecCard item={item} guruCount={3} /></MemoryRouter>)
    expect(screen.getByText('외인 5일 순매수')).toBeInTheDocument()
    expect(screen.queryByText(/명 보유/)).toBeNull()
  })
})

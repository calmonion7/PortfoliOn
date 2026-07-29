import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

vi.mock('../api', () => ({ default: { get: vi.fn(), post: vi.fn(), delete: vi.fn() } }))
// 액션 실패는 토스트로 알린다(task#244 G5) — GlobalSearch와 같은 형태.
const showToastSpy = vi.fn()
vi.mock('../components/Toast', () => ({ useToast: () => ({ showToast: showToastSpy }) }))

import api from '../api'
import GuruStats from './GuruStats'

const POPULARITY = [
  { ticker: 'AAPL', name: 'Apple', name_kr: '애플', count: 7 },
]
const WEIGHTED = [
  { ticker: 'AAPL', name: 'Apple', name_kr: '애플', score: 0.5 },
]

function mockStats() {
  api.get.mockImplementation((url) => {
    if (url === '/api/guru/stats/popularity') return Promise.resolve({ data: POPULARITY })
    if (url === '/api/guru/stats/weighted')   return Promise.resolve({ data: WEIGHTED })
    return Promise.resolve({ data: [] })
  })
}

beforeEach(() => vi.clearAllMocks())

describe('GuruStats 인기순/가중치 카드 통합 (task#227 S3)', () => {
  it('인기순 뷰는 N명 단위로 렌더', async () => {
    mockStats()
    render(<GuruStats view="popularity" />)
    expect(await screen.findByText('7명')).toBeTruthy()
  })

  it('가중치 뷰는 소수 3자리 점수로 렌더', async () => {
    mockStats()
    render(<GuruStats view="weighted" />)
    expect(await screen.findByText('0.500')).toBeTruthy()
  })

  it('두 뷰의 행 구조(랭크·티커·종목명·값 영역)가 동일', async () => {
    mockStats()
    const { container: popContainer } = render(<GuruStats view="popularity" />)
    await screen.findByText('7명')
    const popRow = popContainer.querySelector('.guru-stat-row')
    expect(popRow.querySelector('.guru-stat-rank')).toBeTruthy()
    expect(popRow.querySelector('.guru-stat-ticker')).toBeTruthy()
    expect(popRow.querySelector('.guru-stat-name')).toBeTruthy()
    expect(popRow.querySelector('.guru-stat-value')).toBeTruthy()

    const { container: wContainer } = render(<GuruStats view="weighted" />)
    await screen.findByText('0.500')
    const wRow = wContainer.querySelector('.guru-stat-row')
    expect(wRow.querySelector('.guru-stat-rank')).toBeTruthy()
    expect(wRow.querySelector('.guru-stat-ticker')).toBeTruthy()
    expect(wRow.querySelector('.guru-stat-name')).toBeTruthy()
    expect(wRow.querySelector('.guru-stat-value')).toBeTruthy()
  })
})

// G5 (task#244): `.then().finally()`가 rejection을 놓쳐 실패가
// "데이터 없음 — 크롤링을 먼저 실행하세요"라는 *잘못된 행동 지시*로 위장됐다.
describe('구루 통계 — 에러 정직성 (task#244)', () => {
  it('fetch 실패는 에러로 보이고 빈 상태 문구는 뜨지 않는다', async () => {
    api.get.mockImplementation((url) => {
      if (url.startsWith('/api/guru/stats/')) return Promise.reject(new Error('boom'))
      return Promise.resolve({ data: [] })
    })
    render(<GuruStats view="popularity" />)
    expect(await screen.findByText(/불러오지 못했습니다/)).toBeTruthy()
    expect(screen.queryByText(/크롤링을 먼저 실행/)).toBeNull()
  })

  it('정상 응답에는 에러 문구가 없다', async () => {
    mockStats()
    render(<GuruStats view="popularity" />)
    await screen.findByText('7명')
    expect(screen.queryByText(/불러오지 못했습니다/)).toBeNull()
  })

  it('빈 응답은 여전히 빈 상태로 보인다 (에러와 뒤바뀌지 않는다)', async () => {
    api.get.mockImplementation(() => Promise.resolve({ data: [] }))
    render(<GuruStats view="popularity" />)
    expect(await screen.findByText(/크롤링을 먼저 실행/)).toBeTruthy()
    expect(screen.queryByText(/불러오지 못했습니다/)).toBeNull()
  })

  it('관심 토글 실패는 토스트로 알린다', async () => {
    mockStats()
    api.post.mockRejectedValue(new Error('nope'))
    const { container } = render(<GuruStats view="popularity" />)
    await screen.findByText('7명')
    fireEvent.click(container.querySelector('.guru-stat-row button'))
    await vi.waitFor(() => expect(showToastSpy).toHaveBeenCalledWith(expect.any(String), 'error'))
  })
})

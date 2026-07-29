import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

vi.mock('../api', () => ({ default: { get: vi.fn(), post: vi.fn(), delete: vi.fn() } }))
// jsdom엔 matchMedia가 없다 — 탭 라벨 검증에 반응형은 무관하므로 PC로 고정한다.
vi.mock('../hooks/useIsMobile', () => ({ default: () => false }))
// 액션 실패는 토스트로 알린다(task#244 G5) — GlobalSearch와 같은 형태.
const showToastSpy = vi.fn()
vi.mock('../components/Toast', () => ({ useToast: () => ({ showToast: showToastSpy }) }))

import api from '../api'
import GuruAllocation from './GuruAllocation'
import Guru from './Guru'

// 60종목: 스코프 10/20/50/전체 경계를 모두 넘긴다.
const ROWS = Array.from({ length: 60 }, (_, i) => ({
  ticker: `TCK${i + 1}`,
  name: `Company ${i + 1}`,
  name_kr: i < 3 ? `종목${i + 1}` : '',      // 앞 3개만 한글명(top10층 조인 재현)
  value: (60 - i) * 1e9,
  ratio: (60 - i) / 60 * 100,
  holder_count: 60 - i,
}))

const PAYLOAD = { total_value: 1_830_000_000_000, manager_count: 83, ticker_count: 60, rows: ROWS }

function mockApi(payload = PAYLOAD) {
  api.get.mockImplementation((url) => {
    if (url === '/api/guru/stats/allocation') return Promise.resolve({ data: payload })
    if (url === '/api/guru/managers') return Promise.resolve({ data: { last_updated: null, managers: [] } })
    return Promise.resolve({ data: [] })
  })
}

const rowCount = (c) => c.querySelectorAll('.guru-stat-row').length

beforeEach(() => vi.clearAllMocks())

describe('구루 자산 배분 탭 (task#241)', () => {
  it('구루 허브 탭이 4개이고 마지막이 투자금', async () => {
    mockApi()
    const { container } = render(<MemoryRouter><Guru /></MemoryRouter>)
    const labels = [...container.querySelectorAll('.tabs button, .seg button')].map(b => b.textContent)
    expect(labels).toEqual(['매니저 목록', '인기순', '가중치', '투자금'])
  })

  it('기본 진입은 탑20 — 20행만 렌더', async () => {
    mockApi()
    const { container } = render(<GuruAllocation />)
    await screen.findByText('TCK1')
    expect(rowCount(container)).toBe(20)
  })

  it('스코프 필 전환이 행 수를 10/20/50/전체로 바꾼다', async () => {
    mockApi()
    const { container } = render(<GuruAllocation />)
    await screen.findByText('TCK1')

    fireEvent.click(screen.getByText('탑10'))
    expect(rowCount(container)).toBe(10)
    fireEvent.click(screen.getByText('탑50'))
    expect(rowCount(container)).toBe(50)
    fireEvent.click(screen.getByText('전체'))
    expect(rowCount(container)).toBe(60)
    fireEvent.click(screen.getByText('탑20'))
    expect(rowCount(container)).toBe(20)
  })

  it('검색은 스코프(탑20) 밖 꼬리 종목도 찾고, 진짜 순위를 붙인다', async () => {
    mockApi()
    const { container } = render(<GuruAllocation />)
    await screen.findByText('TCK1')
    // 기본 탑20에선 55위 종목이 안 보인다
    expect(screen.queryByText('TCK55')).toBeNull()

    fireEvent.change(container.querySelector('input'), { target: { value: 'TCK55' } })
    expect(await screen.findByText('TCK55')).toBeTruthy()
    expect(rowCount(container)).toBe(1)
    // 순번이 아니라 전체 집합에서의 순위(55)
    expect(container.querySelector('.guru-stat-rank').textContent).toBe('55')
  })

  it('한글명 없는 행은 영문명으로 폴백한다', async () => {
    mockApi()
    const { container } = render(<GuruAllocation />)
    await screen.findByText('TCK1')
    const names = [...container.querySelectorAll('.guru-stat-name')].map(e => e.textContent)
    expect(names[0]).toContain('종목1')        // name_kr 있음
    expect(names[5]).toContain('Company 6')    // name_kr 없음 → 영문명
  })

  it('행에 투자금·비율·보유 구루 수가 모두 실린다', async () => {
    mockApi()
    const { container } = render(<GuruAllocation />)
    await screen.findByText('TCK1')
    const row = container.querySelector('.guru-stat-row')
    expect(row.querySelector('.guru-stat-value').textContent).toBe('$60.0B')
    expect(row.querySelector('.guru-stat-name').textContent).toContain('100.00%')
    expect(row.querySelector('.guru-stat-name').textContent).toContain('60명')
  })

  it('캡션이 비율의 분모(총액·구루 수·종목 수)를 밝힌다', async () => {
    mockApi()
    const { container } = render(<GuruAllocation />)
    await screen.findByText('TCK1')
    const caption = container.querySelector('.guru-alloc-caption').textContent
    expect(caption).toContain('83명')
    expect(caption).toContain('$1830.0B')
    expect(caption).toContain('60종목')
  })

  it('데이터 없으면 빈 상태를 보여준다', async () => {
    mockApi({ total_value: 0, manager_count: 0, ticker_count: 0, rows: [] })
    render(<GuruAllocation />)
    expect(await screen.findByText(/크롤링을 먼저 실행/)).toBeTruthy()
  })
})

// ── G5 (task#244): 실패를 빈 상태로 위장하지 않는다 ────────────────────────────
// `.then().finally()`는 rejection을 잡지 않아 loading=false·data=null이 되고,
// 그 결과 "크롤링을 먼저 실행하세요"라는 *잘못된 행동 지시*가 떴다.
describe('구루 자산 배분 — 에러 정직성 (task#244)', () => {
  it('fetch 실패는 에러로 보이고 빈 상태 문구는 뜨지 않는다', async () => {
    api.get.mockImplementation((url) => {
      if (url === '/api/guru/stats/allocation') return Promise.reject(new Error('boom'))
      return Promise.resolve({ data: [] })
    })
    render(<GuruAllocation />)
    expect(await screen.findByText(/불러오지 못했습니다/)).toBeTruthy()
    expect(screen.queryByText(/크롤링을 먼저 실행/)).toBeNull()
  })

  it('정상 응답에는 에러 문구가 없다', async () => {
    mockApi()
    render(<GuruAllocation />)
    await screen.findByText('TCK1')
    expect(screen.queryByText(/불러오지 못했습니다/)).toBeNull()
  })

  it('관심 토글 실패는 토스트로 알린다', async () => {
    mockApi()
    api.post.mockRejectedValue(new Error('nope'))
    const { container } = render(<GuruAllocation />)
    await screen.findByText('TCK1')
    fireEvent.click(container.querySelector('.guru-stat-row button'))
    await vi.waitFor(() => expect(showToastSpy).toHaveBeenCalledWith(expect.any(String), 'error'))
  })
})

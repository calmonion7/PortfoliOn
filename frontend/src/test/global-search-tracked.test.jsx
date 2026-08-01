import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

const navigateMock = vi.fn()
vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal()
  return { ...actual, useNavigate: () => navigateMock }
})

vi.mock('../api', () => ({
  default: { get: vi.fn(), post: vi.fn() },
}))
const showToastSpy = vi.fn()
vi.mock('../components/Toast', () => ({
  useToast: () => ({ showToast: showToastSpy }),
}))
vi.mock('../components/StockSearchBox', () => ({
  default: ({ onSelect }) => (
    <button onClick={() => onSelect({ ticker: 'AAA', name: '테스트종목', market: 'US' })}>선택</button>
  ),
}))
vi.mock('../components/StockModal', () => ({
  default: () => <div data-testid="add-modal">추가모달</div>,
}))

import api from '../api'
import GlobalSearch from '../components/GlobalSearch'

// stale trackedRef 회귀 테스트: 관심종목 삭제 후 같은 티커를 다시 검색해도
// 세션 내 캐시된 이전 결과로 오판하지 않고 매번 /api/stocks를 재조회해야 한다.
describe('GlobalSearch 추적 여부 매 선택마다 재조회', () => {
  beforeEach(() => {
    navigateMock.mockClear()
    api.get.mockReset()
  })

  it('삭제 후 재선택 시 캐시된 이전 결과가 아니라 최신 /api/stocks 결과를 따른다', async () => {
    api.get.mockResolvedValueOnce({ data: [{ ticker: 'AAA', name: '테스트종목', type: 'watchlist', market: 'US' }] })
    render(<GlobalSearch />)

    fireEvent.click(screen.getByText('선택'))
    await waitFor(() => expect(navigateMock).toHaveBeenCalledWith('/reports', { state: { ticker: 'AAA' } }))

    // 관심종목에서 삭제된 상태를 시뮬레이션 — 다음 /api/stocks 응답엔 AAA가 없다
    api.get.mockResolvedValueOnce({ data: [] })
    navigateMock.mockClear()
    fireEvent.click(screen.getByText('선택'))

    await waitFor(() => expect(screen.getByTestId('add-modal')).toBeInTheDocument())
    expect(navigateMock).not.toHaveBeenCalled()
    expect(api.get).toHaveBeenCalledTimes(2)  // 캐시 재사용 없이 매번 재조회
  })
})

// B11 — 추적 상태를 **모르면** navigate도 모달도 하지 않는다.
// 옛 fetchTracked는 실패 시 빈 Set을 돌려줘 조회 실패가 "미추적"으로 붕괴했고, 그래서
// 이미 추적 중인 종목을 골라도 리포트가 아니라 추가 모달로 보냈다. 어느 쪽으로 추측해도
// 절반은 틀리므로, 모르면 아무 경로도 고르지 않고 사유만 알린다(wrong < missing).
describe('B11 — GlobalSearch 추적 상태 조회 실패', () => {
  beforeEach(() => {
    navigateMock.mockClear()
    showToastSpy.mockClear()
    api.get.mockReset()
  })

  it('실패 시 add-modal 미출현·navigate 미호출·토스트 1회', async () => {
    api.get.mockRejectedValueOnce(new Error('tracked down'))
    render(<GlobalSearch />)

    fireEvent.click(screen.getByText('선택'))
    await waitFor(() => expect(showToastSpy).toHaveBeenCalledTimes(1))
    expect(showToastSpy.mock.calls[0][1]).toBe('error')
    expect(navigateMock).not.toHaveBeenCalled()
    expect(screen.queryByTestId('add-modal')).toBeNull()
  })
})

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'

vi.mock('../api', () => ({
  default: { get: vi.fn() },
}))
vi.mock('../hooks/usePortfolioData', () => ({
  default: () => ({
    stocks: [{ ticker: 'AAA', name: 'Alpha', market: 'US' }],
    watchlist: [
      { ticker: 'BBB', name: 'Bravo', market: 'US' },
      { ticker: 'CCC', name: 'Charlie', market: 'US' },
    ],
    listLoading: false,
  }),
}))
vi.mock('../hooks/useReportList', () => ({
  default: () => ({
    reportList: {
      AAA: { dates: ['2026-07-01'] },
      BBB: { dates: ['2026-07-01'] },
      CCC: { dates: ['2026-07-01'] },
    },
    listLoading: false,
  }),
}))

import api from '../api'
import Compare from '../pages/Compare'

const makeCompareData = (tickers) => ({
  tickers: tickers.map(t => ({ ticker: t, name: `${t}-name`, available: true })),
  metrics: [],
})

const getCheckbox = (ticker) => screen.getByText(ticker).closest('label').querySelector('input')

// 경쟁 fetch 회귀 테스트: 먼저 시작했지만 늦게 도착하는 응답이,
// 그 사이 선택이 바뀌어 먼저 끝난 최신 응답을 덮으면 안 된다.
describe('Compare 경쟁 fetch 취소 가드', () => {
  beforeEach(() => {
    api.get.mockReset()
  })

  it('늦게 도착한 과거 선택 응답이 이후 선택의 최신 결과를 덮지 않는다', async () => {
    let resolveSlow
    const slow = new Promise((resolve) => { resolveSlow = resolve })

    api.get.mockImplementation((url, config) => {
      const tickers = config.params.tickers
      if (tickers === 'AAA,BBB') return slow
      return Promise.resolve({ data: makeCompareData(tickers.split(',')) })
    })

    render(<Compare />)

    fireEvent.click(getCheckbox('AAA'))
    fireEvent.click(getCheckbox('BBB'))  // AAA,BBB 요청 시작 — 아직 미해결(slow)
    await waitFor(() => expect(api.get).toHaveBeenCalledWith(
      '/api/stocks/compare', { params: { tickers: 'AAA,BBB' } },
    ))

    fireEvent.click(getCheckbox('BBB'))  // BBB 해제 → selected=[AAA] (AAA,BBB 요청 cleanup으로 취소)
    fireEvent.click(getCheckbox('CCC'))  // CCC 선택 → AAA,CCC 요청(즉시 해결)
    fireEvent.click(screen.getByText('비교 보기'))  // task#202: 비교표는 레이어(모달) 안에만 렌더

    await waitFor(() => {
      const table = document.querySelector('table')
      expect(table).not.toBeNull()
      expect(within(table).getByText('CCC')).toBeInTheDocument()
    })

    // 뒤늦게 AAA,BBB(과거 선택) 응답이 도착
    resolveSlow({ data: makeCompareData(['AAA', 'BBB']) })
    await new Promise((r) => setTimeout(r, 0))

    const table = document.querySelector('table')
    expect(within(table).queryByText('BBB')).toBeNull()
    expect(within(table).getByText('CCC')).toBeInTheDocument()
  })
})

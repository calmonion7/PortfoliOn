import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

// task#260 — 심층 리포트 상세 컨센서스 근거 섹션.
// jsdom에서 recharts는 렌더되지 않으므로 게이지·테이블은 custom div — 텍스트로 단언한다(가토).
const getMock = vi.fn()
vi.mock('../api', () => ({ default: { get: (...a) => getMock(...a) } }))

import { ConsensusSection } from '../pages/AnalystReport'

const brokerage = (i, date = '2026-07-3' + (i % 2)) => ({
  brokerage: `증권사${i}`, opinion: '매수', target_price: 200000 + i * 1000,
  opinion_score: 4.0, report_date: date,
})

const mkReport = (over = {}) => ({
  ticker: 'TST', fair_value_low: 80000, fair_value_high: 95000,
  data: {
    market: 'KR',
    consensus: {
      target_mean: 210000, target_high: 250000, target_low: 180000,
      opinion_score: 4.13, analyst_count: 8, buy: 20, hold: 3, sell: 0,
      base_date: '2026-07-31',
    },
    consensus_detail: { brokerages: [brokerage(1), brokerage(2)] },
    ...over,
  },
})

beforeEach(() => { getMock.mockReset() })

describe('ConsensusSection (task#260)', () => {
  it('consensus_detail 있으면 섹션·집계 스탯·게이지·증권사 행을 렌더한다', async () => {
    getMock.mockResolvedValue({ data: [{ date: '2026-08-01', target_mean: 218000 }] })
    render(<ConsensusSection report={mkReport()} market="KR" />)
    expect(screen.getAllByText('컨센서스').length).toBeGreaterThan(0)   // 섹션 타이틀 + 게이지 행 라벨
    expect(screen.getByText('내 판단 밴드')).toBeTruthy()               // 게이지
    expect(screen.getByText('증권사1')).toBeTruthy()
    expect(screen.getByText('증권사2')).toBeTruthy()
    expect(screen.getByText('8명')).toBeTruthy()
    expect(screen.getByText('4.13')).toBeTruthy()
    // 델타 — 발행 210,000 → 현재 218,000 = +3.8%
    await screen.findByText(/\+3\.8%/)
    expect(getMock).toHaveBeenCalledWith('/api/consensus/TST')
  })

  it('consensus_detail 없는 구발행물은 섹션 전체를 생략하고 fetch도 하지 않는다', () => {
    const report = mkReport({ consensus_detail: undefined })
    const { container } = render(<ConsensusSection report={report} market="KR" />)
    expect(container.innerHTML).toBe('')
    expect(getMock).not.toHaveBeenCalled()
  })

  it('증권사 10개 초과면 접기/더보기로 토글한다', async () => {
    getMock.mockResolvedValue({ data: [] })
    const rows = Array.from({ length: 12 }, (_, i) => brokerage(i + 1))
    render(<ConsensusSection report={mkReport({ consensus_detail: { brokerages: rows } })} market="KR" />)
    expect(screen.getAllByText(/^증권사\d+$/).length).toBe(10)
    const more = screen.getByText('더보기 (+2)')
    fireEvent.click(more)
    expect(screen.getAllByText(/^증권사\d+$/).length).toBe(12)
    expect(screen.getByText('접기')).toBeTruthy()
  })

  it('현재 컨센서스 fetch 실패 시 델타만 조용히 생략하고 섹션은 유지한다', async () => {
    getMock.mockRejectedValue(new Error('down'))
    render(<ConsensusSection report={mkReport()} market="KR" />)
    await waitFor(() => expect(getMock).toHaveBeenCalled())
    expect(screen.getByText('내 판단 밴드')).toBeTruthy()
    expect(screen.queryByText(/목표가 평균:/)).toBeNull()   // 델타 줄만 생략
  })
})

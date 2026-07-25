import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import AnalystReport, { PerBandChart, RATING_META } from './AnalystReport'
import api from '../api'

vi.mock('../api', () => ({ default: { get: vi.fn() } }))

const REPORT = {
  ticker: '005930', published_date: '2026-07-25', rating: 'buy',
  title: '한줄 논지 테스트', fair_value_low: 80000, fair_value_high: 95000,
  name: '삼성전자', market: 'KR',
  valuation_method: 'PER 밴드 산정',
  points: [
    { title: '포인트A', body: '근거A' },
    { title: '포인트B', body: '근거B' },
  ],
  risks: '리스크 서술',
  data: {
    snapshot_date: '2026-07-25', price: 249500.0, market: 'KR', name: '삼성전자',
    consensus: { target_mean: 455000.0, buy: 25, hold: 0, sell: 0 },
    financials_annual: [
      { period: '2024', revenue: 300e12, operating_income: 32e12, eps: 4950, per: 10.8, is_consensus: false },
      { period: '2026', revenue: 360e12, operating_income: 60e12, eps: 9000, per: null, is_consensus: true },
    ],
    competitors: [
      { ticker: '005930', name: '삼성전자', is_self: true, per: 20.2, pbr: 3.47, psr: 3.76, ev_ebitda: 11.9, rd_intensity: 11.3 },
      { ticker: '000660', name: 'SK하이닉스', is_self: false, per: 7.8, pbr: 3.48, psr: 9.49, ev_ebitda: 14.5, rd_intensity: 6.9 },
    ],
    per_band: { min: 10.8, max: 36.8, avg: 22.0, current: 20.2, forward: 5.9 },
  },
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/analyst-report/005930/2026-07-25']}>
      <Routes>
        <Route path="/analyst-report/:ticker/:date" element={<AnalystReport />} />
      </Routes>
    </MemoryRouter>
  )
}

beforeEach(() => vi.clearAllMocks())

describe('AnalystReport 문서 페이지 (task#212)', () => {
  it('전 섹션 렌더 — 헤더·논지·포인트·밸류에이션·추정·리스크', async () => {
    api.get.mockResolvedValue({ data: REPORT })
    renderPage()
    expect(await screen.findByText('한줄 논지 테스트')).toBeTruthy()
    expect(screen.getByText('삼성전자')).toBeTruthy()
    expect(screen.getByText('매수')).toBeTruthy()          // rating 의미 배지
    expect(screen.getByText('투자 포인트')).toBeTruthy()
    expect(screen.getByText('포인트A')).toBeTruthy()
    expect(screen.getByText('밸류에이션')).toBeTruthy()
    expect(screen.getByText('SK하이닉스')).toBeTruthy()    // 피어 테이블
    expect(screen.getByText('실적 추정')).toBeTruthy()
    expect(screen.getByText('2026(E)')).toBeTruthy()       // 컨센서스 행
    expect(screen.getByText('리스크 요인')).toBeTruthy()
    expect(screen.getByText('리스크 서술')).toBeTruthy()
  })

  it('US 영업이익 전무면 열 생략(null graceful)', async () => {
    const us = {
      ...REPORT, market: 'US',
      data: {
        ...REPORT.data, market: 'US',
        financials_annual: [
          { period: '2024', revenue: 3e11, operating_income: null, eps: 6.1, per: 30.0, is_consensus: false },
          { period: '2026', revenue: 4e11, operating_income: null, eps: 8.0, per: null, is_consensus: true },
        ],
      },
    }
    api.get.mockResolvedValue({ data: us })
    renderPage()
    await screen.findByText('실적 추정')
    expect(screen.queryByText('영업이익')).toBeNull()
  })

  it('404면 에러 상태 표시(silent catch 금지)', async () => {
    api.get.mockRejectedValue({ response: { status: 404 } })
    renderPage()
    expect(await screen.findByText('발행물을 찾을 수 없습니다.')).toBeTruthy()
  })
})

describe('PerBandChart', () => {
  it('밴드 재료 없으면 미렌더', () => {
    const { container } = render(<PerBandChart band={null} />)
    expect(container.innerHTML).toBe('')
  })
})

describe('RATING_META', () => {
  it('가격색(up/down)이 아닌 의미 배지 variant만 사용(task#194 가토)', () => {
    for (const meta of Object.values(RATING_META)) {
      expect(['success', 'neutral', 'danger']).toContain(meta.variant)
    }
  })
})

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import TechReports from './TechReports'
import api from '../api'

vi.mock('../api', () => ({ default: { get: vi.fn() } }))

const REPORTS = [
  {
    slug: 'smr', published_date: '2026-08-03', title: 'SMR, 원전의 다음 세대',
    difficulty: { score: 4, rationale: '인허가 리스크' },
    players: [{ name: 'NuScale' }, { name: 'Rosatom' }],
    market: {
      history: [{ year: 2024, size: { value: 5.2, currency: 'USD', unit: 'bn' } }],
      forecast: [{ year: 2035, size: { value: 40, currency: 'USD', unit: 'bn' } }],
      cagr_pct: 20.1, as_of: '2026-08-03',
    },
  },
]

function renderPage() {
  return render(<MemoryRouter><TechReports /></MemoryRouter>)
}

beforeEach(() => vi.clearAllMocks())

describe('선도기술 리포트 목록 (task#276 S5)', () => {
  it('목록 카드 렌더 — 표시명·제목·발행일·난이도·업체 수·시장 요약', async () => {
    api.get.mockResolvedValue({ data: { reports: REPORTS } })
    renderPage()
    expect(await screen.findByText('SMR, 원전의 다음 세대')).toBeTruthy()
    expect(screen.getByText('SMR')).toBeTruthy()
    expect(screen.getByText('4/5')).toBeTruthy()
    expect(screen.getByText('2개')).toBeTruthy()
    expect(screen.getByText('2026-08-03 발행')).toBeTruthy()
    expect(screen.getByText('$5.2B (2024) → $40B (2035), CAGR 20.1%')).toBeTruthy()
    const card = screen.getByTestId('tech-report-card')
    expect(card.getAttribute('href')).toBe('/tech-report/smr')
  })

  it('빈 목록 — 빈 상태 문구', async () => {
    api.get.mockResolvedValue({ data: { reports: [] } })
    renderPage()
    expect(await screen.findByText('발행된 선도기술 리포트가 없습니다.')).toBeTruthy()
  })

  it('조회 실패 — 에러 문구(빈 상태와 구별, 에러 정직성)', async () => {
    api.get.mockRejectedValue(new Error('network'))
    renderPage()
    await waitFor(() => expect(screen.getByText('목록을 불러오지 못했습니다.')).toBeTruthy())
    expect(screen.queryByText('발행된 선도기술 리포트가 없습니다.')).toBeNull()
  })
})

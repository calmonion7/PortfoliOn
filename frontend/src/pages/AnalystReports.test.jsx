import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import AnalystReports from './AnalystReports'
import api from '../api'

vi.mock('../api', () => ({ default: { get: vi.fn(), put: vi.fn(), post: vi.fn() } }))

let mockRole = 'user'
vi.mock('../contexts/AuthContext', () => ({ useAuth: () => ({ role: mockRole }) }))
vi.mock('../components/Toast', () => ({ useToast: () => ({ showToast: vi.fn() }) }))

const PUBS = { reports: [
  { ticker: '035420', published_date: '2026-07-25', rating: 'buy', title: 'AI 검색 수익화', name: 'NAVER' },
] }
const STOCKS = [
  { ticker: '035420', name: 'NAVER', type: 'holding', market: 'KR', analyst_target: true },
  { ticker: '005930', name: '삼성전자', type: 'watchlist', market: 'KR', analyst_target: false },
]

function renderPage() {
  return render(<MemoryRouter><AnalystReports /></MemoryRouter>)
}

beforeEach(() => {
  vi.clearAllMocks()
  api.get.mockImplementation((url) =>
    url === '/api/analyst-reports' ? Promise.resolve({ data: PUBS }) : Promise.resolve({ data: STOCKS }))
})

describe('심층 리포트 탭 (task#215)', () => {
  it('발행물 목록 렌더 + 비admin은 관리 섹션 숨김', async () => {
    mockRole = 'user'
    renderPage()
    expect(await screen.findByText('AI 검색 수익화')).toBeTruthy()
    expect(screen.queryByText('자동 발행 대상 관리')).toBeNull()
    // 비admin은 /api/stocks 자체를 안 부름
    expect(api.get.mock.calls.every(([u]) => u === '/api/analyst-reports')).toBe(true)
  })

  it('admin: 지정 목록·해제·발행·추가 동작', async () => {
    mockRole = 'admin'
    api.put.mockResolvedValue({ data: { ok: true } })
    api.post.mockResolvedValue({ data: { ok: true } })
    renderPage()
    expect(await screen.findByText('자동 발행 대상 관리')).toBeTruthy()
    expect((await screen.findAllByText('NAVER')).length).toBeGreaterThan(0) // 지정 목록 행

    fireEvent.click(screen.getByText('발행'))
    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/api/admin/cowork/fire',
      expect.objectContaining({ text: expect.stringContaining('035420') })))

    fireEvent.click(screen.getByText('해제'))
    await waitFor(() => expect(api.put).toHaveBeenCalledWith('/api/admin/analyst-targets/035420', { enabled: false }))
  })

  it('admin: 후보 선택 → 추가 호출', async () => {
    mockRole = 'admin'
    api.put.mockResolvedValue({ data: { ok: true } })
    renderPage()
    await screen.findByText('자동 발행 대상 관리')
    fireEvent.change(screen.getByRole('combobox'), { target: { value: '005930' } })
    fireEvent.click(screen.getByText('추가'))
    await waitFor(() => expect(api.put).toHaveBeenCalledWith('/api/admin/analyst-targets/005930', { enabled: true }))
  })
})

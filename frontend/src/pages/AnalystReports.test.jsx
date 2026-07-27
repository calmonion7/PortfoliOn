import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import AnalystReports from './AnalystReports'
import api from '../api'

vi.mock('../api', () => ({ default: { get: vi.fn(), put: vi.fn(), post: vi.fn(), delete: vi.fn() } }))

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
// 전역 지정 목록(task#224) — /api/stocks(세션 스코프)와 별도 소스
const TARGETS = [{ ticker: '035420', name: 'NAVER', market: 'KR' }]

function mockGets(targets = TARGETS) {
  api.get.mockImplementation((url) =>
    url === '/api/analyst-reports' ? Promise.resolve({ data: PUBS })
      : url === '/api/admin/analyst-targets' ? Promise.resolve({ data: targets })
        : Promise.resolve({ data: STOCKS }))
}

function renderPage() {
  return render(<MemoryRouter><AnalystReports /></MemoryRouter>)
}

beforeEach(() => {
  vi.clearAllMocks()
  mockGets()
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
    // 해제 시 지정 목록에서 즉시 제거 (task#224 — 목록 소스가 전역 API라 별도 상태 갱신 필요)
    await waitFor(() => expect(screen.getByText('지정된 종목이 없습니다 — 아래에서 추가하세요.')).toBeTruthy())
  })

  it('admin: 전역 지정 목록 — 내 보유·관심에 없는 종목도 노출·미보유 라벨 (task#224)', async () => {
    mockRole = 'admin'
    mockGets([
      { ticker: '035420', name: 'NAVER', market: 'KR' },      // 내 보유
      { ticker: 'LHX', name: 'L3Harris', market: 'US' },      // 타 사용자 보유분 — /api/stocks엔 없음
    ])
    renderPage()
    await screen.findByText('자동 발행 대상 관리')
    expect(await screen.findByText('L3Harris')).toBeTruthy()  // 세션 스코프론 안 보였던 종목
    expect(screen.getAllByText('미보유').length).toBe(1)      // LHX만 (035420은 내 보유)
  })

  it('admin: 발행물 삭제 버튼 → confirm 후 DELETE 호출·목록에서 제거 (task#222)', async () => {
    mockRole = 'admin'
    api.delete.mockResolvedValue({ data: { ok: true, ticker: '035420', deleted: 2 } })
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true)
    renderPage()
    expect(await screen.findByText('AI 검색 수익화')).toBeTruthy()

    fireEvent.click(screen.getByTitle('발행물 삭제 (이력 포함)'))
    await waitFor(() => expect(api.delete).toHaveBeenCalledWith('/api/analyst-reports/035420'))
    await waitFor(() => expect(screen.queryByText('AI 검색 수익화')).toBeNull())
    confirmSpy.mockRestore()
  })

  it('admin: confirm 취소 시 삭제 안 함 (task#222)', async () => {
    mockRole = 'admin'
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false)
    renderPage()
    await screen.findByText('AI 검색 수익화')
    fireEvent.click(screen.getByTitle('발행물 삭제 (이력 포함)'))
    expect(api.delete).not.toHaveBeenCalled()
    confirmSpy.mockRestore()
  })

  it('비admin: 발행물 삭제 버튼 미노출 (task#222)', async () => {
    mockRole = 'user'
    renderPage()
    await screen.findByText('AI 검색 수익화')
    expect(screen.queryByTitle('발행물 삭제 (이력 포함)')).toBeNull()
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

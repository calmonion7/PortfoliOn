import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import GuruDetail from './GuruDetail'
import api from '../api'

vi.mock('../api', () => ({ default: { get: vi.fn(), post: vi.fn(), delete: vi.fn() } }))
// 모바일 분기 테스트를 위해 토글 가능한 mock (PermissionPanel.test.jsx의 vi.hoisted 관용구). 기본은 PC.
const { viewport } = vi.hoisted(() => ({ viewport: { mobile: false } }))
vi.mock('../hooks/useIsMobile', () => ({ default: () => viewport.mobile }))

function renderPage(id = 'brk') {
  return render(
    <MemoryRouter initialEntries={[`/guru/${id}`]}>
      <Routes>
        <Route path="/guru/:id" element={<GuruDetail />} />
      </Routes>
    </MemoryRouter>
  )
}

const TOP10 = Array.from({ length: 10 }, (_, i) => ({
  rank: i + 1, ticker: `T${i + 1}`, name: `Name ${i + 1}`, name_kr: '', weight_pct: 10 - i * 0.5,
}))

const MANAGER_NO_HOLDINGS = {
  id: 'brk', name: 'Warren Buffett', firm: 'Berkshire Hathaway',
  portfolio_value: 350000000000, num_stocks: 45, top10: TOP10,
}

const MANAGER_WITH_HOLDINGS = {
  ...MANAGER_NO_HOLDINGS,
  holdings: [
    ...TOP10,
    ...Array.from({ length: 35 }, (_, i) => ({ rank: 11 + i, ticker: `H${11 + i}`, name: `Holding ${11 + i}`, weight_pct: 1 })),
  ],
}

function mockManager(data) {
  api.get.mockImplementation((url) =>
    url === '/api/guru/managers/brk' ? Promise.resolve({ data }) : Promise.resolve({ data: [] })
  )
}

beforeEach(() => { vi.clearAllMocks(); viewport.mobile = false })

describe('GuruDetail (task#226 S4)', () => {
  // 목록 하단 폴백 전용 캡션("기타 N종목 · x%")은 도넛 범례("기타 N종목", % 없음)와 텍스트가 겹치므로
  // exact textContent 매처로 구분한다.
  const fallbackCaption = (content) => content === '기타 35종목 · 22.5%'

  it('holdings 없는 응답 — top10 행 렌더 + 기타 캡션(폴백)', async () => {
    mockManager(MANAGER_NO_HOLDINGS)
    renderPage()
    expect(await screen.findByText('Warren Buffett')).toBeTruthy()
    expect(screen.getAllByText('T1').length).toBeGreaterThan(0)
    expect(screen.getAllByText('T10').length).toBeGreaterThan(0)
    expect(screen.getAllByTestId('holding-row').length).toBe(10)
    expect(screen.getByText(fallbackCaption)).toBeTruthy()
  })

  it('holdings 있는 응답 — 기본 20행, 펼치기 후 전량 렌더', async () => {
    mockManager(MANAGER_WITH_HOLDINGS)
    renderPage()
    await screen.findByText('Warren Buffett')
    expect(screen.getAllByTestId('holding-row').length).toBe(20)
    expect(screen.queryByText(fallbackCaption)).toBeNull()  // holdings 있으면 폴백 캡션 미노출
    fireEvent.click(screen.getByText('전체 45종목 보기'))
    expect(screen.getAllByTestId('holding-row').length).toBe(45)
  })

  it('404 응답 — 빈 상태 렌더', async () => {
    api.get.mockImplementation((url) =>
      url === '/api/guru/managers/brk'
        ? Promise.reject({ response: { status: 404 } })
        : Promise.resolve({ data: [] })
    )
    renderPage()
    expect(await screen.findByText('매니저를 찾을 수 없습니다.')).toBeTruthy()
  })
})

describe('GuruDetail 모바일 appbar 제목 축약 (task#229 S2)', () => {
  // appbar 제목이 2줄로 접히면 스크롤 시 헤더 아래 잔여가 남는다 — 접힘의 원인이던 firm 중복을 제거.
  // (2줄→1줄 여부 자체는 jsdom이 레이아웃을 계산하지 않아 단언 불가 → 라이브 실측이 게이트)
  // 라이브 데이터의 실제 형태 — 이름 자체에 firm이 " - "로 붙어 있어 2줄로 접혔다
  const DASHED = { ...MANAGER_NO_HOLDINGS, name: 'Warren Buffett - Berkshire Hathaway' }

  it('appbar h1은 " - " 앞부분만 쓰고 firm 줄은 그대로 남는다', async () => {
    viewport.mobile = true
    mockManager(DASHED)
    const { container } = renderPage()
    await screen.findByText('Berkshire Hathaway')          // firm 문단은 유지
    const h1 = container.querySelector('.appbar h1')
    expect(h1.textContent).toBe('Warren Buffett')
    expect(h1.textContent).not.toContain(' - ')
  })
})

describe('GuruDetail 좌하단 목록복귀 pill (task#228 S2)', () => {
  // fixed 좌표는 jsdom이 블라인드 — 여기선 렌더·링크 대상만 단언하고 위치는 라이브 실측으로 검증한다.
  it('.list-pill--left 가 렌더되고 /guru 로 링크', async () => {
    mockManager(MANAGER_NO_HOLDINGS)
    const { container } = renderPage()
    await screen.findByText('Warren Buffett')
    const pill = container.querySelector('.list-pill--left')
    expect(pill).toBeTruthy()
    expect(pill.getAttribute('href')).toBe('/guru')
    expect(pill.classList.contains('list-pill')).toBe(true)
  })
})

import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter, Routes, Route, Navigate } from 'react-router-dom'

// task#172 S2: 구 URL → 신규 라우트 맵(ADR-0025) 리다이렉트를 순수 라우팅 로직 수준에서 검증.
// 실 목적지 페이지(Reports/MarketHub 등)는 무거운 데이터훅을 갖고 있어 마커로 대체하고,
// App.jsx와 동일한 <Navigate replace> 매핑만 재현한다.
function RedirectRoutes() {
  return (
    <Routes>
      <Route path="/" element={<Navigate to="/reports" replace />} />
      <Route path="/research" element={<Navigate to="/reports" replace />} />
      <Route path="/reports" element={<div>REPORTS_PAGE</div>} />
      <Route path="/market" element={<Navigate to="/market/indicators" replace />} />
      <Route path="/market/indicators" element={<div>MARKET_INDICATORS_PAGE</div>} />
      <Route path="/analysis" element={<Navigate to="/portfolio" replace />} />
      <Route path="/portfolio" element={<div>PORTFOLIO_PAGE</div>} />
    </Routes>
  )
}

describe('구 URL 리다이렉트 매핑', () => {
  it('/ 는 /reports 로 리다이렉트된다', () => {
    render(<MemoryRouter initialEntries={['/']}><RedirectRoutes /></MemoryRouter>)
    expect(screen.getByText('REPORTS_PAGE')).toBeInTheDocument()
  })

  it('/research 는 /reports 로 리다이렉트된다', () => {
    render(<MemoryRouter initialEntries={['/research']}><RedirectRoutes /></MemoryRouter>)
    expect(screen.getByText('REPORTS_PAGE')).toBeInTheDocument()
  })

  it('/market 은 /market/indicators 로 리다이렉트된다', () => {
    render(<MemoryRouter initialEntries={['/market']}><RedirectRoutes /></MemoryRouter>)
    expect(screen.getByText('MARKET_INDICATORS_PAGE')).toBeInTheDocument()
  })

  it('/analysis 는 /portfolio 로 리다이렉트된다(기존 동작 유지)', () => {
    render(<MemoryRouter initialEntries={['/analysis']}><RedirectRoutes /></MemoryRouter>)
    expect(screen.getByText('PORTFOLIO_PAGE')).toBeInTheDocument()
  })
})

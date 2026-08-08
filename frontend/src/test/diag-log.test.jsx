// task#284 S2 — 진단 로그 진입점 2종(브라우저 `?diag=1` · 설정 화면 "진단 로그" 섹션) + 복사 기능.
// 진입점 A는 App의 diag 분기가 authLoading/session 검사보다 먼저라 로그인 셸을 마운트하지 않는다
// (이 코드베이스가 테스트에서 App을 안 쓰는 이유인 로그인 셸 모킹 비용이 여기서는 발생하지 않는다).
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// jsdom엔 matchMedia가 없다 — 설정 화면 렌더에 필요한 관례적 모킹(back-to-login-guard.test.jsx와 동일).
vi.mock('../hooks/useIsMobile', () => ({ default: () => false }))

import App from '../App'
import Settings from '../pages/Settings'
import { logDiag, clearDiag } from '../utils/diag'

beforeEach(() => {
  localStorage.clear()
  clearDiag()
})
afterEach(() => {
  window.history.pushState({}, '', '/')
  localStorage.clear()
})

describe('진입점 A(브라우저) — App의 ?diag=1', () => {
  it('비로그인 상태에서도 진단 로그가 렌더된다 (완료기준1 핵심 케이스)', () => {
    expect(localStorage.getItem('access_token')).toBeNull()
    logDiag('test-event', { note: 'hello' })
    window.history.pushState({}, '', '/?diag=1')

    render(<App />)

    expect(screen.getByText('로그 복사')).toBeInTheDocument()
    expect(screen.getByText(/test-event/)).toBeInTheDocument()
    // 로그인 게이트를 우회했는지 확인 — diag 분기가 LoginPage보다 먼저다.
    expect(screen.queryByText('Google로 계속')).not.toBeInTheDocument()
  })

  it('로그인 상태에서도 진단 로그가 렌더된다', () => {
    localStorage.setItem('access_token', 't')
    window.history.pushState({}, '', '/?diag=1')

    render(<App />)

    expect(screen.getByText('로그 복사')).toBeInTheDocument()
  })
})

describe('진입점 B(PWA) — 설정 화면', () => {
  it('설정 화면에 "진단 로그" 섹션이 존재한다', () => {
    render(<Settings />)

    expect(screen.getByText('진단 로그')).toBeInTheDocument()
    expect(screen.getByText('로그 복사')).toBeInTheDocument()
  })
})

describe('복사 버튼', () => {
  it('로그 전문을 클립보드로 넘긴다', async () => {
    logDiag('ev1', { a: 1 })
    const writeText = vi.fn().mockResolvedValue()
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    window.history.pushState({}, '', '/?diag=1')

    render(<App />)
    fireEvent.click(screen.getByText('로그 복사'))

    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1))
    const copied = JSON.parse(writeText.mock.calls[0][0])
    expect(copied[0].ev).toBe('ev1')
  })

  // 적대적 리뷰 L1 — writeText 부재가 아니라 **거절**되는 경로. 계획이 요구한 폴백이
  // 부재 케이스에만 걸려 있었다(PWA에서 권한 거절 시 사용자가 아무 피드백도 못 받는다).
  it('clipboard가 거절하면 execCommand 폴백을 탄다', async () => {
    logDiag('ev1', { a: 1 })
    const writeText = vi.fn().mockRejectedValue(new Error('denied'))
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    document.execCommand = vi.fn(() => true)
    window.history.pushState({}, '', '/?diag=1')

    render(<App />)
    fireEvent.click(screen.getByText('로그 복사'))

    await waitFor(() => expect(document.execCommand).toHaveBeenCalledWith('copy'))
  })
})

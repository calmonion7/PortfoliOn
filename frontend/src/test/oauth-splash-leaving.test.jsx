// task#285 S4 — LoginPage.startOAuth는 이동 전에 스플래시를 동기 페인트하고(잔상의 근원인
// bfcache 복원 프레임이 로그인 폼이 아니라 스플래시가 되게 함), 취소 후 뒤로가기로 돌아오면
// (토큰 없음) 로그인 폼을 되돌린다. 토큰이 있으면 App의 useBfcacheAuthGuard가 세션을 뒤집어
// 이 화면 자체를 교체할 몫이므로 여기서 먼저 걷지 않는다(레이스 방지).
import { render, fireEvent, act } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// jsdom엔 matchMedia가 없다 — 이 검증은 반응형과 무관하므로 PC로 고정(기존 관례).
vi.mock('../hooks/useIsMobile', () => ({ default: () => false }))

import LoginPage from '../pages/LoginPage'

beforeEach(() => {
  vi.stubGlobal('location', {
    href: 'http://localhost/', origin: 'http://localhost', pathname: '/', search: '',
    replace: vi.fn(), assign: vi.fn(), reload: vi.fn(),
  })
  localStorage.clear()
  sessionStorage.clear()
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  localStorage.clear()
  sessionStorage.clear()
})

// pageshow 핸들러가 setLeaving을 호출해 리렌더를 일으키므로 act로 감싼다(수동 dispatchEvent는
// fireEvent와 달리 act를 자동으로 씌우지 않는다).
const firePageShow = () => act(() => { window.dispatchEvent(new Event('pageshow')) })

describe('LoginPage — 떠나기 직전 스플래시 페인트(task#285 S4)', () => {
  it('구글 버튼 클릭 직후 DOM이 스플래시다 — 로그인 폼이 아니다', () => {
    const { container, getByText, queryByText } = render(<LoginPage />)
    fireEvent.click(getByText('Google로 계속'))
    expect(container.querySelector('.oauth-splash')).toBeTruthy()
    expect(queryByText('Google로 계속')).toBeNull()
  })
})

describe('LoginPage — 취소 복귀 가드(task#285 S4)', () => {
  it('토큰 없는 pageshow에서 로그인 폼이 복귀한다', () => {
    const { container, getByText } = render(<LoginPage />)
    fireEvent.click(getByText('Google로 계속'))
    expect(container.querySelector('.oauth-splash')).toBeTruthy()

    firePageShow()
    expect(getByText('Google로 계속')).toBeInTheDocument()
  })

  it('토큰이 있으면 pageshow에도 스플래시를 유지한다 — App의 성공 착지 가드가 뒤집을 몫이라 선점하지 않는다', () => {
    localStorage.setItem('access_token', 't')
    const { container, getByText } = render(<LoginPage />)
    fireEvent.click(getByText('Google로 계속'))

    firePageShow()
    expect(container.querySelector('.oauth-splash')).toBeTruthy()
  })
})

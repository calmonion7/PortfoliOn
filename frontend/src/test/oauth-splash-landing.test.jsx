// 적대적 리뷰 확증 HIGH — 콜백 문서(/?oauth=)에서 React 첫 커밋이 index.html의 정적
// 스플래시를 지우고, authLoading 동안(코드교환 fetch 대기) 그 자리가 순수 blank가 된다.
// App은 authLoading 중 index.html과 동일한 SPLASH_HTML을 이어 그려야 한다(랜딩일 때만).
import { render } from '@testing-library/react'
import { describe, it, expect, vi, afterEach } from 'vitest'

vi.mock('../hooks/useAuthBootstrap', () => ({
  default: () => ({ session: null, setSession: vi.fn(), authLoading: true }),
}))

import App from '../App'

const atSearch = (search) => {
  vi.stubGlobal('location', {
    href: `http://localhost/${search}`, origin: 'http://localhost',
    pathname: '/', search, replace: vi.fn(), assign: vi.fn(), reload: vi.fn(),
  })
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('App — OAuth 콜백 랜딩 중 authLoading 블랭크 방지', () => {
  it('?oauth= 랜딩에서는 authLoading 동안 스플래시를 그린다 (blank 아님)', () => {
    atSearch('?oauth=abc123')
    const { container } = render(<App />)
    expect(container.querySelector('.oauth-splash')).toBeTruthy()
  })

  it('?error= 랜딩에서도 authLoading 동안 스플래시를 그린다', () => {
    atSearch('?error=oauth_denied')
    const { container } = render(<App />)
    expect(container.querySelector('.oauth-splash')).toBeTruthy()
  })

  it('일반 로드(파라미터 없음)에서는 authLoading 중 여전히 blank(null) — 기존 동작 보존', () => {
    atSearch('')
    const { container } = render(<App />)
    expect(container.querySelector('.oauth-splash')).toBeNull()
    expect(container.innerHTML).toBe('')
  })
})

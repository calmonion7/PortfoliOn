// task#245 — 로그인 후 뒤로가기로 로그인 화면 재진입 차단.
// 검증 대상 2종:
//   ① bfcache 가드(useBfcacheAuthGuard) 4분기
//   ② 전체이동 진입점이 push(location.href)가 아니라 replace인지 — LoginPage 폼 로그인 · api.js 401
// jsdom은 bfcache를 원리적으로 재현할 수 없으므로 여기서 고정하는 건 '가드의 분기'까지다.
// 실제 복원 동작은 라이브 프로브(scripts/uat245-back-to-login.mjs)가 실측한다.
import { render, renderHook, waitFor, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// jsdom엔 matchMedia가 없다 — 뒤로가기 차단은 반응형과 무관하므로 PC로 고정한다(기존 관례).
vi.mock('../hooks/useIsMobile', () => ({ default: () => false }))

import useBfcacheAuthGuard from '../hooks/useBfcacheAuthGuard'
import LoginPage from '../pages/LoginPage'
import api from '../api'

// jsdom에서 location.replace는 non-writable이라 spyOn이 막힌다(TypeError: Cannot redefine
// property). 반면 window.location 자체는 configurable이라 객체째 stubGlobal로 갈아끼운다.
let replaceSpy
beforeEach(() => {
  replaceSpy = vi.fn()
  vi.stubGlobal('location', {
    href: 'http://localhost/', origin: 'http://localhost', pathname: '/', search: '',
    replace: replaceSpy, assign: vi.fn(), reload: vi.fn(),
  })
  localStorage.clear()
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  localStorage.clear()
})

const firePageShow = (persisted) => {
  const e = new Event('pageshow')
  Object.defineProperty(e, 'persisted', { value: persisted })
  window.dispatchEvent(e)
}

describe('useBfcacheAuthGuard — bfcache 복원 시 토큰 유무와 화면 상태가 어긋나면 다시 평가', () => {
  it('persisted=false면 무동작 (일반 네비게이션은 JS가 재실행되므로 개입 불필요)', () => {
    localStorage.setItem('access_token', 't')
    renderHook(() => useBfcacheAuthGuard(false))
    firePageShow(false)
    expect(replaceSpy).not.toHaveBeenCalled()
  })

  it('토큰 있고 로그인 상태면 무동작 (외부 링크 왕복 복귀에서 불필요한 리로드 금지)', () => {
    localStorage.setItem('access_token', 't')
    renderHook(() => useBfcacheAuthGuard(true))
    firePageShow(true)
    expect(replaceSpy).not.toHaveBeenCalled()
  })

  it('토큰 없고 로그아웃 상태면 무동작', () => {
    renderHook(() => useBfcacheAuthGuard(false))
    firePageShow(true)
    expect(replaceSpy).not.toHaveBeenCalled()
  })

  it('토큰 있는데 로그인 화면이 복원되면 replace — 로그인 후 뒤로가기 차단', () => {
    localStorage.setItem('access_token', 't')
    renderHook(() => useBfcacheAuthGuard(false))
    firePageShow(true)
    expect(replaceSpy).toHaveBeenCalledWith('/')
  })

  it('토큰 없는데 앱 화면이 복원되면 replace — 로그아웃 후 뒤로가기 차단', () => {
    renderHook(() => useBfcacheAuthGuard(true))
    firePageShow(true)
    expect(replaceSpy).toHaveBeenCalledWith('/')
  })

  it('언마운트 후에는 리스너가 남지 않는다', () => {
    localStorage.setItem('access_token', 't')
    const { unmount } = renderHook(() => useBfcacheAuthGuard(false))
    unmount()
    firePageShow(true)
    expect(replaceSpy).not.toHaveBeenCalled()
  })
})

describe('전체이동 진입점 — push가 아니라 replace', () => {
  it('LoginPage 폼 로그인 성공 시 replace(/) — 로그인 화면 엔트리를 남기지 않는다', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ access_token: 'a', refresh_token: 'r' }),
    }))
    const { container } = render(<LoginPage />)
    fireEvent.change(container.querySelector('input[type="email"]'), { target: { value: 'x@y.z' } })
    fireEvent.change(container.querySelector('input[type="password"]'), { target: { value: 'pw' } })
    fireEvent.submit(container.querySelector('form'))
    await waitFor(() => expect(replaceSpy).toHaveBeenCalledWith('/'))
    expect(localStorage.getItem('access_token')).toBe('a')
  })

  it('api 401 인터셉터가 replace(/) — 만료 시점 딥링크 엔트리를 남기지 않는다', async () => {
    localStorage.setItem('access_token', 'stale')
    const onRejected = api.interceptors.response.handlers[0].rejected
    await expect(onRejected({ response: { status: 401 } })).rejects.toBeTruthy()
    expect(replaceSpy).toHaveBeenCalledWith('/')
    expect(localStorage.getItem('access_token')).toBeNull()
  })

  it('401이 아닌 에러는 아무 데도 이동시키지 않는다', async () => {
    localStorage.setItem('access_token', 'live')
    const onRejected = api.interceptors.response.handlers[0].rejected
    await expect(onRejected({ response: { status: 500 } })).rejects.toBeTruthy()
    expect(replaceSpy).not.toHaveBeenCalled()
    expect(localStorage.getItem('access_token')).toBe('live')
  })
})

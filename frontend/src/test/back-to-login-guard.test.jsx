// task#245 — 로그인 후 뒤로가기로 로그인 화면 재진입 차단.
// 검증 대상 2종:
//   ① bfcache 가드(useBfcacheAuthGuard) 4분기
//   ② 전체이동 진입점의 히스토리 취급 — 진입점마다 다르다:
//      · LoginPage 폼 로그인 · api.js 401 → replace (남길 엔트리가 없다)
//      · OAuth 시작(구글·깃허브) → **의도된 push**(task#252) — 되감기 착지점을 우리 문서로 남겨야
//        하기 때문이다. 되감기 자체의 분기는 utils/oauthHistory.test.js가 고정한다.
// jsdom은 bfcache를 원리적으로 재현할 수 없으므로 여기서 고정하는 건 '가드의 분기'까지다.
// 실제 복원 동작은 라이브 프로브(scripts/uat245-back-to-login.mjs)가 실측한다.
//
// ⚠️ task#283에서 ①의 **판정축을 뒤집었다** — 가드는 이제 `location.replace('/')`로 문서를
// 다시 부르지 않고, 같은 문서 안에서 상태만 뒤집는다([[ADR-0035]]).
// 뒤집어도 되는지의 판별(task#264 절차)은 이렇게 했다:
//   · task#245 plan.md:50의 *의도* 산문은 "문서를 **다시 평가**시킨다"이고 `replace('/')`는
//     그 구현으로 명명된 수단이다. 재평가라는 목적은 상태 뒤집기로도 그대로 달성된다.
//   · 같은 계획서 :79가 `pushState`를 비목표로 기각한 사유는 "**앱 안에 가두는** 방식"인데,
//     즉시 `back()`으로 되돌아오는 이 사용은 가두지 않는다(뒤로가기 = 로그인 이전으로 이탈).
//   → 기록된 결정이 아니라 *수단*이므로 뒤집되, 사유를 여기와 ADR-0035에 남긴다.
// 뒤집은 이유(증상): 되감기 착지점이 곧 로그인 문서라, bfcache 복원 시 로그인 DOM이 칠해진 채
// 리로드가 끝날 때까지 노출됐다(안드로이드 크롬 실관측).
import { render, renderHook, waitFor, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// jsdom엔 matchMedia가 없다 — 뒤로가기 차단은 반응형과 무관하므로 PC로 고정한다(기존 관례).
vi.mock('../hooks/useIsMobile', () => ({ default: () => false }))

import useBfcacheAuthGuard from '../hooks/useBfcacheAuthGuard'
import LoginPage from '../pages/LoginPage'
import api from '../api'

// jsdom에서 location.replace는 non-writable이라 spyOn이 막힌다(TypeError: Cannot redefine
// property). 반면 window.location 자체는 configurable이라 객체째 stubGlobal로 갈아끼운다.
let replaceSpy, pushStateSpy, backSpy
beforeEach(() => {
  replaceSpy = vi.fn()
  vi.stubGlobal('location', {
    href: 'http://localhost/', origin: 'http://localhost', pathname: '/', search: '',
    replace: replaceSpy, assign: vi.fn(), reload: vi.fn(),
  })
  // 실제로 jsdom 히스토리를 움직이면 다른 케이스에 새므로 호출만 기록한다.
  pushStateSpy = vi.spyOn(window.history, 'pushState').mockImplementation(() => {})
  backSpy = vi.spyOn(window.history, 'back').mockImplementation(() => {})
  localStorage.clear()
  sessionStorage.clear()
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  localStorage.clear()
  sessionStorage.clear()
})

const firePageShow = (persisted) => {
  const e = new Event('pageshow')
  Object.defineProperty(e, 'persisted', { value: persisted })
  window.dispatchEvent(e)
}

// 4개 채널(replace·pushState·back·resolveSession)을 **모든 케이스에서 무조건** 단언한다.
// `if (조건) expect(...)` 형태를 쓰면 그 자체가 무음 스킵 장치가 되어, 표본이 빠진 실행이
// 초록으로 통과한다(CLAUDE.md 가토 ⑧ⓑ). 총계를 구조적으로 고정하는 편이 싸다.
const expectCalls = ({ replace = 0, push = 0, back = 0, resolve = 0 }, resolveSpy) => {
  expect(replaceSpy).toHaveBeenCalledTimes(replace)
  expect(pushStateSpy).toHaveBeenCalledTimes(push)
  expect(backSpy).toHaveBeenCalledTimes(back)
  expect(resolveSpy).toHaveBeenCalledTimes(resolve)
}

describe('useBfcacheAuthGuard — bfcache 복원 시 토큰 유무와 화면 상태가 어긋나면 같은 문서에서 뒤집는다', () => {
  it('persisted=false면 무동작 (일반 네비게이션은 JS가 재실행되므로 개입 불필요)', () => {
    localStorage.setItem('access_token', 't')
    const resolve = vi.fn()
    renderHook(() => useBfcacheAuthGuard(false, resolve))
    firePageShow(false)
    expectCalls({}, resolve)
  })

  it('토큰 있고 로그인 상태면 무동작 (외부 링크 왕복 복귀에서 불필요한 개입 금지)', () => {
    localStorage.setItem('access_token', 't')
    const resolve = vi.fn()
    renderHook(() => useBfcacheAuthGuard(true, resolve))
    firePageShow(true)
    expectCalls({}, resolve)
  })

  it('토큰 없고 로그아웃 상태면 무동작', () => {
    const resolve = vi.fn()
    renderHook(() => useBfcacheAuthGuard(false, resolve))
    firePageShow(true)
    expectCalls({}, resolve)
  })

  // task#283 — 이 작업의 본체. 리로드가 아니라 pruning + 상태 뒤집기다.
  it('토큰 있는데 로그인 화면이 복원되면 forward를 자르고, popstate 착지 *뒤에* 세션을 뒤집는다', () => {
    localStorage.setItem('access_token', 't')
    const resolve = vi.fn()
    renderHook(() => useBfcacheAuthGuard(false, resolve))
    firePageShow(true)

    // 히스토리부터 정리하고, 뒤집기는 아직 하지 않는다. 먼저 뒤집으면 Router가 마운트된 뒤
    // popstate가 도착해 '/'→'/reports' 재리다이렉트가 돌고 AppShell이 페이지를 재마운트한다.
    expectCalls({ push: 1, back: 1, resolve: 0 }, resolve)
    // push 인자 = 현재 URL. URL을 바꾸면 사용자가 눈치채고 Router 마운트 위치도 흔들린다.
    expect(pushStateSpy).toHaveBeenCalledWith({}, '', window.location.href)
    // back()이 pushState보다 뒤에 와야 트랩이 안 생긴다 — 순서가 곧 계약이다.
    expect(pushStateSpy.mock.invocationCallOrder[0]).toBeLessThan(backSpy.mock.invocationCallOrder[0])

    window.dispatchEvent(new Event('popstate'))
    expectCalls({ push: 1, back: 1, resolve: 1 }, resolve)
    expect(resolve).toHaveBeenCalledWith({ access_token: 't' })

    // 뒤집기는 정확히 1회 — popstate가 또 와도 다시 뒤집지 않는다.
    window.dispatchEvent(new Event('popstate'))
    expectCalls({ push: 1, back: 1, resolve: 1 }, resolve)
  })

  it('popstate가 오지 않아도 안전망이 뒤집는다 — 토큰을 쥔 채 로그인 화면에 갇히지 않는다', () => {
    vi.useFakeTimers()
    try {
      localStorage.setItem('access_token', 't')
      const resolve = vi.fn()
      renderHook(() => useBfcacheAuthGuard(false, resolve))
      firePageShow(true)
      expectCalls({ push: 1, back: 1, resolve: 0 }, resolve)
      vi.advanceTimersByTime(300)
      expectCalls({ push: 1, back: 1, resolve: 1 }, resolve)
      expect(resolve).toHaveBeenCalledWith({ access_token: 't' })
    } finally {
      vi.useRealTimers()
    }
  })

  it('토큰 없는데 앱 화면이 복원되면 세션만 비운다 — 이 방향엔 자를 IdP 엔트리가 없다', () => {
    const resolve = vi.fn()
    renderHook(() => useBfcacheAuthGuard(true, resolve))
    firePageShow(true)
    expectCalls({ resolve: 1 }, resolve)
    expect(resolve).toHaveBeenCalledWith(null)
  })

  it('언마운트 후에는 리스너가 남지 않는다', () => {
    localStorage.setItem('access_token', 't')
    const resolve = vi.fn()
    const { unmount } = renderHook(() => useBfcacheAuthGuard(false, resolve))
    unmount()
    firePageShow(true)
    expectCalls({}, resolve)
  })
})

describe('전체이동 진입점 — 폼·401은 replace, OAuth 시작은 의도된 push', () => {
  it('구글 버튼은 push(href)로 떠나며 되감기 기준값을 남긴다 (task#252)', () => {
    const { getByText } = render(<LoginPage />)
    fireEvent.click(getByText('Google로 계속'))
    expect(window.location.href).toBe('/api/auth/oauth/google')
    expect(replaceSpy).not.toHaveBeenCalled()
    expect(Number(sessionStorage.getItem('oauth_hist_len'))).toBe(window.history.length)
  })

  it('깃허브 버튼도 같은 경로 — 두 IdP 대칭 (task#252)', () => {
    const { getByText } = render(<LoginPage />)
    fireEvent.click(getByText('GitHub로 계속'))
    expect(window.location.href).toBe('/api/auth/oauth/github')
    expect(replaceSpy).not.toHaveBeenCalled()
    expect(sessionStorage.getItem('oauth_hist_len')).not.toBeNull()
  })

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

// task#253 — OAuth 에러·소진 코드 착지가 유효한 세션을 죽이지 않는다.
//
// 검증 대상: useAuthBootstrap의 5분기. 셋(에러·교환실패·네트워크실패)은 이전엔 저장 토큰을
// 보지 않고 setSession(null)을 단정했다 — 그래서 로그인돼 있는데 로그인 화면이 뜨고,
// 새로고침하면 돌아오는(localStorage는 그대로) 유령 버그가 됐다.
//
// 이 파일이 존재할 수 있는 이유가 곧 훅 추출의 이유다: 이 코드베이스는 테스트에서 App을
// import하지 않는 관례라(#245 회고) 분기가 App 안에 있는 동안은 단위테스트가 닿지 못했다.
import { renderHook, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

import useAuthBootstrap from '../hooks/useAuthBootstrap'
import { returnFromOAuth } from '../utils/oauthHistory'

vi.mock('../utils/oauthHistory', () => ({ returnFromOAuth: vi.fn() }))

// 부트스트랩은 window.location.search를 읽는다. jsdom에서 location은 configurable이라
// 객체째 갈아끼운다(기존 관례 — back-to-login-guard.test.jsx와 동일한 이유).
const atUrl = (search) => {
  vi.stubGlobal('location', {
    href: `http://localhost/${search}`, origin: 'http://localhost',
    pathname: '/', search, replace: vi.fn(), assign: vi.fn(), reload: vi.fn(),
  })
}

beforeEach(() => {
  localStorage.clear()
  vi.spyOn(window.history, 'replaceState').mockImplementation(() => {})
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  localStorage.clear()
})

const settled = async (result) => {
  await waitFor(() => expect(result.current.authLoading).toBe(false))
  return result.current
}

describe('useAuthBootstrap — 에러·실패 착지는 저장 토큰으로 세션을 해석한다 (task#253)', () => {
  it('① ?error=oauth_denied + 토큰 있음 → 세션 유지 (로그인 화면 안 띄운다)', async () => {
    localStorage.setItem('access_token', 'live')
    atUrl('?error=oauth_denied')
    const { result } = renderHook(() => useAuthBootstrap())
    const s = await settled(result)
    expect(s.session).toEqual({ access_token: 'live' })
    expect(window.history.replaceState).toHaveBeenCalledWith({}, '', '/')
  })

  it('② ?error= + 토큰 없음 → null (로그아웃 상태에서는 로그인 화면이 정상)', async () => {
    atUrl('?error=oauth_failed')
    const { result } = renderHook(() => useAuthBootstrap())
    expect((await settled(result)).session).toBeNull()
  })

  it('③ 코드 교환 400(소진된 코드) + 토큰 있음 → 세션 유지', async () => {
    localStorage.setItem('access_token', 'live')
    atUrl('?oauth=used-code')
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 400 }))
    const { result } = renderHook(() => useAuthBootstrap())
    const s = await settled(result)
    expect(s.session).toEqual({ access_token: 'live' })
    expect(returnFromOAuth).not.toHaveBeenCalled()
  })

  it('④ 네트워크 실패(.catch) + 토큰 있음 → 세션 유지', async () => {
    localStorage.setItem('access_token', 'live')
    atUrl('?oauth=code')
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')))
    const { result } = renderHook(() => useAuthBootstrap())
    expect((await settled(result)).session).toEqual({ access_token: 'live' })
  })

  it('④-b 코드 교환 실패 + 토큰 없음 → null', async () => {
    atUrl('?oauth=used-code')
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 400 }))
    const { result } = renderHook(() => useAuthBootstrap())
    expect((await settled(result)).session).toBeNull()
  })

  it('⑤ 정상 ?oauth= 성공 → 토큰 저장 후 returnFromOAuth() (task#252 되감기 보존)', async () => {
    atUrl('?oauth=fresh')
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true, json: async () => ({ access_token: 'a', refresh_token: 'r' }),
    }))
    renderHook(() => useAuthBootstrap())
    await waitFor(() => expect(returnFromOAuth).toHaveBeenCalled())
    expect(localStorage.getItem('access_token')).toBe('a')
    expect(localStorage.getItem('refresh_token')).toBe('r')
  })

  it('일반 로드(쿼리 없음) — 저장 토큰이 곧 세션', async () => {
    localStorage.setItem('access_token', 'live')
    atUrl('')
    const { result } = renderHook(() => useAuthBootstrap())
    expect((await settled(result)).session).toEqual({ access_token: 'live' })
  })

  it('레거시 ?token=&refresh= 분기는 이동만 하고 동작 그대로 (non-goal)', async () => {
    atUrl('?token=t&refresh=r')
    const { result } = renderHook(() => useAuthBootstrap())
    expect((await settled(result)).session).toEqual({ access_token: 't' })
    expect(localStorage.getItem('refresh_token')).toBe('r')
  })
})

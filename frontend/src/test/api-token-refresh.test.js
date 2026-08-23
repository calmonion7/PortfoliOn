// task#(auth-gating) B9 — 401 반사적 단일비행 갱신. 사전(pre-emptive) 갱신은 비목표.
// 관례: window.location은 back-to-login-guard.test.jsx와 같은 stubGlobal 통째 교체
// (jsdom의 location.replace가 non-writable이라 spyOn 불가).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import api from '../api'

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

const rejected = () => api.interceptors.response.handlers[0].rejected

const mockRefreshOk = (access = 'a2', refresh = 'r2') =>
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ access_token: access, refresh_token: refresh }),
  }))

describe('api.js 401 반사적 단일비행 갱신 (B9)', () => {
  it('기본 갱신 — 401 → refresh 1회 → 원 요청 재시도 성공, 로그아웃 없음', async () => {
    localStorage.setItem('access_token', 'a1')
    localStorage.setItem('refresh_token', 'r1')
    mockRefreshOk()
    vi.spyOn(api, 'request').mockResolvedValue({ data: 'ok' })

    const config = { url: '/api/foo', headers: { Authorization: 'Bearer a1' } }
    const result = await rejected()({ response: { status: 401 }, config })

    expect(result).toEqual({ data: 'ok' })
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(fetch.mock.calls[0][0]).toContain('/api/auth/refresh')
    expect(replaceSpy).not.toHaveBeenCalled()
  })

  it('단일비행 — 동시 401 3건에 refresh 호출은 정확히 1회, 3건 모두 성공', async () => {
    localStorage.setItem('access_token', 'a1')
    localStorage.setItem('refresh_token', 'r1')
    mockRefreshOk()
    vi.spyOn(api, 'request').mockResolvedValue({ data: 'ok' })

    const mk = (url) => ({ response: { status: 401 }, config: { url, headers: {} } })
    const results = await Promise.all([
      rejected()(mk('/api/a')),
      rejected()(mk('/api/b')),
      rejected()(mk('/api/c')),
    ])

    expect(fetch).toHaveBeenCalledTimes(1)
    results.forEach((r) => expect(r).toEqual({ data: 'ok' }))
  })

  it('회전 저장 — 갱신 응답의 새 access·refresh_token이 localStorage에 덮어써진다', async () => {
    localStorage.setItem('access_token', 'a1')
    localStorage.setItem('refresh_token', 'r1')
    mockRefreshOk('a2', 'r2')
    vi.spyOn(api, 'request').mockResolvedValue({ data: 'ok' })

    await rejected()({ response: { status: 401 }, config: { headers: {} } })

    expect(localStorage.getItem('access_token')).toBe('a2')
    expect(localStorage.getItem('refresh_token')).toBe('r2')
  })

  it('헤더 갱신(이빨) — 재시도 요청의 Authorization이 새 토큰이다', async () => {
    localStorage.setItem('access_token', 'a1')
    localStorage.setItem('refresh_token', 'r1')
    mockRefreshOk('a2', 'r2')
    const requestSpy = vi.spyOn(api, 'request').mockResolvedValue({ data: 'ok' })

    await rejected()({
      response: { status: 401 },
      config: { headers: { Authorization: 'Bearer a1' } },
    })

    expect(requestSpy).toHaveBeenCalledTimes(1)
    expect(requestSpy.mock.calls[0][0].headers.Authorization).toBe('Bearer a2')
  })

  it('1회 한정 — 갱신 후에도 401이면(_retried) 재시도하지 않고 기존 로그아웃 경로로', async () => {
    localStorage.setItem('access_token', 'a1')
    localStorage.setItem('refresh_token', 'r1')
    mockRefreshOk()
    const requestSpy = vi.spyOn(api, 'request').mockResolvedValue({ data: 'ok' })

    const config = { headers: {}, _retried: true }
    await expect(rejected()({ response: { status: 401 }, config })).rejects.toBeTruthy()

    expect(fetch).not.toHaveBeenCalled()
    expect(requestSpy).not.toHaveBeenCalled()
    expect(replaceSpy).toHaveBeenCalledWith('/')
    expect(localStorage.getItem('access_token')).toBeNull()
  })

  it('refresh 토큰 부재 — 갱신을 시도하지 않고 즉시 기존 로그아웃 경로로', async () => {
    localStorage.setItem('access_token', 'a1')
    // refresh_token 없음
    vi.stubGlobal('fetch', vi.fn())
    const requestSpy = vi.spyOn(api, 'request').mockResolvedValue({ data: 'ok' })

    const config = { headers: {} }
    await expect(rejected()({ response: { status: 401 }, config })).rejects.toBeTruthy()

    expect(fetch).not.toHaveBeenCalled()
    expect(requestSpy).not.toHaveBeenCalled()
    expect(replaceSpy).toHaveBeenCalledWith('/')
  })

  // 검토 지적 수복(HIGH) — 갱신 응답이 도착하기 전에 다른 경로(로그아웃)가 토큰을 지우면
  // 그 응답으로 되살리지 않는다. 수복 전 코드는 무조건 setItem해 로그아웃을 무효화했다.
  it('경합 — 응답 도착 전 로그아웃되면 새로 발급된 토큰으로 되살리지 않는다', async () => {
    localStorage.setItem('access_token', 'a1')
    localStorage.setItem('refresh_token', 'r1')
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async () => {
      // 응답이 오는 사이 다른 경로(로그아웃)가 토큰을 지운다
      localStorage.removeItem('access_token')
      localStorage.removeItem('refresh_token')
      return { ok: true, json: async () => ({ access_token: 'a2', refresh_token: 'r2' }) }
    }))
    vi.spyOn(api, 'request').mockResolvedValue({ data: 'ok' })

    await expect(rejected()({ response: { status: 401 }, config: { headers: {} } })).rejects.toBeTruthy()

    expect(localStorage.getItem('access_token')).toBeNull()
    expect(localStorage.getItem('refresh_token')).toBeNull()
    expect(replaceSpy).toHaveBeenCalledWith('/')
  })

  // 검토 지적 수복(MEDIUM/LOW) — 이 탭의 갱신이 실패로 왔지만 그 사이 다른 탭이 같은
  // (1회용) refresh_token으로 먼저 회전을 마쳤으면, 그 탭의 새 토큰으로 재시도한다.
  // 수복 전 코드는 무조건 로그아웃해 정상 갱신된 다른 탭까지 끌고 내려갔다.
  it('경합 — 다른 탭이 먼저 회전했으면 그 탭의 새 토큰으로 재시도하고 로그아웃하지 않는다', async () => {
    localStorage.setItem('access_token', 'a1')
    localStorage.setItem('refresh_token', 'r1')
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async () => {
      // 다른 탭이 같은 refresh_token으로 먼저 회전을 마쳤다 → 이 탭의 시도는 서버에서 거부
      localStorage.setItem('access_token', 'aX')
      localStorage.setItem('refresh_token', 'rX')
      return { ok: false }
    }))
    const requestSpy = vi.spyOn(api, 'request').mockResolvedValue({ data: 'ok' })

    const result = await rejected()({ response: { status: 401 }, config: { headers: {} } })

    expect(result).toEqual({ data: 'ok' })
    expect(requestSpy.mock.calls[0][0].headers.Authorization).toBe('Bearer aX')
    expect(replaceSpy).not.toHaveBeenCalled()
    expect(localStorage.getItem('refresh_token')).toBe('rX') // 다른 탭 값 보존 — 덮어쓰지 않음
  })
})

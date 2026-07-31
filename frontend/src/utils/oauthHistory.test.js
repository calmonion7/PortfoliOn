// task#252 — OAuth 히스토리 되감기.
// IdP(구글·깃허브)가 자기 도메인에 만든 엔트리는 지울 수 없으므로, 로그인 성공 랜딩에서
// history.go(-delta)로 되감아 그것들을 히스토리 '앞'으로 밀어낸다.
// jsdom은 실제 히스토리 스택을 재현하지 못하므로 여기서 고정하는 건 '분기와 인자'까지다 —
// 실제 되감기 착지는 라이브 프로브(scripts/uat252-oauth-history.mjs)가 가짜 IdP로 실측한다.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { markOAuthStart, returnFromOAuth } from './oauthHistory'

// jsdom의 history.length는 read-only라 값을 바꿀 수 없다 — history 객체째 갈아끼운다
// (location도 replace가 non-writable이라 같은 이유로 stubGlobal, 기존 관례).
let goSpy, replaceSpy
const stubHistory = (length) => {
  goSpy = vi.fn()
  vi.stubGlobal('history', { length, go: goSpy, pushState: vi.fn(), replaceState: vi.fn() })
}

beforeEach(() => {
  replaceSpy = vi.fn()
  vi.stubGlobal('location', { href: 'http://localhost/', replace: replaceSpy })
  sessionStorage.clear()
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  sessionStorage.clear()
})

describe('markOAuthStart — 떠나기 직전 history.length를 기준값으로 남긴다', () => {
  it('현재 history.length를 저장한다', () => {
    stubHistory(4)
    markOAuthStart()
    expect(sessionStorage.getItem('oauth_hist_len')).toBe('4')
  })
})

describe('returnFromOAuth — 기준값 증분만큼 되감고, 불가하면 replace로 폴백', () => {
  it('delta 3이면 history.go(-3) — IdP 엔트리를 앞으로 밀어낸다', () => {
    sessionStorage.setItem('oauth_hist_len', '2')
    stubHistory(5)
    returnFromOAuth()
    expect(goSpy).toHaveBeenCalledWith(-3)
    expect(replaceSpy).not.toHaveBeenCalled()
  })

  it('기준값이 없으면 replace(/) — 되감을 근거가 없다', () => {
    stubHistory(5)
    returnFromOAuth()
    expect(replaceSpy).toHaveBeenCalledWith('/')
    expect(goSpy).not.toHaveBeenCalled()
  })

  it('delta 0이면 replace(/) — 엔트리가 늘지 않았다(전 구간이 replace 체인인 경우)', () => {
    sessionStorage.setItem('oauth_hist_len', '5')
    stubHistory(5)
    returnFromOAuth()
    expect(replaceSpy).toHaveBeenCalledWith('/')
    expect(goSpy).not.toHaveBeenCalled()
  })

  it('delta가 상한 20을 넘으면 replace(/) — history.length 캡(50)에 기준값이 밀린 경우', () => {
    sessionStorage.setItem('oauth_hist_len', '1')
    stubHistory(22)
    returnFromOAuth()
    expect(replaceSpy).toHaveBeenCalledWith('/')
    expect(goSpy).not.toHaveBeenCalled()
  })

  it('어느 분기에서도 기준값을 제거한다 — 다음 일반 로드가 stale 기준으로 되감지 않도록', () => {
    sessionStorage.setItem('oauth_hist_len', '2')
    stubHistory(5)
    returnFromOAuth()
    expect(sessionStorage.getItem('oauth_hist_len')).toBeNull()

    // delta 음수(기준값이 현재 길이보다 큼) → 폴백 경로에서도 제거된다
    sessionStorage.setItem('oauth_hist_len', '99')
    stubHistory(5)
    returnFromOAuth()
    expect(sessionStorage.getItem('oauth_hist_len')).toBeNull()
  })
})

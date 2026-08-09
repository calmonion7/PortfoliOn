// task#252 — OAuth 히스토리 되감기.
// IdP(구글·깃허브)가 자기 도메인에 만든 엔트리는 지울 수 없으므로, 로그인 성공 랜딩에서
// history.go(-delta)로 되감아 그것들을 히스토리 '앞'으로 밀어낸다.
// stubHistory는 배열+인덱스를 갖는 미니 세션 히스토리 모델이다 — pushState가 forward 엔트리를
// 잘라내고 length가 그에 따라 변하므로, "forward 잡음이 length를 밀어 delta가 어긋나는" 버그
// 클래스(task#285)를 재현할 수 있다. 실제 되감기 착지는 라이브 프로브(scripts/uat252-oauth-history.mjs,
// scripts/uat285-oauth-landing-splash.mjs)가 가짜 IdP로 실측한다.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { markOAuthStart, returnFromOAuth } from './oauthHistory'
import { REDIRECTS } from '../routes'

// jsdom의 history.length는 read-only라 값을 바꿀 수 없다 — history 객체째 갈아끼운다
// (location도 replace가 non-writable이라 같은 이유로 stubGlobal, 기존 관례).
// entriesOrLength가 배열이면 그 스택 그대로(index 기본값은 맨 끝), 숫자면 forward 잡음 없는
// 길이 N짜리 스택을 합성한다.
let goSpy, replaceSpy, pushStateSpy
const stubHistory = (entriesOrLength, index) => {
  goSpy = vi.fn()
  pushStateSpy = vi.fn()
  const entries = Array.isArray(entriesOrLength)
    ? [...entriesOrLength]
    : Array.from({ length: entriesOrLength }, (_, i) => `/e${i}`)
  let idx = index ?? entries.length - 1
  vi.stubGlobal('history', {
    get length() { return entries.length },
    go: goSpy,
    pushState: (state, title, url) => {
      pushStateSpy(state, title, url)
      entries.length = idx + 1 // forward 엔트리 절단
      entries.push(url)
      idx += 1
    },
    replaceState: (state, title, url) => { entries[idx] = url },
  })
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
    // 스택 길이 3(잡음 없음) — markOAuthStart가 착지 슬롯을 pushState해 +1하므로 기록값은 4
    stubHistory(3)
    markOAuthStart()
    expect(sessionStorage.getItem('oauth_hist_len')).toBe('4')
  })

  it('착지 슬롯을 REDIRECTS의 "/" 목적지로 pushState한다', () => {
    stubHistory(3)
    const landing = REDIRECTS.find(([from]) => from === '/')?.[1]
    markOAuthStart()
    expect(pushStateSpy).toHaveBeenCalledWith({}, '', landing)
  })
})

describe('markOAuthStart + returnFromOAuth — forward 잡음이 있어도 로그인 문서에 정확히 착지한다 (task#285)', () => {
  it('forward 잡음 1개가 있어도 되감기는 로그인 문서 슬롯에 착지한다 — go(-2)', () => {
    // 로그인 문서가 index 0, forward 잡음(뒤로가기 후 되돌아온 흔적) 1개 → length===2.
    // 수정 전 markOAuthStart는 이 잡음까지 기준값에 포함해 delta가 1칸 과소해지고
    // go(-1)이 나와 /api/auth/oauth/google(302만 뱉는 엔드포인트)에 착지한다(task#285 원인).
    stubHistory(['/login', '/junk'], 0)
    markOAuthStart()
    // OAuth 왕복이 엔트리 2개를 추가(location.href 이동 1개 + IdP 자체 1개) — 실제 top-level
    // navigation도 pushState처럼 forward를 자르고 새 엔트리를 붙이므로 같은 모델로 시뮬레이트한다.
    window.history.pushState({}, '', '/oauth-start')
    window.history.pushState({}, '', '/idp')
    returnFromOAuth()
    expect(goSpy).toHaveBeenCalledWith(-2)
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

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
import { readDiag, clearDiag } from '../utils/diag'

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
  clearDiag()
  vi.spyOn(window.history, 'replaceState').mockImplementation(() => {})
  // vi.mock 팩토리가 만든 vi.fn()은 restoreAllMocks 대상이 아니라 호출이 **누적**된다.
  // 안 지우면 returnFromOAuth 단언이 실행 순서에 의존한다(옛 `not.toHaveBeenCalled()`가
  // 앞에 있어서 우연히 통과하던 상태 — 순서가 바뀌면 조용히 깨진다).
  returnFromOAuth.mockClear()
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
    // task#264로 판정이 바뀌었다 — 옛 단언은 `not.toHaveBeenCalled()`였다.
    // 그건 "실패 경로는 되감지 않는다"는 결정이 아니라 "성공 경로를 잘못 타지 않았다"는
    // 부수적 확인이었다(task#253 계획의 완료기준은 '정상 성공 경로 보존'뿐이고,
    // 6차 리포트 L1도 실패 경로 되감기가 어디서도 논의된 바 없음을 확인했다).
    // 이제 실패 분기도 대칭으로 되감으므로 호출되는 것이 정상이다.
    expect(returnFromOAuth).toHaveBeenCalledTimes(1)
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
    const { result } = renderHook(() => useAuthBootstrap())
    await waitFor(() => expect(returnFromOAuth).toHaveBeenCalled())
    expect(localStorage.getItem('access_token')).toBe('a')
    expect(localStorage.getItem('refresh_token')).toBe('r')
    // task#283 — 성공 분기도 이 문서의 세션을 해석해야 한다(나머지 세 분기와 대칭).
    // 빠뜨리면 authLoading이 영원히 true라 App이 null을 반환하고, 이 문서가 나중에
    // forward로 되짚어져 bfcache 복원되면 새로고침 전까지 못 빠져나오는 백지가 된다.
    // 되감기가 곧 떠나므로 화면엔 안 보이지만 문서 상태로는 남는다.
    expect((await settled(result)).session).toEqual({ access_token: 'a' })
  })

  // ── task#264 — 실패 3분기도 성공 분기와 대칭으로 되감는다 (6차 리포트 L1) ──
  // IdP가 자기 도메인에 push한 엔트리는 실패했다고 사라지지 않는다. 되감지 않으면
  // OAuth 거부·교환실패·네트워크실패 뒤 **뒤로가기 1회가 구글 화면으로 나간다**.
  // 여기서 고정하는 건 훅의 배선(호출 여부)이다 — 되감기 자체의 분기(delta 계산,
  // MAX_REWIND 초과·기준값 부재 시 replace('/') 폴백)는 utils/oauthHistory.test.js가 핀한다.

  it('L1-① ?error= 착지도 되감는다 (거부·실패 후 뒤로가기가 IdP로 나가지 않게)', async () => {
    localStorage.setItem('access_token', 'live')
    atUrl('?error=oauth_denied')
    const { result } = renderHook(() => useAuthBootstrap())
    expect((await settled(result)).session).toEqual({ access_token: 'live' })
    expect(returnFromOAuth).toHaveBeenCalledTimes(1)
  })

  it('L1-② 네트워크 실패(.catch)도 되감는다', async () => {
    localStorage.setItem('access_token', 'live')
    atUrl('?oauth=code')
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')))
    const { result } = renderHook(() => useAuthBootstrap())
    expect((await settled(result)).session).toEqual({ access_token: 'live' })
    await waitFor(() => expect(returnFromOAuth).toHaveBeenCalledTimes(1))
  })

  it('L1-③ 토큰이 없어도 되감는다 (되감기는 세션 유무와 독립 — 히스토리 정리다)', async () => {
    atUrl('?error=oauth_failed')
    const { result } = renderHook(() => useAuthBootstrap())
    expect((await settled(result)).session).toBeNull()
    expect(returnFromOAuth).toHaveBeenCalledTimes(1)
  })

  it('L1-④ 되감기는 OAuth 착지에서만 — 일반 로드·레거시 토큰 분기는 무관', async () => {
    localStorage.setItem('access_token', 'live')
    atUrl('')
    const { result } = renderHook(() => useAuthBootstrap())
    await settled(result)
    expect(returnFromOAuth).not.toHaveBeenCalled()
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

  // ── task#285 S5 — `doc` 로그에 `resp`(responseStart) 추가. 서버·리다이렉트 구간과
  // 번들·마운트 구간을 가르기 위한 필드다. 두 경로(엔트리 있음/없음)를 쌍으로 단언한다 —
  // 성공 경로만 스텁한 테스트는 부재 경로(jsdom·구형 브라우저)에 원리적으로 블라인드하다.
  describe('doc 로그 — resp(responseStart) (task#285 S5)', () => {
    it('navigation 엔트리가 있으면 resp가 반올림되어 실린다', async () => {
      vi.spyOn(performance, 'getEntriesByType').mockReturnValue([
        { type: 'navigate', responseStart: 123.7 },
      ])
      atUrl('')
      const { result } = renderHook(() => useAuthBootstrap())
      await settled(result)
      const doc = readDiag().find(e => e.ev === 'doc')
      expect(doc.resp).toBe(124)
      expect(doc.nav).toBe('navigate') // 기존 필드 의미는 불변
    })

    it('navigation 엔트리가 없으면 resp 키 자체가 없다', async () => {
      vi.spyOn(performance, 'getEntriesByType').mockReturnValue([])
      atUrl('')
      const { result } = renderHook(() => useAuthBootstrap())
      await settled(result)
      const doc = readDiag().find(e => e.ev === 'doc')
      expect('resp' in doc).toBe(false)
      expect(doc.nav).toBeUndefined()
    })
  })

  // ── task#288 S1 — `doc` 로그에 req(requestStart)·di(domInteractive)·js(메인 번들
  // responseEnd)를 추가한다. 콜백 문서 SPA 부팅 2251ms(task#284 실측, 체감의 89.6%)를
  // 0→req→resp→di→마운트로 쪼개기 위한 필드다. 위 resp와 **같은 계약** — 값이 없으면
  // 키 자체를 넣지 않는다.
  // ⚠️ domContentLoadedEventEnd는 쓰지 않는다: type="module"은 defer라 모듈 실행(=마운트)
  // 이후에 DOMContentLoaded가 발화하므로 기록 시점의 그 값은 늘 0이다("필드는 있는데 늘 0"인
  // 죽은 계측 — task#287의 죽은 가드와 같은 부류).
  // 부재 계약(②④)은 구현 전에도 통과하지만 공허하지 않다: 구현이 값을 무조건 넣으면
  // Math.round(undefined)=NaN이 JSON에서 null로 직렬화돼 "키는 있는데 값이 null"인
  // 죽은 필드가 되고, 그때 이 둘이 FAIL한다(그게 이 쌍의 이빨이다).
  describe('doc 로그 — req·di·js 부팅 구간 (task#288 S1)', () => {
    const perfBy = (nav, resource = []) =>
      vi.spyOn(performance, 'getEntriesByType').mockImplementation(
        (type) => (type === 'navigation' ? nav : type === 'resource' ? resource : []),
      )
    const NAV = { type: 'navigate', requestStart: 12.4, responseStart: 123.7, domInteractive: 456.6 }
    const docLog = () => readDiag().find(e => e.ev === 'doc')

    it('① navigation 엔트리가 있으면 req·di가 반올림되어 실린다', async () => {
      perfBy([NAV])
      atUrl('')
      const { result } = renderHook(() => useAuthBootstrap())
      await settled(result)
      const doc = docLog()
      expect(doc.req).toBe(12)
      expect(doc.di).toBe(457)
      expect(doc.resp).toBe(124) // 기존 필드 의미는 불변
    })

    it('② navigation 엔트리가 없으면 req·di 키 자체가 없다', async () => {
      perfBy([])
      atUrl('')
      const { result } = renderHook(() => useAuthBootstrap())
      await settled(result)
      const doc = docLog()
      expect('req' in doc).toBe(false)
      expect('di' in doc).toBe(false)
    })

    it('③ 메인 번들 resource 엔트리가 있으면 js에 responseEnd가 실린다', async () => {
      perfBy([NAV], [{ name: 'https://portfolion.taebro.com/assets/index-DRkRI1jj.js', responseEnd: 789.4 }])
      atUrl('')
      const { result } = renderHook(() => useAuthBootstrap())
      await settled(result)
      expect(docLog().js).toBe(789)
    })

    it('④ 메인 번들과 매칭되는 resource 엔트리가 없으면 js 키가 없다', async () => {
      perfBy([NAV], [{ name: 'https://portfolion.taebro.com/assets/vendor-abc.js', responseEnd: 500 }])
      atUrl('')
      const { result } = renderHook(() => useAuthBootstrap())
      await settled(result)
      expect('js' in docLog()).toBe(false)
    })

    it('⑤ perf 조회가 throw해도 부트스트랩이 완주하고 doc은 남는다', async () => {
      // 이 훅은 앱의 진입 경로다 — 여기서 throw하면 화면이 통째로 빈다(task#283 백지 사례).
      vi.spyOn(performance, 'getEntriesByType').mockImplementation(() => {
        throw new Error('perf blocked')
      })
      localStorage.setItem('access_token', 'live')
      atUrl('')
      const { result } = renderHook(() => useAuthBootstrap())
      expect((await settled(result)).session).toEqual({ access_token: 'live' })
      const doc = docLog()
      expect(doc.url).toBe('/')
      expect('req' in doc).toBe(false)
    })

    it('⑥ 값이 유한한 0이면 키가 살아남는다 — "0"과 "엔트리 없음"은 다르다', async () => {
      // 적대적 리뷰 F2(HIGH) — 두 렌즈가 독립적으로 수렴한 발견. round()를 truthy 체크
      // `(v ? Math.round(v) : undefined)`로 쓰면 유한한 0이 조용히 드롭돼, 로그에서 "값이 0"과
      // "엔트리가 없다"가 **구별 불가**가 된다. 위 ①~⑤와 기존 resp 계약은 fixture가 전부
      // truthy 값이라 그 결함에 원리적으로 블라인드했다(주입 실측: 24/24 전부 통과).
      // 하필 SW 캐시에서 즉시 응답하는 **웜 로드가 requestStart가 0으로 반올림될 수 있는 자리**이고,
      // 이 태스크의 콜드/웜 대조가 정확히 그 케이스를 잰다 — 이 슬라이스의 목적에 직접 닿는다.
      perfBy([{ type: 'navigate', requestStart: 0, responseStart: 12.4, domInteractive: 456.6 }],
        [{ name: 'https://portfolion.taebro.com/assets/index-DRkRI1jj.js', responseEnd: 789.4 }])
      atUrl('')
      const { result } = renderHook(() => useAuthBootstrap())
      await settled(result)
      const doc = docLog()
      expect(doc.req).toBe(0)
      expect('req' in doc).toBe(true)
      expect(doc.resp).toBe(12) // 형제 필드는 정상 반올림
      expect(doc.di).toBe(457)
      expect(doc.js).toBe(789)
    })
  })
})

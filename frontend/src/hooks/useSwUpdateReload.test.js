// task#287 — SW 갱신 규율 훅.
// vite-plugin-pwa(registerType: 'autoUpdate')가 새 SW를 skipWaiting+clientsClaim으로 즉시
// claim해 controllerchange를 쏘지만, 앱 자신은 리로드하지 않아 열린 탭이 무기한 옛 번들을
// 돌린다. 이 훅이 그 창을 라우트 전환·탭 재활성 시점에 닫는다.
//
// ⚠️ 가장 중요한 함정 — clientsClaim은 **최초 방문에도** controllerchange를 쏜다. 마운트
// 시점에 controller가 이미 있었는지(hadController)로 "이 세션이 갱신을 겪었는가"를 가른다.
// 이 가드가 없으면 첫 방문마다 리로드한다(아래 ①이 정확히 이 회귀를 고정한다).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import useSwUpdateReload from './useSwUpdateReload'
import { REDIRECTS } from '../routes'

// EventTarget 흉내 — addEventListener/removeEventListener만 필요, dispatchEvent 대신
// 직접 fire()로 콜백을 호출한다(진짜 Event 객체 불필요, 훅은 인자를 안 읽는다).
function createMockSW(controller = null) {
  const listeners = { controllerchange: [] }
  return {
    controller,
    addEventListener: (ev, cb) => { (listeners[ev] ||= []).push(cb) },
    removeEventListener: (ev, cb) => { listeners[ev] = (listeners[ev] || []).filter((fn) => fn !== cb) },
    fire: (ev) => { listeners[ev].slice().forEach((fn) => fn()) },
    listeners,
  }
}

// controllerchange 리스너 정리 단언 — sw.listeners에서 직접 잰다(모킹 SW라 정확).
const assertSwListenerCleaned = (sw) => expect(sw.listeners.controllerchange).toHaveLength(0)

// visibilitychange 리스너 정리 단언 — 실 document라 add/remove 호출을 스파이로 대조한다.
function spyDocListeners() {
  return { add: vi.spyOn(document, 'addEventListener'), remove: vi.spyOn(document, 'removeEventListener') }
}
function assertVisibilityListenerCleaned({ add, remove }) {
  const added = add.mock.calls.filter((c) => c[0] === 'visibilitychange').map((c) => c[1])
  expect(added.length).toBeGreaterThan(0)
  expect(remove.mock.calls.filter((c) => c[0] === 'visibilitychange').map((c) => c[1])).toEqual(added)
}

const setVisibility = (state) => {
  Object.defineProperty(document, 'visibilityState', { value: state, configurable: true })
}

let sw
beforeEach(() => {
  sw = createMockSW(null)
  Object.defineProperty(window.navigator, 'serviceWorker', { value: sw, configurable: true })
  vi.stubGlobal('location', { pathname: '/', search: '', href: 'http://localhost/' })
  setVisibility('visible')
})
afterEach(() => {
  delete window.navigator.serviceWorker
  document.body.style.overflow = ''
  if (document.activeElement && document.activeElement !== document.body) document.activeElement.blur()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('useSwUpdateReload', () => {
  it('① controller===null로 마운트 → controllerchange → 라우트 변경해도 reload 미호출 (최초 방문 오발화 차단)', () => {
    const reload = vi.fn()
    const docSpies = spyDocListeners()
    const { rerender, unmount } = renderHook(
      ({ pathname }) => useSwUpdateReload(pathname, { reload }),
      { initialProps: { pathname: '/a' } },
    )
    sw.fire('controllerchange')
    rerender({ pathname: '/b' })
    expect(reload).not.toHaveBeenCalled()

    unmount()
    assertSwListenerCleaned(sw)
    assertVisibilityListenerCleaned(docSpies)
  })

  it('② controller 있음 → controllerchange → 라우트 변경 시 reload 정확히 1회', () => {
    sw.controller = {}
    const reload = vi.fn()
    const docSpies = spyDocListeners()
    const { rerender, unmount } = renderHook(
      ({ pathname }) => useSwUpdateReload(pathname, { reload }),
      { initialProps: { pathname: '/a' } },
    )
    sw.fire('controllerchange')
    rerender({ pathname: '/b' })
    expect(reload).toHaveBeenCalledTimes(1)

    unmount()
    assertSwListenerCleaned(sw)
    assertVisibilityListenerCleaned(docSpies)
  })

  it('③ 모달 열림(overflow:hidden) 중엔 미호출, 해제 후 다음 트리거에 호출', () => {
    sw.controller = {}
    const reload = vi.fn()
    const docSpies = spyDocListeners()
    const { rerender, unmount } = renderHook(
      ({ pathname }) => useSwUpdateReload(pathname, { reload }),
      { initialProps: { pathname: '/a' } },
    )
    sw.fire('controllerchange')
    document.body.style.overflow = 'hidden'
    rerender({ pathname: '/b' })
    expect(reload).not.toHaveBeenCalled()

    document.body.style.overflow = ''
    rerender({ pathname: '/c' })
    expect(reload).toHaveBeenCalledTimes(1)

    unmount()
    assertSwListenerCleaned(sw)
    assertVisibilityListenerCleaned(docSpies)
  })

  it('④ activeElement가 <input>일 때 미호출 (모달 밖 인라인 폼 입력 중)', () => {
    sw.controller = {}
    const reload = vi.fn()
    const docSpies = spyDocListeners()
    const input = document.createElement('input')
    document.body.appendChild(input)
    input.focus()
    const { rerender, unmount } = renderHook(
      ({ pathname }) => useSwUpdateReload(pathname, { reload }),
      { initialProps: { pathname: '/a' } },
    )
    sw.fire('controllerchange')
    rerender({ pathname: '/b' })
    expect(reload).not.toHaveBeenCalled()

    input.remove()
    unmount()
    assertSwListenerCleaned(sw)
    assertVisibilityListenerCleaned(docSpies)
  })

  it('⑤ 탭 재활성(visibilitychange → visible)도 라우트 변경과 동일하게 발동', () => {
    sw.controller = {}
    const reload = vi.fn()
    const docSpies = spyDocListeners()
    const { unmount } = renderHook(() => useSwUpdateReload('/a', { reload }))
    sw.fire('controllerchange')
    setVisibility('visible')
    document.dispatchEvent(new Event('visibilitychange'))
    expect(reload).toHaveBeenCalledTimes(1)

    unmount()
    assertSwListenerCleaned(sw)
    assertVisibilityListenerCleaned(docSpies)
  })

  it('⑥ navigator.serviceWorker 부재에서 마운트·언마운트에 throw 0', () => {
    delete window.navigator.serviceWorker
    const reload = vi.fn()
    const docSpies = spyDocListeners()
    let unmount
    expect(() => {
      const r = renderHook(({ pathname }) => useSwUpdateReload(pathname, { reload }), { initialProps: { pathname: '/a' } })
      unmount = r.unmount
    }).not.toThrow()
    expect(() => unmount()).not.toThrow()
    assertVisibilityListenerCleaned(docSpies)
  })

  it('⑦ location.search에 oauth=가 있으면 무장 상태·트리거에도 미호출, 콜백 이탈 후 다음 트리거에 호출', () => {
    sw.controller = {}
    window.location.search = '?oauth=abc123'
    const reload = vi.fn()
    const docSpies = spyDocListeners()
    const { rerender, unmount } = renderHook(
      ({ pathname }) => useSwUpdateReload(pathname, { reload }),
      { initialProps: { pathname: '/a' } },
    )
    sw.fire('controllerchange')
    rerender({ pathname: '/b' })
    expect(reload).not.toHaveBeenCalled()

    window.location.search = ''
    rerender({ pathname: '/c' })
    expect(reload).toHaveBeenCalledTimes(1)

    unmount()
    assertSwListenerCleaned(sw)
    assertVisibilityListenerCleaned(docSpies)
  })

  it('⑧ 최초 설치(controller===null) 무시 후 같은 탭의 다음 controllerchange는 정상 발동 (task#287 적대적 리뷰 — hadControllerRef 고착 회귀 가드)', () => {
    const reload = vi.fn()
    const docSpies = spyDocListeners()
    const { rerender, unmount } = renderHook(
      ({ pathname }) => useSwUpdateReload(pathname, { reload }),
      { initialProps: { pathname: '/a' } },
    )
    sw.fire('controllerchange') // 최초 설치 — 무시돼야 함
    rerender({ pathname: '/b' })
    expect(reload).not.toHaveBeenCalled()

    sw.fire('controllerchange') // 같은 탭에서 이후 발생한 진짜 갱신
    rerender({ pathname: '/c' })
    expect(reload).toHaveBeenCalledTimes(1)

    unmount()
    assertSwListenerCleaned(sw)
    assertVisibilityListenerCleaned(docSpies)
  })

  it('⑨ 마운트 경로가 REDIRECTS 출발지면 뒤따르는 내부 리다이렉트 1회는 reload 미호출, 그 다음 진짜 이동엔 발동 (task#287 적대적 리뷰 — App.jsx <Navigate replace> 오탐 가드)', () => {
    sw.controller = {}
    const [origin, dest] = REDIRECTS[0]
    const reload = vi.fn()
    const docSpies = spyDocListeners()
    const { rerender, unmount } = renderHook(
      ({ pathname }) => useSwUpdateReload(pathname, { reload }),
      { initialProps: { pathname: origin } },
    )
    sw.fire('controllerchange')
    rerender({ pathname: dest }) // App.jsx의 내부 <Navigate replace>와 동일한 전환
    expect(reload).not.toHaveBeenCalled()

    rerender({ pathname: '/ranking' }) // 그 다음은 진짜 사용자 이동
    expect(reload).toHaveBeenCalledTimes(1)

    unmount()
    assertSwListenerCleaned(sw)
    assertVisibilityListenerCleaned(docSpies)
  })
})

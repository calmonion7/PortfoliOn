import { useEffect, useRef } from 'react'
import { logDiag } from '../utils/diag'
import { REDIRECTS } from '../routes'

// 입력 중·모달 열림을 리로드로 깨지 않기 위한 가드.
// ⚠️ 아래 `oauth=` 검사는 **오늘의 배선에서는 도달 불가한 방어적 잔존 코드다** — 이것을 OAuth
// 보호로 읽지 말 것(task#287 적대적 리뷰). useAuthBootstrap이 코드교환 fetch *전에* 동기적으로
// history.replaceState({}, '', '/')로 search를 지우고(:58), App은 authLoading이 false가 된
// 뒤에야 AppShell을 렌더하므로(App.jsx:136), 이 훅이 존재하는 어떤 시점에도 search에 oauth=가
// 남아 있을 수 없다. 실제 OAuth 보호는 아래 initialRedirectRef다 — 콜백 문서는 '/'에 착지하는데
// 그건 REDIRECTS 출발지라, 그 내부 리다이렉트를 사용자 이동으로 오인하면 returnFromOAuth()의
// history.go(-delta) 되감기와 리로드가 경합한다.
function isBusy() {
  if (document.body.style.overflow === 'hidden') return true
  const el = document.activeElement
  const tag = el?.tagName
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true
  if (el?.hasAttribute?.('contenteditable')) return true
  if (window.location.search.includes('oauth=')) return true
  return false
}

// vite-plugin-pwa(registerType: 'autoUpdate' + skipWaiting + clientsClaim)는 새 SW가 열린
// 탭을 즉시 claim하지만 앱 자신은 리로드하지 않는다 — 열린 탭은 무기한 옛 번들을 실행한다
// (task#287). 이 훅이 그 창을 라우트 전환·탭 재활성 시점에 닫는다.
//
// ⚠️ clientsClaim은 **최초 방문에도** controllerchange를 쏜다. 마운트 시점에 controller가
// 이미 있었는지(hadController)로 "이 세션이 진짜 갱신을 겪었는가"를 가른다 — 없으면 그냥
// 첫 SW 설치이고, 이 가드가 없으면 첫 방문마다 리로드한다.
export default function useSwUpdateReload(pathname, { reload = () => window.location.reload() } = {}) {
  const hadControllerRef = useRef(!!navigator.serviceWorker?.controller)
  const pendingRef = useRef(false)
  const pathnameRef = useRef(pathname)
  // 마운트 시점 경로가 REDIRECTS 출발지(App.jsx의 내부 <Navigate replace>)면 뒤따르는 리다이렉트
  // 1회는 사용자 이동이 아니다 — 소진형 플래그로 그 1회만 흡수한다(task#287 적대적 리뷰).
  const initialRedirectRef = useRef(REDIRECTS.some(([from]) => from === pathname))

  useEffect(() => {
    const sw = navigator.serviceWorker
    if (!sw) return
    const onControllerChange = () => {
      // 최초 설치(hadController=false)의 controllerchange는 정확히 1회만 무시한다 — 이후엔
      // true로 되돌려야 같은 탭에서 그 다음에 오는 진짜 갱신이 무시되지 않는다.
      if (!hadControllerRef.current) {
        hadControllerRef.current = true
        return
      }
      pendingRef.current = true
      logDiag('sw-update', {})
    }
    sw.addEventListener('controllerchange', onControllerChange)
    return () => sw.removeEventListener('controllerchange', onControllerChange)
  }, [])

  const attemptReload = (via) => {
    if (!pendingRef.current || isBusy()) return
    pendingRef.current = false
    logDiag('sw-reload', { via })
    reload()
  }

  // 초기 마운트는 "라우트 변경"이 아니다 — pathnameRef 초기값이 곧 첫 렌더의 pathname이라
  // 첫 실행에서 조건이 항상 참으로 스킵된다.
  useEffect(() => {
    if (pathnameRef.current === pathname) return
    pathnameRef.current = pathname
    if (initialRedirectRef.current) {
      initialRedirectRef.current = false
      return
    }
    attemptReload('route')
  }, [pathname])

  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === 'visible') attemptReload('visibility')
    }
    document.addEventListener('visibilitychange', onVisibility)
    return () => document.removeEventListener('visibilitychange', onVisibility)
  }, [])
}

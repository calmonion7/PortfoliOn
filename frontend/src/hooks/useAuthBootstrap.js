import { useState, useEffect } from 'react'
import { returnFromOAuth } from '../utils/oauthHistory'
import { logDiag } from '../utils/diag'

// 인증 부트스트랩 — 첫 로드에서 세션을 해석한다(URL의 OAuth 결과 → localStorage 토큰).
// App에서 훅으로 뺀 이유: 이 코드베이스는 테스트에서 App을 import하지 않는 관례라(로그인 시
// 전체 셸을 렌더하므로 모킹 비용이 크다) App 안에 있는 동안 이 분기들은 단위테스트가 원리적으로
// 닿지 못하는 자리였다. #245(bfcache 가드)·#252(되감기)와 같은 판단 — 테스트 가능성이 배치를 결정한다.
export default function useAuthBootstrap() {
  const [session, setSession] = useState(null)
  const [authLoading, setAuthLoading] = useState(true)

  useEffect(() => {
    // task#284 진단 — 이 문서가 어떻게 열렸는지(일반 로드/bfcache 복원 후 재요청 등)를
    // 분기 판정 *이전에* 무조건 남긴다(가토 ⑧ⓑ — 조건부 기록은 무음 스킵 장치다).
    // task#285 S5 — resp(=responseStart)로 서버·리다이렉트 구간과 번들·마운트 구간을 가른다.
    // 엔트리가 없으면(jsdom·구형 브라우저) 키 자체를 넣지 않는다.
    const navEntry = performance.getEntriesByType?.('navigation')?.[0]
    logDiag('doc', {
      url: window.location.pathname + window.location.search,
      hasToken: !!localStorage.getItem('access_token'),
      nav: navEntry?.type,
      ...(navEntry ? { resp: Math.round(navEntry.responseStart) } : {}),
    })

    // 저장 토큰으로 세션을 해석한다. 에러·소진 코드 착지도 정상 경로와 **같은 규칙**을 쓴다 —
    // "OAuth가 실패했다"는 "세션이 없다"를 뜻하지 않는다(task#253).
    // 지배적 트리거는 사용자가 거절한 경우가 아니라 뒤로가기로 콜백 엔트리가 재실행된 경우다:
    // OAuth 코드는 1회용(TTL 120초)이라 재실행은 반드시 400이 되고, 그때 세션을 죽이면
    // 로그인돼 있는 사용자에게 로그인 화면이 뜬다(새로고침하면 돌아오므로 유령 버그로 보인다).
    const resolveStored = () => {
      const stored = localStorage.getItem('access_token')
      setSession(stored ? { access_token: stored } : null)
      setAuthLoading(false)
    }

    const params = new URLSearchParams(window.location.search)
    const oauthCode = params.get('oauth')
    const oauthError = params.get('error')
    const token = params.get('token')
    const refresh = params.get('refresh')

    // 에러 사유(oauth_denied·oauth_failed)는 표시하지 않는다 — 이 경로의 지배적 상황에서
    // 사용자는 로그인을 시도한 게 아니므로 알림이 노이즈다(그릴링에서 통지 제외 선택).
    // 실패 분기도 성공 분기와 **대칭으로** 되감는다(task#264). IdP 엔트리는 실패했다고
    // 사라지지 않으므로, 되감지 않으면 실패 후 뒤로가기 1회가 구글 화면으로 나간다.
    // resolveStored()를 먼저 두는 이유: returnFromOAuth()의 두 경로(history.go / replace)는
    // 비동기 내비게이션이라 그 사이 authLoading이 true로 남으면 스피너가 노출된다.
    if (oauthError) {
      window.history.replaceState({}, '', '/')
      resolveStored()
      logDiag('boot', { branch: 'error', session: !!localStorage.getItem('access_token') })
      returnFromOAuth()
      return
    }

    if (oauthCode) {
      window.history.replaceState({}, '', '/')
      const API = import.meta.env.VITE_API_BASE_URL || ''
      fetch(`${API}/api/auth/oauth/token?code=${oauthCode}`)
        .then(r => r.ok ? r.json() : null)
        .then(data => {
          if (data?.access_token) {
            localStorage.setItem('access_token', data.access_token)
            localStorage.setItem('refresh_token', data.refresh_token)
            // 되감기 전에 이 문서의 세션도 해석한다 — 나머지 세 분기와 대칭(task#283).
            // 빠뜨리면 이 문서는 authLoading=true에 영원히 머물러 App이 null을 반환한다.
            // 되감기가 곧 떠나므로 평소엔 안 보이지만, 이 문서가 나중에 forward로 되짚어져
            // bfcache 복원되면 **새로고침 전까지 빠져나올 수 없는 백지**가 된다. 예전엔
            // 가드의 전체 리로드가 그걸 우연히 치료했는데, 리로드를 없애며 노출됐다.
            resolveStored()
            logDiag('boot', { branch: 'oauth-ok', session: !!localStorage.getItem('access_token') })
            // IdP 엔트리를 뒤가 아니라 앞으로 밀어낸다 — 되감기 불가 시 replace('/')로 폴백(task#252)
            returnFromOAuth()
          } else {
            // 코드 교환 실패(소진·만료 코드는 400) — 저장 토큰이 있으면 그대로 유지한다.
            resolveStored()
            logDiag('boot', { branch: 'oauth-fail', session: !!localStorage.getItem('access_token') })
            returnFromOAuth()
          }
        })
        .catch(() => {
          // 네트워크 실패도 세션 부재의 근거가 아니다.
          resolveStored()
          logDiag('boot', { branch: 'oauth-net', session: !!localStorage.getItem('access_token') })
          returnFromOAuth()
        })
      return
    }

    if (token && refresh) {
      localStorage.setItem('access_token', token)
      localStorage.setItem('refresh_token', refresh)
      window.history.replaceState({}, '', '/')
    }

    resolveStored()
    logDiag('boot', {
      branch: token && refresh ? 'token' : 'stored',
      session: !!localStorage.getItem('access_token'),
    })
  }, [])

  return { session, setSession, authLoading }
}

import axios from 'axios'

const api = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL || '',
})

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('access_token')
  if (token) {
    config.headers.Authorization = `Bearer ${token}`
  }
  return config
})

function logoutRedirect() {
  localStorage.removeItem('access_token')
  localStorage.removeItem('refresh_token')
  // replace — 만료 시점 딥링크 엔트리를 남기지 않는다(재로그인 후 뒤로가기 재진입 차단)
  window.location.replace('/')
}

// eco: 모듈 레벨 단일비행 in-flight promise — 동시에 여러 요청이 401을 맞아도
// /api/auth/refresh는 1회만 나간다. 성공·실패 무관하게 finally에서 비운다.
let refreshInFlight = null

function refreshTokens() {
  if (!refreshInFlight) {
    refreshInFlight = (async () => {
      const refreshToken = localStorage.getItem('refresh_token')
      if (!refreshToken) return null
      // 타임아웃 — 응답이 무기한 pending이면 refreshInFlight가 영영 안 비워져 이후의
      // 모든 401이 이 promise를 영원히 기다린다(검토 지적 MEDIUM). AbortSignal.timeout은
      // Safari 16+ 전용이라(이 앱은 구형 iOS PWA도 지원) AbortController+setTimeout으로.
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), 10_000)
      try {
        // raw fetch — api로 부르면 이 401이 인터셉터를 다시 타 재귀한다.
        const res = await fetch(`${import.meta.env.VITE_API_BASE_URL || ''}/api/auth/refresh`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ refresh_token: refreshToken }),
          signal: controller.signal,
        })
        // 이 요청이 나가 있는 동안 다른 경로(로그아웃 또는 다른 탭의 회전 — refresh_token은
        // 1회용이라 둘 다 이 토큰을 지운다)가 저장값을 이미 바꿔놨으면 이 응답으로 덮지 않는다:
        // 로그아웃이었다면 새로 발급된 토큰을 버리는 게 맞고(검토 지적 HIGH — 그대로 쓰면
        // 로그아웃이 무효화된다), 다른 탭이 먼저 회전한 거라면 그쪽이 이미 쓴 최신값을 그대로
        // 쓰는 게 맞다(검토 지적 MEDIUM/LOW — 안 그러면 그 탭이 방금 받은 새 토큰을 지운다).
        const stillCurrent = localStorage.getItem('refresh_token') === refreshToken
        if (!res.ok) return stillCurrent ? null : localStorage.getItem('access_token')
        const data = await res.json()
        if (!stillCurrent) return localStorage.getItem('access_token')
        localStorage.setItem('access_token', data.access_token)
        localStorage.setItem('refresh_token', data.refresh_token)
        return data.access_token
      } catch {
        return null
      } finally {
        clearTimeout(timer)
      }
    })().finally(() => {
      refreshInFlight = null
    })
  }
  return refreshInFlight
}

api.interceptors.response.use(
  (res) => res,
  async (err) => {
    const { config, response } = err
    if (response?.status !== 401) return Promise.reject(err)

    if (config && !config._retried && localStorage.getItem('refresh_token')) {
      config._retried = true
      const newToken = await refreshTokens()
      if (newToken) {
        // 재시도 전 헤더를 새 토큰으로 덮는다 — 옛 토큰이 박혀 있으면 재시도가 또 401이 된다.
        config.headers = { ...config.headers, Authorization: `Bearer ${newToken}` }
        return api.request(config)
      }
    }

    logoutRedirect()
    return Promise.reject(err)
  }
)

export default api

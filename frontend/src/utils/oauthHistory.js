// OAuth 히스토리 되감기 (task#252).
//
// IdP(구글·깃허브)가 자기 도메인에 push한 히스토리 엔트리는 크로스오리진이라 우리가 지울 수 없다.
// 그래서 지우는 대신 '되감는다' — OAuth를 떠나기 직전 history.length를 기록해 두고, 로그인 성공
// 랜딩에서 그 증분(delta)만큼 history.go(-delta) 해 IdP 엔트리를 히스토리의 '앞'으로 밀어낸다.
// 되감기 착지점은 로그인 화면이 떴던 우리 문서이고, 그 문서는 이제 토큰을 갖고 있으므로 재평가되면
// 앱을 렌더한다(라이브 `/`는 no-store라 리로드가 기본 경로 — 예외적으로 bfcache로 복원되면
// useBfcacheAuthGuard가 replace로 이어받는다).
//
// 착지점이 필요하므로 OAuth 시작은 replace가 아니라 push여야 한다(task#245 D6의 의도적 되돌림).
const KEY = 'oauth_hist_len'

// history.length는 50에서 캡되므로 오래 쓴 탭에서는 기준값이 밀려 delta가 음수·과대가 될 수 있다.
// 그때는 되감기를 포기하고 기존 동작(replace('/'))으로 폴백한다 — 회귀가 아니라 현상 유지다.
const MAX_REWIND = 20

// OAuth로 떠나기 직전 호출. sessionStorage는 오리진·탭별이라 IdP 우회 중에도 살아남는다.
export function markOAuthStart() {
  sessionStorage.setItem(KEY, String(window.history.length))
}

// 로그인 성공 랜딩에서 호출. 기준값은 어느 분기에서도 제거한다 — 남기면 다음 일반 로드가
// stale 기준으로 되감을 수 있다.
export function returnFromOAuth() {
  const base = Number(sessionStorage.getItem(KEY) || 0)
  sessionStorage.removeItem(KEY)
  const delta = base > 0 ? window.history.length - base : 0
  if (delta > 0 && delta <= MAX_REWIND) window.history.go(-delta)
  else window.location.replace('/')
}

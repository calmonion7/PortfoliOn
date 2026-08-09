// OAuth 히스토리 되감기 (task#252).
//
// IdP(구글·깃허브)가 자기 도메인에 push한 히스토리 엔트리는 크로스오리진이라 우리가 지울 수 없다.
// 그래서 지우는 대신 '되감는다' — OAuth를 떠나기 직전 history.length를 기록해 두고, 로그인 성공
// 랜딩에서 그 증분(delta)만큼 history.go(-delta) 해 IdP 엔트리를 히스토리의 '앞'으로 밀어낸다.
// 되감기 착지점은 로그인 화면이 떴던 우리 문서이고, 그 문서는 이제 토큰을 갖고 있으므로 재평가되면
// 앱을 렌더한다(라이브 `/`는 no-store라 리로드가 기본 경로 — 예외적으로 bfcache로 복원되면
// useBfcacheAuthGuard가 같은 문서 안에서 세션 상태를 뒤집어 이어받는다. 예전엔 그 가드가
// replace('/')로 문서를 다시 불렀는데, 그 리로드 시간 내내 복원된 로그인 화면이 보였다 — task#283).
//
// 착지점이 필요하므로 OAuth 시작은 replace가 아니라 push여야 한다(task#245 D6의 의도적 되돌림).
import { logDiag } from './diag'
import { REDIRECTS } from '../routes'

const KEY = 'oauth_hist_len'

// history.length는 50에서 캡되므로 오래 쓴 탭에서는 기준값이 밀려 delta가 음수·과대가 될 수 있다.
// 그때는 되감기를 포기하고 기존 동작(replace('/'))으로 폴백한다 — 회귀가 아니라 현상 유지다.
const MAX_REWIND = 20

// 되감기 착지 슬롯 URL. '/'의 리다이렉트 목적지(REDIRECTS 파생, 현재 '/reports')로 곧장 pushState해
// 두면 가드가 세션을 뒤집을 때 BrowserRouter가 처음부터 그 경로에 서 있어 '/'→'/reports' 리다이렉트와
// 그에 딸린 key={pathname} 재마운트(페이드 재생 + 데이터 2회 fetch)가 사라진다(task#283 적대적 리뷰 MED).
const LANDING = REDIRECTS.find(([from]) => from === '/')?.[1] || '/'

// OAuth로 떠나기 직전 호출. sessionStorage는 오리진·탭별이라 IdP 우회 중에도 살아남는다.
//
// 부작용(그릴링에서 명시 수용, task#285): 이 pushState가 '/' 중복 엔트리 1개를 착지 슬롯 뒤에
// 남긴다 — 로그인 완료 후 뒤로가기 1회는 같은 문서 안 재리다이렉트라 사실상 무동작이 된다.
// useBfcacheAuthGuard가 이미 forward 엔트리를 1개 남기고 있어(task#283) 같은 등급의 부작용이다.
export function markOAuthStart() {
  const before = window.history.length
  // 기록 전에 forward 잡음을 잘라낸다 — pushState 직후의 length는 항상 '현재 인덱스+1'이라
  // 클릭 시점에 forward 엔트리가 몇 개였든 기준값이 정확해진다. 이 순서가 틀려(길이를 먼저
  // 읽고 그 다음 location.href로 이동) forward 잡음 J개가 있으면 delta가 J만큼 과소해져
  // /api/auth/oauth/google(302만 뱉는 엔드포인트)에 착지하던 게 이번 결함이었다(task#285).
  window.history.pushState({}, '', LANDING)
  const base = window.history.length
  sessionStorage.setItem(KEY, String(base))
  logDiag('oauth-start', { base, junk: before - (base - 1) })
}

// 로그인 성공 랜딩에서 호출. 기준값은 어느 분기에서도 제거한다 — 남기면 다음 일반 로드가
// stale 기준으로 되감을 수 있다.
export function returnFromOAuth() {
  const base = Number(sessionStorage.getItem(KEY) || 0)
  sessionStorage.removeItem(KEY)
  const len = window.history.length
  const delta = base > 0 ? len - base : 0
  const path = delta > 0 && delta <= MAX_REWIND ? 'go' : 'replace'
  // 호출 직전에 기록한다 — 호출 후엔 이 문서가 떠나 기록이 유실될 수 있다.
  logDiag('rewind', { base, len, delta, path })
  if (path === 'go') window.history.go(-delta)
  else window.location.replace('/')
}

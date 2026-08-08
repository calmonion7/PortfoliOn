import { useEffect } from 'react'
import { flushSync } from 'react-dom'

// bfcache 복원 가드.
// 뒤로가기로 되살아난 문서는 JS가 재실행되지 않아 복원 시점의 DOM을 그대로 보여준다.
// 그래서 토큰 유무와 복원된 화면의 로그인 상태가 어긋날 수 있다 — 양방향 모두:
//   · 로그인 후 뒤로가기 → 로그인 화면 DOM이 복원(토큰은 있음)
//   · 로그아웃 후 뒤로가기 → 로그인된 앱 화면이 복원(토큰은 없음)
// 어긋날 때만 개입한다(일치하면 무동작 — 외부 링크 왕복 복귀에서 불필요한 개입을 만들지 않는다).
//
// task#283 — 개입 수단을 `location.replace('/')`(전체 리로드)에서 **같은 문서 안의 상태 뒤집기**로
// 바꿨다([[ADR-0035]]). 이유: OAuth 되감기(task#252)의 착지점이 곧 로그인 화면 문서라,
// 그 문서가 bfcache에서 복원되면 로그인 DOM이 칠해진 채 **리로드가 끝날 때까지 노출**됐다
// (안드로이드 크롬 실관측 — "구글 로그인 후 로그인 화면이 보였다가 리포트로 넘어감").
//
// 로그인 방향에서만 pushState+back을 쓰는 이유:
//   · 지금까지 forward 엔트리(OAuth 직후엔 IdP 것들)가 잘리던 건 `location.replace()`의
//     **부수효과**였다. 리로드를 없애면 그 pruning을 명시적으로 되살려야 한다 — pushState가
//     현재 위치 이후의 forward를 잘라낸다(구 코드와 같은 범위이지 넓어진 것이 아니다).
//   · 그 다음 back()이 없으면 낡은 로그인 엔트리가 뒤에 남아 뒤로가기가 no-op이 된다
//     (= task#245가 비목표로 기각한 '뒤로가기 트랩'). 되돌아와야 뒤로가기가 로그인 이전으로 이탈한다.
//   · 로그아웃 방향엔 자를 IdP 엔트리가 없으므로 상태만 비운다.
//
// ⚠️ 상태 뒤집기를 back()의 popstate **뒤로 미루는** 이유(적대적 리뷰가 잡은 회귀):
// back()은 호출만 동기이고 실제 이동은 비동기다. 먼저 뒤집으면 BrowserRouter가 마운트된 *뒤*에
// popstate가 도착해 '/' → '/reports' 리다이렉트가 한 번 더 돌고, AppShell의 key={pathname}이
// 페이지를 통째로 재마운트한다(페이드 재생 + 데이터 2회 fetch). 잔상을 없애러 온 변경이
// 다른 깜빡임을 만드는 셈이라, popstate가 착지한 뒤에 뒤집어 Router가 처음부터 최종 위치에 선다.
//
// 하한 2가지(알고 받아들인 것):
//   · 브라우저는 복원 DOM을 칠한 **뒤** pageshow를 쏘므로 로그인 화면 1프레임은 JS로 제거 불가다.
//     flushSync는 그 잔상이 2~3프레임으로 늘어나는 걸 막는 장치이지 0으로 만드는 장치가 아니다.
//   · popstate가 오지 않는 브라우저/상황이면 300ms 안전망이 대신 뒤집는다 — 재마운트 한 번이
//     토큰을 쥔 채 로그인 화면에 갇히는 것보다 낫다.
export default function useBfcacheAuthGuard(isLoggedIn, resolveSession) {
  useEffect(() => {
    const onPageShow = (e) => {
      if (!e.persisted) return
      const token = localStorage.getItem('access_token')
      if (!!token === !!isLoggedIn) return
      const flip = () => flushSync(() => resolveSession(token ? { access_token: token } : null))
      if (!token) { flip(); return }

      let timer
      const flipOnce = () => {
        window.removeEventListener('popstate', flipOnce)
        clearTimeout(timer)
        flip()
      }
      window.addEventListener('popstate', flipOnce)
      window.history.pushState({}, '', window.location.href)
      window.history.back()
      timer = setTimeout(flipOnce, 300)
    }
    window.addEventListener('pageshow', onPageShow)
    return () => window.removeEventListener('pageshow', onPageShow)
  }, [isLoggedIn, resolveSession])
}

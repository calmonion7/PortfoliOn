import { useEffect } from 'react'

// bfcache 복원 가드.
// 뒤로가기로 되살아난 문서는 JS가 재실행되지 않아 복원 시점의 DOM을 그대로 보여준다.
// 그래서 토큰 유무와 복원된 화면의 로그인 상태가 어긋날 수 있다 — 양방향 모두:
//   · 로그인 후 뒤로가기 → 로그인 화면 DOM이 복원(토큰은 있음)
//   · 로그아웃 후 뒤로가기 → 로그인된 앱 화면이 복원(토큰은 없음)
// 어긋날 때만 '/'로 replace 해 문서를 다시 평가시킨다(일치하면 무동작 — 외부 링크 왕복
// 복귀에서 불필요한 리로드를 만들지 않는다).
export default function useBfcacheAuthGuard(isLoggedIn) {
  useEffect(() => {
    const onPageShow = (e) => {
      if (!e.persisted) return
      const hasToken = !!localStorage.getItem('access_token')
      if (hasToken !== !!isLoggedIn) window.location.replace('/')
    }
    window.addEventListener('pageshow', onPageShow)
    return () => window.removeEventListener('pageshow', onPageShow)
  }, [isLoggedIn])
}

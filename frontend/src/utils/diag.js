// task#284 진단 계측 — 콜드 스타트 첫 구글 로그인 잔상의 원인(bfcache 복원 vs 문서 재요청)을
// 실측으로 가르기 위한 링버퍼 로거. 계측이 앱을 죽이면 안 되므로 모든 함수는 예외를 삼킨다
// (사파리 프라이빗 모드·쿼터 초과 등 localStorage 예외 대비).
const KEY = 'diag_log'
const MAX = 50

export function logDiag(ev, data) {
  try {
    const list = readDiag()
    list.push({ ev, t: Date.now(), rel: Math.round(performance.now()), ...data })
    while (list.length > MAX) list.shift()
    localStorage.setItem(KEY, JSON.stringify(list))
  } catch {
    // no-op — 계측 실패가 앱 동작을 막지 않는다.
  }
}

export function readDiag() {
  try {
    const raw = localStorage.getItem(KEY)
    const parsed = raw ? JSON.parse(raw) : []
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

export function clearDiag() {
  try {
    localStorage.removeItem(KEY)
  } catch {
    // no-op
  }
}

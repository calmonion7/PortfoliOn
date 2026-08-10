// api-cache 삭제 (ADR-0036) — SW 런타임 캐시 규칙 제거만으로는 이미 기기에 저장된
// api-cache 저장소가 남는다(Workbox cleanupOutdatedCaches는 precache만 다룬다). caches 부재
// (jsdom 등)·delete 거절 모두 던지지 않는다 — 부팅도 로그아웃도 막으면 안 된다. 'api-cache'
// 한 키만 지운다 — google-fonts·cdn-fonts·precache는 건드리지 않는다.
// 호출 지점 2곳: main.jsx(부팅 1회) + App.jsx::doLogout. 후자가 필요한 이유는 doLogout이
// SPA 전용(리로드 없음)이라 "A 로그아웃 → 같은 문서에서 B 로그인"이 부팅을 재실행하지 않기
// 때문 — 그게 B47의 문서화된 주 도달 경로다(옛 SW가 살아 있는 전환 창 한정, ADR-0036 결과절).
// 거절은 삼키되 침묵하지 않는다: 이 삭제가 전환 창의 유일한 방어선이라 실패가 관측 가능해야
// 한다(로깅 규약 §4 — console.warn = graceful).
export async function purgeApiCache() {
  if (typeof caches === 'undefined') return
  try {
    await caches.delete('api-cache')
  } catch (e) {
    console.warn('[apiCachePurge] api-cache 삭제 실패 (계속 진행):', e)
  }
}

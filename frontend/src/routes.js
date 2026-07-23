// 구 URL → 신규 라우트 리다이렉트 맵(ADR-0025) — App.jsx와 route-redirects 테스트가 공유(task#M4)
export const REDIRECTS = [
  ['/', '/reports'],
  ['/research', '/reports'],
  ['/market', '/market/indicators'],
  ['/analysis', '/portfolio'],
]

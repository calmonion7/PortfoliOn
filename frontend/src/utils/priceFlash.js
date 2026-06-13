// 가격 변동 플래시의 방향 판정 — 순수 함수.
// 직전 표시값(prev) 대비 새 표시값(next)이 오르면 'up', 내리면 'down', 같거나 판정 불가면 null.
// 트레이딩 터미널의 tick 플래시 의미(당일 부호가 아니라 "방금 무슨 일이 일어났나").
export function flashDirection(prev, next) {
  if (typeof prev !== 'number' || typeof next !== 'number') return null
  if (Number.isNaN(prev) || Number.isNaN(next)) return null
  if (next > prev) return 'up'
  if (next < prev) return 'down'
  return null
}

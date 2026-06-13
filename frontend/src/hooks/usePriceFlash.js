import { useEffect, useRef, useState } from 'react'
import { flashDirection } from '../utils/priceFlash'

// 표시값(value)이 라이브 폴링 틱(tick) 때문에 직전과 달라지면 방향('up'|'down')을 잠깐 반환하고
// ~0.75s 뒤 null로 클리어한다. tick이 그대로인 재렌더(초기 로드·fx 정착·수동 새로고침)에선
// 발화하지 않는다 → "라이브 폴링 틱에만 깜빡임".
// 반환: null | { dir, id } — id는 연속 변동 시 CSS 애니메이션을 재발화시키는 key.
export default function usePriceFlash(value, tick) {
  const prevValue = useRef(value)
  const prevTick = useRef(tick)
  const timer = useRef(null)
  const [flash, setFlash] = useState(null)

  useEffect(() => {
    const pv = prevValue.current
    const pt = prevTick.current
    prevValue.current = value
    prevTick.current = tick
    if (tick === pt) return // 폴링 틱이 아니면 무발화 (로드·fx·재조회 제외)
    const dir = flashDirection(pv, value)
    if (!dir) return
    setFlash((f) => ({ dir, id: (f?.id ?? 0) + 1 }))
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => setFlash(null), 750)
  }, [value, tick])

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current) }, [])

  return flash
}

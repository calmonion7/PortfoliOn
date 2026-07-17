import { useEffect, useRef, useState } from 'react'

// 값이 처음 유효한 숫자로 도착했을 때만 0→값 1회 rAF 보간, 이후 값 변경은 즉시 반영.
// reduced-motion이면 항상 즉시. 반환은 표시용 숫자.
export default function useCountUp(value, { duration = 800 } = {}) {
  const [display, setDisplay] = useState(value)
  const animatedOnce = useRef(false)
  const rafId = useRef(null)

  useEffect(() => {
    if (typeof value !== 'number' || Number.isNaN(value)) {
      setDisplay(value)
      return
    }

    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (animatedOnce.current || reduced) {
      animatedOnce.current = true
      setDisplay(value)
      return
    }
    // eco: 플래그를 애니메이션 시작 시점에 바로 세움 — StrictMode(dev) 이중 mount에서
    // 첫 mount가 즉시 cleanup되면 그 mount분 애니메이션은 스킵될 수 있으나(dev만),
    // 프로덕션 단일 mount에서는 정상적으로 1회 보간된다.
    animatedOnce.current = true
    const startTime = performance.now()

    const tick = (now) => {
      const progress = Math.min((now - startTime) / duration, 1)
      setDisplay(value * progress)
      if (progress < 1) {
        rafId.current = requestAnimationFrame(tick)
      }
    }
    rafId.current = requestAnimationFrame(tick)

    return () => {
      if (rafId.current) cancelAnimationFrame(rafId.current)
    }
  }, [value, duration])

  return display
}

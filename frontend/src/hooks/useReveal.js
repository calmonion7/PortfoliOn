import { useEffect, useRef } from 'react'

// 뷰포트 진입 시 1회성으로 'is-visible' 클래스를 부여(motion.css .reveal과 짝) 후 observer 해제.
// reduced-motion이면 애니메이션 없이 즉시 부여. ref를 대상 엘리먼트에 걸어 쓴다.
export default function useReveal() {
  const ref = useRef(null)

  useEffect(() => {
    const el = ref.current
    if (!el) return

    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      el.classList.add('is-visible')
      return
    }

    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) {
        el.classList.add('is-visible')
        observer.disconnect()
      }
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  return ref
}

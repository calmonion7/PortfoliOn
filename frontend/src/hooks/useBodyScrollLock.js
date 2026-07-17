import { useEffect } from 'react'

// 모달 열림 중 배경(body) 스크롤 잠금 — active 동안 overflow:hidden, 해제 시 복원 (task#196)
// eco: 동시 모달 중첩은 없다는 전제의 단순 복원 — 중첩 모달이 생기면 카운터 방식으로 승급
export default function useBodyScrollLock(active = true) {
  useEffect(() => {
    if (!active) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = prev }
  }, [active])
}

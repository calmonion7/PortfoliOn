import { useState, useEffect, useRef } from 'react'

/**
 * scroll-spy — 지금 보고 있는 **장**(chapter)을 돌려준다 (task#321 S2).
 *
 * `useReveal`을 재사용할 수 없다: 그것은 첫 교차에서 `disconnect`하는 1회성 훅이라 계속 따라다니지
 * 못한다.
 *
 * ⚠️ **판정을 「지금 교차 중인 섹션」으로 두지 않는다.** 그게 scroll-spy의 고전적 결함이다 —
 *    마지막 장(근거 = 상세 설명·출처)이 짧으면 관찰 임계에 못 들어 하이라이트가 앞 장에 머문다.
 *    대신 **「상단 경계를 마지막으로 지난 섹션」**으로 판정한다: 각 섹션의 `top`이 경계선
 *    (크롬 + 바 아래)보다 위에 있으면 「지났다」로 보고, 지난 것 중 **가장 마지막**을 활성으로 삼는다.
 *    그래서 문서 끝에서는 마지막 섹션이 자연히 활성이 된다(별도 보정 분기가 필요 없다).
 *
 * ⚠️ **깜빡임(flash)** — 경계에서 IO가 진동하면 활성 칩이 떨린다. IO는 「다시 계산할 때」를
 *    알리는 트리거로만 쓰고 판정은 그때마다 **전 섹션의 좌표를 한 번에 읽어** 내리므로, 한 섹션의
 *    진동이 활성값을 바꾸지 않는다(진동하는 섹션이 경계 위/아래를 오갈 때만 바뀌고 그건 정당하다).
 *    잔여 떨림은 `HYSTERESIS`가 흡수한다. 좌표 스냅샷 축은 이것을 원리적으로 못 보므로 육안 확인이
 *    DoD에 남아 있다.
 *
 * @param {Array<{chapter: string, targetId: string}>} items 장별 첫 표시 섹션(빈 배열이면 비활성)
 * @param {number} offset 상단 경계 — sticky 크롬 높이 + 바 높이
 * @returns {string|null} 활성 장 key
 */
const HYSTERESIS = 4   // px — 경계 바로 위/아래 진동을 흡수한다

export default function useActiveChapter(items, offset) {
  const [active, setActive] = useState(null)
  // 최신 값을 IO 콜백이 보게 한다 — 의존성에 넣어 observer를 매번 재생성하면 스크롤 중에 끊긴다.
  const ref = useRef({ items, offset })
  ref.current = { items, offset }

  useEffect(() => {
    if (!Array.isArray(items) || items.length === 0) { setActive(null); return }
    if (typeof IntersectionObserver === 'undefined') return

    const compute = () => {
      const { items: its, offset: off } = ref.current
      const line = (off || 0) + HYSTERESIS
      let hit = null
      for (const it of its) {
        const el = document.getElementById(it.targetId)
        if (!el) continue
        // 이 섹션의 시작이 경계선 위로 올라갔는가 = 「지났다」
        if (el.getBoundingClientRect().top <= line) hit = it.chapter
      }
      // 아무 섹션도 아직 경계를 지나지 않았다면(문서 최상단) 첫 장을 활성으로 둔다 —
      // null을 두면 바가 뜨는 순간 하이라이트 없는 프레임이 한 번 보인다.
      setActive(hit || (its[0] ? its[0].chapter : null))
    }

    const io = new IntersectionObserver(compute, {
      // 상단 경계를 offset만큼 끌어내려 크롬·바에 가린 부분을 정의역에서 뺀다.
      rootMargin: `-${Math.max(0, Math.round(offset || 0))}px 0px 0px 0px`,
      threshold: [0, 0.01, 1],
    })
    const observed = []
    for (const it of items) {
      const el = document.getElementById(it.targetId)
      if (el) { io.observe(el); observed.push(el) }
    }
    // IO는 「다시 계산할 때」만 알린다 — 마지막 장이 짧아 임계에 못 드는 경우를 위해 스크롤에도
    // 얹는다(passive). 둘 다 같은 `compute`를 부르므로 판정 경로는 하나다.
    window.addEventListener('scroll', compute, { passive: true })
    window.addEventListener('resize', compute, { passive: true })
    compute()

    return () => {
      io.disconnect()
      window.removeEventListener('scroll', compute)
      window.removeEventListener('resize', compute)
    }
    // items의 *내용*이 바뀔 때만 재구독한다(배열 identity는 매 렌더 바뀐다).
  }, [items.map((i) => `${i.chapter}:${i.targetId}`).join('|'), offset])   // eslint-disable-line react-hooks/exhaustive-deps

  return active
}

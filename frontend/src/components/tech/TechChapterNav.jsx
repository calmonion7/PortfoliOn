import { useRef, useState, useEffect } from 'react'
import useActiveChapter from '../../hooks/useActiveChapter'
import './TechChapterNav.css'

/**
 * 4장 플로팅 항해 바 (task#321 · ADR-0045 보정).
 *
 * 정적 목차가 화면 밖으로 나가면 뜨고, **지금 보고 있는 장**을 하이라이트한다.
 *
 * ⚠️ **정적 목차를 `sticky`로 만들지 않았다** — 이건 `position: fixed`인 **별도 요소**다. 그래야
 *    정적 레이아웃이 한 px도 안 움직이고, 그것이 기록된 결정 1(KPI 스트립이 첫 화면 안 —
 *    `uat280 kpi-visible`이 감시)과 2(목차는 KPI 스트립 아래)를 **원리적으로** 건드리지 않는 유일한
 *    이유다. `sticky`로 바꾸면 그 둘이 동시에 위험해진다.
 *
 * ⚠️ 칩은 **11개가 아니라 4장**이다. 11칩은 어느 뷰포트에서도 1줄에 안 들어간다
 *    (실측 목차 높이 m278 244 · m390 160 · m768/pc 76 = 6·4·2줄).
 *    ⚠️ 단 **4칩도 m278에서는 1줄이 아니다** — 실측 폭합 272px(칩 46·73·83·46 + gap 24) >
 *    가용 238px이라 2줄이 된다. 계획서의 「225 ≤ 246이므로 1줄 확정」은 **거짓**이었다(2026-08-21 실측).
 *    m350 이상(가용 310+)에서는 1줄이다. 라벨을 줄여 m278에 맞출 수도 있지만 그러면 바 칩과 본문 장
 *    라벨이 **다른 말**을 하게 되므로(ADR-0045가 고정한 4장 이름) 2줄을 감수한다.
 *
 * ⚠️ **조건부 렌더**다(`visibility` 토글이 아니다) — 숨은 상태에서 탭 포커스가 잡히는 접근성 결함을
 *    만들지 않기 위해서다.
 */
export default function TechChapterNav({ items, visible }) {
  const barRef = useRef(null)
  // scroll-spy의 상단 경계 = **sticky 크롬 bottom + 이 바의 높이**. 둘 다 뷰포트에 따라 다르고
  // (크롬 53/80 · 바 1줄 46 / m278 2줄 88) 바 높이는 렌더 후에만 알 수 있으므로 **실측**한다 —
  // CSS 상수로 박으면 m278의 2줄에서 어긋난다(그리고 계획의 숫자는 이미 한 번 틀렸다).
  const [offset, setOffset] = useState(0)
  useEffect(() => {
    if (!visible) return undefined
    const measure = () => {
      const chrome = [...document.querySelectorAll('.mobile-header, .masthead-sticky')]
        .filter((e) => getComputedStyle(e).display !== 'none')
      const cb = chrome.length ? Math.max(...chrome.map((e) => Math.round(e.getBoundingClientRect().bottom))) : 0
      const bh = barRef.current ? Math.round(barRef.current.getBoundingClientRect().height) : 0
      setOffset(cb + bh)
    }
    measure()
    window.addEventListener('resize', measure, { passive: true })
    return () => window.removeEventListener('resize', measure)
  }, [visible])

  const active = useActiveChapter(visible ? items : [], offset)
  if (!visible || !Array.isArray(items) || items.length === 0) return null
  return (
    <nav ref={barRef} className="toc-float" data-tech-chapter-nav="" aria-label="장 항해">
      {items.map((it) => (
        <a key={it.chapter} href={`#${it.targetId}`}
           className={`toc-float__chip mono${active === it.chapter ? ' is-active' : ''}`}
           data-tech-chapter-nav-chip="" data-chapter={it.chapter}
           data-active={active === it.chapter ? 'true' : 'false'}
           aria-current={active === it.chapter ? 'true' : undefined}>
          {it.label}
        </a>
      ))}
    </nav>
  )
}

// 주식 용어집 UI (task#198) — 앵커 팝오버 + 텍스트 자동 매칭 + recharts 범례 어댑터.
// 팝오버는 body 포털 + fixed 좌표(뷰포트 기준)라 중첩 스크롤/모달(z:1000) 안에서도 안전.
// body 스크롤 락 없음(스크롤 시 닫힘), 등장 모션은 opacity 전용(transform 금지 — task#195 규칙).
import { useState, useRef, useEffect, useLayoutEffect, useMemo, Fragment } from 'react'
import { createPortal } from 'react-dom'
import { findTerm } from '../glossary/terms'
import { matchTerms } from '../glossary/match'
import './Glossary.css'

function GlossaryPopover({ anchorEl, entry, onClose }) {
  const ref = useRef(null)
  const [pos, setPos] = useState(null)

  useLayoutEffect(() => {
    const el = ref.current
    if (!el || !anchorEl.current) return
    const rect = anchorEl.current.getBoundingClientRect()
    const W = Math.min(300, window.innerWidth - 16)
    const h = el.offsetHeight
    const below = rect.bottom + 6 + h <= window.innerHeight - 8
    const top = below ? rect.bottom + 6 : Math.max(8, rect.top - 6 - h)
    const left = Math.min(Math.max(8, rect.left), window.innerWidth - W - 8)
    setPos({ top, left, width: W })
  }, [anchorEl])

  useEffect(() => {
    const onPointer = (e) => {
      if (ref.current?.contains(e.target)) return
      if (anchorEl.current?.contains(e.target)) return // 앵커 클릭은 토글이 처리
      onClose()
    }
    const onKey = (e) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('pointerdown', onPointer, true)
    window.addEventListener('scroll', onClose, true)
    window.addEventListener('resize', onClose)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onPointer, true)
      window.removeEventListener('scroll', onClose, true)
      window.removeEventListener('resize', onClose)
      document.removeEventListener('keydown', onKey)
    }
  }, [anchorEl, onClose])

  return createPortal(
    <div
      ref={ref}
      className="glossary-popover"
      role="tooltip"
      style={pos ? { top: pos.top, left: pos.left, width: pos.width } : { top: 0, left: 0, width: Math.min(300, window.innerWidth - 16), visibility: 'hidden' }}
    >
      <div className="glossary-popover-term">{entry.term}</div>
      <div className="glossary-popover-def">{entry.def}</div>
    </div>,
    document.body,
  )
}

// 단일 용어 클릭 지점. entry 직접 전달 또는 term 키로 조회. 용어집에 없으면 평문 렌더.
export function GlossaryTerm({ term, entry: entryProp, children }) {
  const entry = entryProp || findTerm(term)
  const [open, setOpen] = useState(false)
  const btnRef = useRef(null)
  if (!entry) return children ?? term ?? null
  return (
    <>
      <button
        ref={btnRef}
        type="button"
        className="glossary-term"
        aria-expanded={open}
        onClick={() => setOpen(o => !o)}
      >
        {children ?? entry.term}
      </button>
      {open && <GlossaryPopover anchorEl={btnRef} entry={entry} onClose={() => setOpen(false)} />}
    </>
  )
}

// 자유 텍스트 자동 매칭 — 용어집 단어를 찾아 GlossaryTerm으로 감싼 인라인 노드 반환.
export function GlossaryText({ text }) {
  const segs = useMemo(() => matchTerms(text), [text])
  if (!segs.some(s => s.entry)) return text ?? null
  return segs.map((s, i) =>
    s.entry
      ? <GlossaryTerm key={i} entry={s.entry}>{s.text}</GlossaryTerm>
      : <Fragment key={i}>{s.text}</Fragment>
  )
}

// recharts <Legend content={<GlossaryRechartsLegend />} /> 어댑터 — 범례 라벨에 용어 매칭 적용.
export function GlossaryRechartsLegend({ payload }) {
  if (!payload?.length) return null
  return (
    <div className="glossary-legend">
      {payload.map((p, i) => (
        <span key={i} className="glossary-legend-item">
          <span className="glossary-legend-swatch" style={{ background: p.color }} />
          <GlossaryText text={String(p.value)} />
        </span>
      ))}
    </div>
  )
}

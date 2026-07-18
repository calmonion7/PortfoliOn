// 용어 자동 매칭 순수 함수 (task#198)
// 규칙: longest-match 우선 · 텍스트당 용어별 첫 등장만 · 이미 매칭된 구간과 중복 금지.
// 라틴 키(PER 등)는 영숫자 경계 필수(SUPER의 PER 오매칭 방지), 한글 키는 substring(조사 자연 흡수).
import { GLOSSARY } from './terms'

const _escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

const _KEYS = GLOSSARY
  .flatMap(entry => [entry.term, ...(entry.aliases || [])].map(key => ({
    key,
    entry,
    latin: /^[\x20-\x7E]+$/.test(key),
  })))
  .sort((a, b) => b.key.length - a.key.length)

function _overlaps(claimed, s, e) {
  return claimed.some(([cs, ce]) => s < ce && e > cs)
}

// text → [{ text, entry? }] 세그먼트 배열. 매칭 없으면 단일 세그먼트.
export function matchTerms(text) {
  if (!text || typeof text !== 'string') return [{ text: text || '' }]
  const claimed = []
  const found = []
  const usedEntries = new Set()
  for (const { key, entry, latin } of _KEYS) {
    if (usedEntries.has(entry)) continue
    let from = 0
    while (from < text.length) {
      const s = text.indexOf(key, from)
      if (s === -1) break
      const e = s + key.length
      const boundaryOk = !latin || (
        !/[A-Za-z0-9]/.test(text[s - 1] || '') && !/[A-Za-z0-9]/.test(text[e] || '')
      )
      if (boundaryOk && !_overlaps(claimed, s, e)) {
        claimed.push([s, e])
        found.push({ start: s, end: e, entry })
        usedEntries.add(entry)
        break
      }
      from = s + 1
    }
  }
  if (found.length === 0) return [{ text }]
  found.sort((a, b) => a.start - b.start)
  const segs = []
  let cursor = 0
  for (const { start, end, entry } of found) {
    if (start > cursor) segs.push({ text: text.slice(cursor, start) })
    segs.push({ text: text.slice(start, end), entry })
    cursor = end
  }
  if (cursor < text.length) segs.push({ text: text.slice(cursor) })
  return segs
}

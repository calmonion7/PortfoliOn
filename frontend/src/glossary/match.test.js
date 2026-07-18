import { describe, it, expect } from 'vitest'
import { matchTerms } from './match'
import { GLOSSARY, findTerm } from './terms'

const joined = (segs) => segs.map(s => s.text).join('')
const matched = (segs) => segs.filter(s => s.entry).map(s => s.text)

describe('matchTerms', () => {
  it('용어 없는 텍스트는 단일 세그먼트', () => {
    const segs = matchTerms('오늘 날씨가 좋다')
    expect(segs).toEqual([{ text: '오늘 날씨가 좋다' }])
  })

  it('빈/비문자열 입력 graceful', () => {
    expect(matchTerms('')).toEqual([{ text: '' }])
    expect(matchTerms(null)).toEqual([{ text: '' }])
  })

  it('세그먼트를 이어붙이면 원문 보존', () => {
    const text = '공매도 비중이 급증했고 PER은 10배로 저평가, 매물대 상단이 저항선이다.'
    expect(joined(matchTerms(text))).toBe(text)
  })

  it('longest-match 우선 — 공매도 비중은 공매도가 아니라 공매도 비중으로', () => {
    const segs = matchTerms('공매도 비중이 급증했다')
    expect(matched(segs)).toContain('공매도 비중')
  })

  it('한글 조사 흡수 — 매물대가 → 매물대 매칭', () => {
    const segs = matchTerms('매물대가 두텁다')
    expect(matched(segs)).toEqual(['매물대'])
  })

  it('라틴 키는 영숫자 경계 필수 — SUPER의 PER 오매칭 금지', () => {
    expect(matched(matchTerms('SUPER 성장주'))).toEqual([])
    expect(matched(matchTerms('PER 10배'))).toEqual(['PER'])
    expect(matched(matchTerms('PER은 낮다'))).toEqual(['PER'])
  })

  it('용어별 첫 등장만 — 같은 용어 2회 등장 시 1회만 매칭', () => {
    const segs = matchTerms('배당을 늘렸다. 배당 성향도 높다')
    expect(matched(segs)).toEqual(['배당'])
  })

  it('alias는 대표 항목으로 — 평균목표가 → 목표가 entry', () => {
    const segs = matchTerms('평균목표가 대비 상승여력')
    const hit = segs.find(s => s.entry)
    expect(hit.text).toBe('평균목표가')
    expect(hit.entry.term).toBe('목표가')
  })

  it('alias와 대표 표기가 함께 나와도 entry당 1회', () => {
    const segs = matchTerms('경제적 해자가 넓다. 해자의 원천은 브랜드다.')
    expect(matched(segs)).toEqual(['경제적 해자'])
  })
})

describe('GLOSSARY 데이터', () => {
  it('50개 이상, term/def 필수', () => {
    expect(GLOSSARY.length).toBeGreaterThanOrEqual(50)
    for (const e of GLOSSARY) {
      expect(e.term).toBeTruthy()
      expect(e.def).toBeTruthy()
    }
  })

  it('키(대표+alias) 중복 없음', () => {
    const keys = GLOSSARY.flatMap(e => [e.term, ...(e.aliases || [])])
    expect(new Set(keys).size).toBe(keys.length)
  })

  it('findTerm은 대표 표기·alias 둘 다 조회', () => {
    expect(findTerm('POC')).toBeTruthy()
    expect(findTerm('평균목표가').term).toBe('목표가')
    expect(findTerm('없는용어')).toBeUndefined()
  })
})

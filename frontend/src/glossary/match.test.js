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

  it('라틴 키는 앞쪽 영숫자 경계 필수 — SUPER의 PER 오매칭 금지', () => {
    expect(matched(matchTerms('SUPER 성장주'))).toEqual([])
    expect(matched(matchTerms('PER 10배'))).toEqual(['PER'])
    expect(matched(matchTerms('PER은 낮다'))).toEqual(['PER'])
  })

  it('라틴 키 뒤에 붙은 숫자는 표기의 일부 — EMA200 전체가 한 용어(task#225)', () => {
    expect(matched(matchTerms('EMA200을 회복했다'))).toEqual(['EMA200'])
    expect(matched(matchTerms('EMA20 위에서 버틴다'))).toEqual(['EMA20'])
    // 뒤에 오는 letter는 여전히 금지 — 숫자 흡수 후에도 letter면 탈락
    expect(matched(matchTerms('PERSON 사업부'))).toEqual([])
    expect(matched(matchTerms('EMA200X 지표'))).toEqual([])
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

// ── 심층 리포트 어휘 (task#400) — 문장은 dev 발행물 10건(portfolion_dev, 2026-10-22)에서 그대로 뽑았다 ──
describe('심층 리포트 어휘 매칭 (task#400)', () => {
  const termOf = (text, key) => matchTerms(text).find(s => s.text === key)?.entry?.term
  const CASES = [
    // [실문장, 기대 매칭 목록]
    ['빼고 집계한 값이라 GAAP보다 높게 보인다', ['GAAP']],
    ['재무제표 재작성 또는 감사의견 문제 공시', ['재무제표 재작성', '감사의견']],
    ['분기 감가상각 4조원대가 버티고 있어', ['감가상각']],
    ['영업현금흐름 6.06억달러가 GAAP', ['영업현금흐름', 'GAAP']],
    ['차입 없이 자체 현금흐름이 시설투자와 주주환원을', ['현금흐름', '시설투자', '주주환원']],
    ['주주환원 정책은 열려 있지만 그룹', ['주주환원']],
    ['컨센서스 EPS 13.52달러에 희석주식 1.873억주를 곱한', ['컨센서스', 'EPS', '희석주식']],
    ['10-Q 2026Q2 희석 가중평균주식 187.3백만주', ['희석']],
    ['매출총이익 +12.5%가 일반관리비', ['매출총이익']],
    ['주가가 18% 더 빠졌어도 고정비 레버리지 추정은 그대로다', ['레버리지']],
    ['하이퍼스케일러가 설비투자 가이던스를 깎으면 빨강', ['설비투자', '가이던스']],
    ['비유동 고객 계약부채 128.95억달러', ['계약부채']],
    ['순현금 69.4조원에 흑자라 소진 경로가', ['순현금']],
    ['1.6억달러(6/30)이고 회사 차입금은 없다', ['차입금']],
    ['조정 EBITDA 런레이트 약 5.7억달러 대비', ['EBITDA', '런레이트']],
    // 서버 계산 라벨·게이지 변수명(LensReport VALUE_META·analyst_lenses._gauge)
    ['런웨이', ['런웨이']], ['손익분기 금리', ['손익분기 금리']], ['이자보상', ['이자보상']],
    ['이익수익률', ['이익수익률']], ['무위험 금리', ['무위험 금리']], ['배수비', ['배수비']],
    ['한계 분배율이 53.8% 이상이면 노랑', ['한계 분배율']], ['평균 분배율', ['평균 분배율']],
    ['약정 증가 배수가 1.32배를 넘으면 노랑', ['약정 증가 배수']],
  ]
  it.each(CASES)('%s', (text, want) => {
    expect(matched(matchTerms(text))).toEqual(want)
    expect(joined(matchTerms(text))).toBe(text)
  })

  it('별칭은 대표 항목으로 — 재작성·시설투자·희석주식·이자보상', () => {
    expect(termOf('재작성이 공시되면 빨강', '재작성')).toBe('재무제표 재작성')
    expect(termOf('자체 현금흐름이 시설투자와', '시설투자')).toBe('설비투자')
    expect(termOf('희석주식 1.873억주', '희석주식')).toBe('희석')
    expect(termOf('이자보상', '이자보상')).toBe('이자보상배율')
  })

  it('긴 기존 용어를 가로채지 않는다 — 잉여현금흐름·EV/EBITDA·이자보상배율', () => {
    expect(matched(matchTerms('2025년 잉여현금흐름 유입을 음의 소진으로'))).toEqual(['잉여현금흐름'])
    expect(termOf('2025년 잉여현금흐름 유입', '잉여현금흐름')).toBe('FCF')
    expect(matched(matchTerms('EV/EBITDA 14.5배'))).toEqual(['EV/EBITDA'])
    expect(matched(matchTerms('이자보상배율이 2배 아래'))).toEqual(['이자보상배율'])
    // 영업현금흐름은 현금흐름이 아니라 그 자체로
    expect(termOf('영업현금흐름 6.06억달러', '영업현금흐름')).toBe('영업현금흐름')
  })
})

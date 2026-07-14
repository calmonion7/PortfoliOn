import { describe, it, expect } from 'vitest'
import { groupCandidatesBySector } from '../pages/Compare'

describe('groupCandidatesBySector', () => {
  it('US raw와 KR 정규화 섹터를 한 그룹으로 병합하고, 개수 desc·기타 맨 뒤로 정렬한다', () => {
    const candidates = [
      { ticker: 'C', sector: 'Financial Services' }, // US raw → Financials
      { ticker: '000660', sector: 'Financials' },    // KR 정규화 → Financials (병합)
      { ticker: 'AAPL', sector: 'Technology' },
      { ticker: 'MSFT', sector: 'Technology' },
      { ticker: 'NVDA', sector: 'Technology' },
      { ticker: 'SPCX', sector: '' },                // 미보고/섹터 불명 → 기타
    ]
    const groups = groupCandidatesBySector(candidates)

    // (a) US "Financial Services" + KR "Financials" → 단일 'Financials' 그룹
    const financials = groups.find(g => g.sector === 'Financials')
    expect(financials.rows.map(r => r.ticker).sort()).toEqual(['000660', 'C'])

    // (b) 개수 desc: Technology(3) → Financials(2) → 기타(1)
    // (c) '기타'는 항상 맨 뒤
    expect(groups.map(g => g.sector)).toEqual(['Technology', 'Financials', '기타'])
  })
})

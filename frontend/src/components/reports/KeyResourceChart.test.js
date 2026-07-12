import { describe, it, expect } from 'vitest'
import { groupMetricsByUnit, isChartable, buildChartData } from './KeyResourceChart.jsx'

const S = (...pairs) => pairs.map(([period, value]) => ({ period, value }))

describe('KeyResourceChart 순수 헬퍼', () => {
  const bah = [
    { label: '직원수', unit: '명', series: S(['2025Q2', 35800], ['2026Q1', 31500]) },
    { label: '1인당 매출', unit: '천USD', series: S(['2025Q2', 334], ['2026Q1', 356]) },
    { label: '1인당 영업이익', unit: '천USD', series: S(['2025Q2', 30], ['2026Q1', 34]) },
  ]

  it('unit 그룹핑: 등장 순서 유지, 같은 unit 병합', () => {
    const g = groupMetricsByUnit(bah)
    expect(g.map(x => x.unit)).toEqual(['명', '천USD'])
    expect(g[0].indexes).toEqual([0])
    expect(g[1].indexes).toEqual([1, 2])
  })

  it('2단위그룹 + 분기≥2 → 차트 가능', () => {
    expect(isChartable(bah)).toBe(true)
  })

  it('단위그룹 ≥3 → 테이블 폴백', () => {
    const three = [...bah, { label: '가동률', unit: '%', series: S(['2025Q2', 91]) }]
    expect(isChartable(three)).toBe(false)
  })

  it('distinct 분기 <2 → 테이블 폴백', () => {
    const one = [{ label: '직원수', unit: '명', series: S(['2026Q1', 31500]) }]
    expect(isChartable(one)).toBe(false)
    expect(isChartable([])).toBe(false)
  })

  it('buildChartData: period 정렬 합집합, 결측 분기는 키 생략(gap)', () => {
    const gappy = [
      { label: 'a', unit: 'x', series: S(['2025Q4', 1], ['2025Q2', 2]) },
      { label: 'b', unit: 'x', series: S(['2025Q2', 9]) },
    ]
    const rows = buildChartData(gappy)
    expect(rows.map(r => r.period)).toEqual(['2025Q2', '2025Q4'])
    expect(rows[0]).toEqual({ period: '2025Q2', m0: 2, m1: 9 })
    expect(rows[1]).toEqual({ period: '2025Q4', m0: 1 }) // m1 없음 = gap
  })
})

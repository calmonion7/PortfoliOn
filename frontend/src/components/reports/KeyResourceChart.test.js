import { describe, it, expect } from 'vitest'
import { groupMetricsByUnit, splitMetricsForRender, buildChartData } from './KeyResourceChart.jsx'

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

  it('2단위그룹 → 전부 차트, 표 없음', () => {
    const { chartMetrics, tableMetrics } = splitMetricsForRender(bah)
    expect(chartMetrics).toHaveLength(3)
    expect(tableMetrics).toHaveLength(0)
  })

  it('3단위그룹 → 앞 2그룹 차트, 3번째 그룹 표로', () => {
    const three = [
      { label: '분기 매출', unit: '백만USD', series: S(['2025Q2', 2924], ['2025Q3', 2890]) },
      { label: '직원수', unit: '명', series: S(['2025Q2', 35800], ['2025Q3', 32500]) },
      { label: '1인당 매출', unit: '천USD', series: S(['2025Q3', 88.9], ['2025Q4', 82.9]) },
      { label: '1인당 영업이익', unit: '천USD', series: S(['2025Q3', 10], ['2025Q4', 9]) },
    ]
    const { chartMetrics, tableMetrics } = splitMetricsForRender(three)
    expect(chartMetrics.map(m => m.label)).toEqual(['분기 매출', '직원수']) // 백만USD + 명
    expect(tableMetrics.map(m => m.label)).toEqual(['1인당 매출', '1인당 영업이익']) // 천USD
  })

  it('차트 대상 distinct 분기 <2 → 전부 표로 폴백', () => {
    const one = [{ label: '직원수', unit: '명', series: S(['2026Q1', 31500]) }]
    const r = splitMetricsForRender(one)
    expect(r.chartMetrics).toHaveLength(0)
    expect(r.tableMetrics).toHaveLength(1)
    expect(splitMetricsForRender([]).chartMetrics).toHaveLength(0)
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

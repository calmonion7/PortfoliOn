import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import MarketGrowthChart, { buildGrowthSeries } from './MarketGrowthChart.jsx'

// task#277 S1 — jsdom에서 recharts는 렌더되지 않으므로(ResponsiveContainer 0크기) 단언 대상은
// SVG·틱이 아니라 캡션·CAGR 배지·빈상태 문구다(가토).
const size = (value, currency = 'USD', unit = 'bn') => ({ value, currency, unit })

const market = (over = {}) => ({
  history: [{ year: 2022, size: size(10) }, { year: 2024, size: size(12.5) }],
  forecast: [{ year: 2027, size: size(24) }, { year: 2030, size: size(30.5) }],
  cagr_pct: 12.3,
  as_of: '2026-06',
  ...over,
})

describe('MarketGrowthChart (task#277 S1)', () => {
  it('history+forecast 둘 다 있으면 → 화살표 요약 + CAGR 배지 + as_of 캡션', () => {
    render(<MarketGrowthChart market={market()} />)
    expect(screen.queryByTestId('market-growth-empty')).toBeNull()
    expect(screen.getByTestId('market-growth-caption').textContent).toMatch(/→/)
    expect(screen.getByTestId('market-growth-caption').textContent).toMatch(/기준 2026-06/)
    expect(screen.getByTestId('market-growth-cagr').textContent).toMatch(/12\.3%/)
  })

  it('history만 있으면 → 화살표 없이 현재값만 요약, 차트는 그린다', () => {
    render(<MarketGrowthChart market={market({ forecast: [] })} />)
    expect(screen.queryByTestId('market-growth-empty')).toBeNull()
    const caption = screen.getByTestId('market-growth-caption').textContent
    expect(caption).not.toMatch(/→/)
    expect(caption).toMatch(/\$12\.5B/)
  })

  it('forecast만 있으면 → 화살표 없이 예상값만 요약, 차트는 그린다', () => {
    render(<MarketGrowthChart market={market({ history: [] })} />)
    expect(screen.queryByTestId('market-growth-empty')).toBeNull()
    const caption = screen.getByTestId('market-growth-caption').textContent
    expect(caption).not.toMatch(/→/)
    expect(caption).toMatch(/\$30\.5B/)
  })

  it('둘 다 빈 배열이면 → 차트 대신 빈상태 문구, 캡션·배지 없음', () => {
    render(<MarketGrowthChart market={market({ history: [], forecast: [] })} />)
    expect(screen.getByTestId('market-growth-empty').textContent).toBe('시장 데이터 없음')
    expect(screen.queryByTestId('market-growth-caption')).toBeNull()
    expect(screen.queryByTestId('market-growth-cagr')).toBeNull()
  })

  it('sources가 있으면 캡션에 출처 제목을 표기한다', () => {
    render(<MarketGrowthChart market={market()} sources={[{ title: '삼성증권 리서치' }, { title: 'IEA' }]} />)
    expect(screen.getByTestId('market-growth-caption').textContent).toMatch(/삼성증권 리서치, IEA/)
  })

  it('cagr_pct가 없으면 배지를 생략한다', () => {
    render(<MarketGrowthChart market={market({ cagr_pct: null })} />)
    expect(screen.queryByTestId('market-growth-cagr')).toBeNull()
  })
})

describe('buildGrowthSeries (경계 연도 공유)', () => {
  it('history 마지막 해에 fcst 값을 채워 실선→점선이 끊기지 않게 한다', () => {
    const rows = buildGrowthSeries(market())
    const boundary = rows.find(r => r.year === 2024)
    expect(boundary.hist).toBe(12.5)
    expect(boundary.fcst).toBe(12.5)
    expect(rows.map(r => r.year)).toEqual([2022, 2024, 2027, 2030])
  })

  it('history 또는 forecast가 비어도 연도순으로 정렬된 행을 만든다', () => {
    const rows = buildGrowthSeries(market({ forecast: [] }))
    expect(rows.map(r => r.year)).toEqual([2022, 2024])
    expect(rows.every(r => r.fcst == null)).toBe(true)
  })
})

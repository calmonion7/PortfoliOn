import { describe, it, expect } from 'vitest'
import { formatMarketSize, splitSeries, formatMarketSummary, TECH_NAMES, TECH_LEVEL_LABELS } from './techReportUtils'

// 선도기술 리포트(ADR-0033, task#276 S5) 순수 헬퍼 — red-first(TDD 대상은 formatMarketSize·splitSeries).

describe('formatMarketSize — 통화·단위 그대로 표시(환산 없음, ADR-0033)', () => {
  it('USD bn → $12.5B', () => {
    expect(formatMarketSize({ value: 12.5, currency: 'USD', unit: 'bn' })).toBe('$12.5B')
  })
  it('KRW tn → 3조원', () => {
    expect(formatMarketSize({ value: 3, currency: 'KRW', unit: 'tn' })).toBe('3조원')
  })
  it('KRW mn → 340백만원', () => {
    expect(formatMarketSize({ value: 340, currency: 'KRW', unit: 'mn' })).toBe('340백만원')
  })
  it('1자리 소수로 반올림', () => {
    expect(formatMarketSize({ value: 12.34, currency: 'USD', unit: 'mn' })).toBe('$12.3M')
  })
  it('enum 밖 currency → null', () => {
    expect(formatMarketSize({ value: 1, currency: 'JPY', unit: 'bn' })).toBeNull()
  })
  it('enum 밖 unit → null', () => {
    expect(formatMarketSize({ value: 1, currency: 'USD', unit: 'eok' })).toBeNull()
  })
  it('value가 숫자가 아니면 null', () => {
    expect(formatMarketSize({ value: NaN, currency: 'USD', unit: 'bn' })).toBeNull()
    expect(formatMarketSize({ value: '12', currency: 'USD', unit: 'bn' })).toBeNull()
  })
  it('size 자체가 없으면 null', () => {
    expect(formatMarketSize(null)).toBeNull()
    expect(formatMarketSize(undefined)).toBeNull()
  })
})

describe('splitSeries — history/forecast 경계와 빈 배열 처리', () => {
  it('연도순 정렬(입력이 뒤섞여도)', () => {
    const market = {
      history: [{ year: 2023, size: { value: 1, currency: 'USD', unit: 'bn' } }, { year: 2021, size: { value: 1, currency: 'USD', unit: 'bn' } }],
      forecast: [{ year: 2030, size: { value: 2, currency: 'USD', unit: 'bn' } }, { year: 2028, size: { value: 2, currency: 'USD', unit: 'bn' } }],
    }
    const { history, forecast } = splitSeries(market)
    expect(history.map(p => p.year)).toEqual([2021, 2023])
    expect(forecast.map(p => p.year)).toEqual([2028, 2030])
  })
  it('market이 undefined면 두 배열 모두 빈 배열', () => {
    expect(splitSeries(undefined)).toEqual({ history: [], forecast: [] })
  })
  it('한쪽 배열만 있어도 나머지는 빈 배열(배열이 아닌 값도 안전)', () => {
    expect(splitSeries({ history: [{ year: 2024, size: { value: 1, currency: 'USD', unit: 'bn' } }] })).toEqual({
      history: [{ year: 2024, size: { value: 1, currency: 'USD', unit: 'bn' } }],
      forecast: [],
    })
    expect(splitSeries({ history: null, forecast: undefined })).toEqual({ history: [], forecast: [] })
  })
})

describe('formatMarketSummary — 텍스트 요약(차트는 2/2 몫)', () => {
  const market = {
    history: [{ year: 2024, size: { value: 12.5, currency: 'USD', unit: 'bn' } }],
    forecast: [{ year: 2030, size: { value: 30.5, currency: 'USD', unit: 'bn' } }],
    cagr_pct: 12.3, as_of: '2026-08-03',
  }
  it('현재 → 예상, CAGR', () => {
    expect(formatMarketSummary(market)).toBe('$12.5B (2024) → $30.5B (2030), CAGR 12.3%')
  })
  it('history/forecast 둘 다 비면 null', () => {
    expect(formatMarketSummary({ as_of: '2026-08-03' })).toBeNull()
  })
  it('한쪽만 있어도 요약(CAGR 없으면 생략)', () => {
    expect(formatMarketSummary({ history: market.history })).toBe('$12.5B (2024)')
  })
})

describe('TECH_NAMES / TECH_LEVEL_LABELS — 표시명·척도 라벨 상수', () => {
  it('백엔드 TECH_TOPICS 4종과 슬러그가 일치', () => {
    expect(Object.keys(TECH_NAMES).sort()).toEqual(['reusable-rocket', 'robotics', 'smr', 'solid-state-battery'])
  })
  it('기술 성숙 단계 1~5 라벨(CONTEXT.md 공통 5단계)', () => {
    expect(TECH_LEVEL_LABELS[1]).toBe('기초연구')
    expect(TECH_LEVEL_LABELS[3]).toBe('실증')
    expect(TECH_LEVEL_LABELS[5]).toBe('양산상용')
  })
})

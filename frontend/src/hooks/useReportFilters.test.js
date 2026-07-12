import { describe, it, expect } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import useReportFilters from './useReportFilters'

// useReportList의 predicates를 그대로 미러 — 추출된 훅이 이들을 올바로 합성하는지 characterize.
const _targetPct = (s) => { const t = s?.target_mean, p = s?.price; return (t != null && p) ? (t - p) / p * 100 : null }
const _hasWarning = (s, isEtf) => {
  if (isEtf || !s) return false
  const total = (s.buy ?? 0) + (s.hold ?? 0) + (s.sell ?? 0)
  return total <= 10
}
// ungenerated는 lastScheduledDates 의존이라 훅 입장에선 단순 술어 — 위임 배선만 검증
const _isUngenerated = ([, v]) => v.__ungen === true

const reportList = {
  // 보유 2개: gap 20 / -10
  AAA: { category: 'holdings', is_etf: false, market: 'US', summary: { market: 'US', target_mean: 120, price: 100, daily_rsi: { rsi: 40 }, drop_from_high_20d: -5, buy: 5, hold: 3, sell: 2 } },
  BBB: { category: 'holdings', is_etf: false, market: 'KR', __ungen: true, summary: { market: 'KR', target_mean: 90, price: 100, daily_rsi: { rsi: 60 }, drop_from_high_20d: -10, buy: 8, hold: 4, sell: 1 } },
  // 관심 low: gap 100 / 50 / null (모두 not-warn)
  CCC: { category: 'watchlist', is_etf: false, market: 'US', summary: { market: 'US', target_mean: 200, price: 100, daily_rsi: { rsi: 30 }, drop_from_high_20d: -2, buy: 20, hold: 10, sell: 5 } },
  FFF: { category: 'watchlist', is_etf: false, market: 'US', summary: { market: 'US', target_mean: 150, price: 100, daily_rsi: { rsi: 55 }, drop_from_high_20d: -4, buy: 12, hold: 8, sell: 3 } },
  GGG: { category: 'watchlist', is_etf: false, market: 'US', summary: { market: 'US', target_mean: null, price: 100, daily_rsi: null, drop_from_high_20d: null, buy: 12, hold: 8, sell: 4 } },
  // 관심 high: gap 10 (not-warn)
  DDD: { category: 'watchlist', is_etf: false, market: 'KR', summary: { market: 'KR', target_mean: 110, price: 100, daily_rsi: { rsi: 50 }, drop_from_high_20d: -3, buy: 15, hold: 10, sell: 5 } },
  // 관심 warn: 의견 총합 3 (<=10)
  EEE: { category: 'watchlist', is_etf: false, market: 'US', __ungen: true, summary: { market: 'US', target_mean: 150, price: 100, daily_rsi: { rsi: 45 }, drop_from_high_20d: -1, buy: 2, hold: 1, sell: 0 } },
}

const othersData = {
  ZZZ: { market: 'US', summary: { market: 'US' } },
  MMM: { market: 'KR', summary: { market: 'KR' } },
}

const setup = (activeTab) => renderHook(
  (props) => useReportFilters(props),
  { initialProps: { reportList, othersData, activeTab, _targetPct, _hasWarning, _isUngenerated } },
)
const tickers = (entries) => entries.map(([t]) => t)

describe('useReportFilters — _matchSubTab 분기', () => {
  it('holdings 탭은 category=holdings만', () => {
    const { result } = setup('holdings')
    expect(tickers(result.current.subTabEntries).sort()).toEqual(['AAA', 'BBB'])
  })
  it('watchlist low(기본 sub): warn 아니고 gap null 또는 >=40', () => {
    const { result } = setup('watchlist')
    expect(tickers(result.current.subTabEntries).sort()).toEqual(['CCC', 'FFF', 'GGG'])
  })
  it('watchlist high: warn 아니고 gap < 40', () => {
    const { result } = setup('watchlist')
    act(() => result.current.setWatchlistSub('high'))
    expect(tickers(result.current.subTabEntries)).toEqual(['DDD'])
  })
  it('watchlist warn: 의견 총합 <= 10', () => {
    const { result } = setup('watchlist')
    act(() => result.current.setWatchlistSub('warn'))
    expect(tickers(result.current.subTabEntries)).toEqual(['EEE'])
  })
  it('ungenerated 탭은 _isUngenerated 술어 위임', () => {
    const { result } = setup('ungenerated')
    expect(tickers(result.current.subTabEntries).sort()).toEqual(['BBB', 'EEE'])
  })
  it('others 탭은 subTabEntries 비고 activeEntries=othersEntries(티커 오름차순)', () => {
    const { result } = setup('others')
    expect(result.current.subTabEntries).toEqual([])
    expect(tickers(result.current.activeEntries)).toEqual(['MMM', 'ZZZ'])
  })
})

describe('useReportFilters — 시장 카운트', () => {
  it('holdings 탭 mCount All/KR/US (marketFilter 무관 subTabEntries 기준)', () => {
    const { result } = setup('holdings')
    expect(result.current.mCountAll).toBe(2)
    expect(result.current.mCountKR).toBe(1)
    expect(result.current.mCountUS).toBe(1)
  })
  it('others 탭 mCount는 othersData 기준', () => {
    const { result } = setup('others')
    expect(result.current.mCountAll).toBe(2)
    expect(result.current.mCountKR).toBe(1)
    expect(result.current.mCountUS).toBe(1)
  })
})

describe('useReportFilters — marketFilter', () => {
  it('ALL/KR/US 필터 (holdings)', () => {
    const { result } = setup('holdings')
    expect(tickers(result.current.tabEntries).sort()).toEqual(['AAA', 'BBB']) // ALL
    act(() => result.current.setMarketFilter('KR'))
    expect(tickers(result.current.tabEntries)).toEqual(['BBB'])
    act(() => result.current.setMarketFilter('US'))
    expect(tickers(result.current.tabEntries)).toEqual(['AAA'])
  })
})

describe('useReportFilters — 정렬', () => {
  it('holdings 기본 정렬: gap 오름차순', () => {
    const { result } = setup('holdings')
    expect(tickers(result.current.tabEntries)).toEqual(['BBB', 'AAA']) // gap -10, 20
  })
  it('watchlist(low) 기본 정렬: gap 내림차순, null 마지막', () => {
    const { result } = setup('watchlist')
    expect(tickers(result.current.tabEntries)).toEqual(['CCC', 'FFF', 'GGG']) // 100, 50, null
  })
  it('sortCol=gap asc/desc 토글', () => {
    const { result } = setup('holdings')
    act(() => result.current.handleSort('gap'))   // asc
    expect(tickers(result.current.tabEntries)).toEqual(['BBB', 'AAA'])
    act(() => result.current.handleSort('gap'))   // desc
    expect(tickers(result.current.tabEntries)).toEqual(['AAA', 'BBB'])
  })
  it('sortCol=rsi asc', () => {
    const { result } = setup('holdings')
    act(() => result.current.handleSort('rsi'))   // asc: AAA 40, BBB 60
    expect(tickers(result.current.tabEntries)).toEqual(['AAA', 'BBB'])
  })
  it('sortCol=chg asc', () => {
    const { result } = setup('holdings')
    act(() => result.current.handleSort('chg'))   // asc: BBB -10, AAA -5
    expect(tickers(result.current.tabEntries)).toEqual(['BBB', 'AAA'])
  })
  it('명시 정렬에서도 null gap은 마지막(asc/desc 무관)', () => {
    const { result } = setup('watchlist')
    act(() => result.current.handleSort('gap'))   // asc: FFF 50, CCC 100, GGG null
    expect(tickers(result.current.tabEntries)).toEqual(['FFF', 'CCC', 'GGG'])
    act(() => result.current.handleSort('gap'))   // desc: CCC 100, FFF 50, GGG null
    expect(tickers(result.current.tabEntries)).toEqual(['CCC', 'FFF', 'GGG'])
  })
  it('pinned 종목은 탭 안 최상단으로, 비핀 상대순서는 보존', () => {
    const pinnedList = { ...reportList, FFF: { ...reportList.FFF, pinned: true } }
    const { result } = renderHook(
      (props) => useReportFilters(props),
      { initialProps: { reportList: pinnedList, othersData, activeTab: 'watchlist', _targetPct, _hasWarning, _isUngenerated } },
    )
    // 기본 정렬은 CCC, FFF, GGG(gap desc, null last) — FFF만 pinned면 FFF가 맨 위, 나머지 상대순서(CCC, GGG) 보존
    expect(tickers(result.current.tabEntries)).toEqual(['FFF', 'CCC', 'GGG'])
  })
})

describe('useReportFilters — sortArrow', () => {
  it('활성 컬럼은 방향 화살표, 비활성은 ↕', () => {
    const { result } = setup('holdings')
    expect(result.current.sortArrow('gap')).toBe(' ↕')
    act(() => result.current.handleSort('gap'))
    expect(result.current.sortArrow('gap')).toBe(' ▲')
    expect(result.current.sortArrow('rsi')).toBe(' ↕')
    act(() => result.current.handleSort('gap'))
    expect(result.current.sortArrow('gap')).toBe(' ▼')
  })
})

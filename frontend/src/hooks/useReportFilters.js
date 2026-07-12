import { useState } from 'react'

// Reports.jsx의 필터/정렬 파생 로직 추출 (R4 part 1/2, ADR-0019).
// 데이터 훅을 다시 호출하지 않고, 부모가 useReportList()로 받은 값을 args로 받는다.
// 소유 state: sortCol·sortDir·marketFilter·watchlistSub.
// 동작·출력은 추출 전 인라인 로직과 동일(characterization 테스트로 고정).
export default function useReportFilters({ reportList, othersData, activeTab, _targetPct, _hasWarning, _isUngenerated }) {
  const [watchlistSub, setWatchlistSub] = useState('low')
  const [sortCol, setSortCol] = useState(null)
  const [sortDir, setSortDir] = useState('asc')
  const [marketFilter, setMarketFilter] = useState('ALL')

  const _matchSubTab = ([, v]) => {
    if (activeTab === 'others') return false
    if (activeTab === 'ungenerated') return _isUngenerated([, v])
    if (activeTab === 'holdings') return v.category === 'holdings'
    if (v.category !== 'watchlist') return false
    if (watchlistSub === 'warn') return _hasWarning(v.summary, v.is_etf)
    const g = _targetPct(v.summary)
    if (watchlistSub === 'low') return !_hasWarning(v.summary, v.is_etf) && (g === null || g >= 40)
    return !_hasWarning(v.summary, v.is_etf) && (g !== null && g < 40)
  }
  const subTabEntries = Object.entries(reportList).filter(_matchSubTab)
  const _mktBase = activeTab === 'others' ? Object.entries(othersData || {}) : subTabEntries
  const mCountAll = _mktBase.length
  const mCountKR = _mktBase.filter(([, v]) => (v.summary?.market || v.market) === 'KR').length
  const mCountUS = _mktBase.filter(([, v]) => (v.summary?.market || v.market) === 'US').length

  const tabEntries = subTabEntries
    .filter(([, v]) => {
      if (marketFilter === 'ALL') return true
      const m = v.summary?.market || v.market
      return m === marketFilter
    })
    .sort(([, a], [, b]) => {
      if (!!a.pinned !== !!b.pinned) return a.pinned ? -1 : 1
      const cmp = (va, vb, dir) => {
        if (va === null && vb === null) return 0
        if (va === null) return 1
        if (vb === null) return -1
        return dir === 'asc' ? va - vb : vb - va
      }
      const gapOf = (s) => {
        const t = s.summary?.target_mean, p = s.summary?.price
        return t != null && p ? (t - p) / p * 100 : null
      }
      if (sortCol === 'gap') return cmp(gapOf(a), gapOf(b), sortDir)
      if (sortCol === 'rsi') return cmp(a.summary?.daily_rsi?.rsi ?? null, b.summary?.daily_rsi?.rsi ?? null, sortDir)
      if (sortCol === 'chg') return cmp(a.summary?.drop_from_high_20d ?? null, b.summary?.drop_from_high_20d ?? null, sortDir)
      // 기본 정렬
      if (activeTab === 'holdings') {
        const gapA = gapOf(a), gapB = gapOf(b)
        if (gapA !== gapB) { if (gapA === null) return 1; if (gapB === null) return -1; return gapA - gapB }
        const rA = a.summary?.daily_rsi?.rsi ?? null, rB = b.summary?.daily_rsi?.rsi ?? null
        if (rA === null && rB === null) return 0; if (rA === null) return 1; if (rB === null) return -1; return rB - rA
      }
      const gapA = gapOf(a), gapB = gapOf(b)
      if (gapA !== gapB) { if (gapA === null) return 1; if (gapB === null) return -1; return gapB - gapA }
      const rA = a.summary?.daily_rsi?.rsi ?? null, rB = b.summary?.daily_rsi?.rsi ?? null
      if (rA === null && rB === null) return 0; if (rA === null) return 1; if (rB === null) return -1; return rA - rB
    })

  const othersEntries = othersData
    ? Object.entries(othersData)
        .filter(([, v]) => marketFilter === 'ALL' || (v.summary?.market || v.market) === marketFilter)
        .sort(([a], [b]) => a.localeCompare(b))
    : []
  const activeEntries = activeTab === 'others' ? othersEntries : tabEntries

  const handleSort = (col) => {
    if (sortCol === col) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortCol(col); setSortDir('asc') }
  }
  const sortArrow = (col) => sortCol === col ? (sortDir === 'asc' ? ' ▲' : ' ▼') : ' ↕'

  return {
    activeEntries, tabEntries, subTabEntries,
    mCountAll, mCountKR, mCountUS,
    sortCol, sortDir, handleSort, sortArrow,
    marketFilter, setMarketFilter,
    watchlistSub, setWatchlistSub,
  }
}

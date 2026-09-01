import { useState, useEffect, useCallback } from 'react'
import api from '../api'

export default function useReportList() {
  const [reportList, setReportList] = useState({})
  const [lastScheduledDates, setLastScheduledDates] = useState(null)
  const [listLoading, setListLoading] = useState(true)
  const [hasFetched, setHasFetched] = useState(false)
  /** 3상태의 세 번째 값 — 「미조회(listLoading)」·「0건(reportList가 비었고 listFailed=false)」과
   *  구별되는 **조회 실패**. 실패를 빈 결과로 붕괴시키면 화면이 「리포트가 없습니다」라는
   *  *사실이 아닌 단정*을 하고, 그 아래 「설정에서 지금 생성」이라는 **잘못된 행동을 지시**한다
   *  (task#307 규율 · 참조 구현 `pages/Ranking.jsx::BasicInfo`의 news/newsFailed).
   *  실패는 캐시하지 않는다 — `fetchList` 진입마다 false로 되돌리므로 재시도·재마운트가 다시 묻는다. */
  const [listFailed, setListFailed] = useState(false)
  const [guruMap, setGuruMap] = useState({})

  useEffect(() => {
    api.get('/api/guru/stats/popularity')
      .then(({ data }) => {
        const map = {}
        data.forEach(r => { if (r.count > 0) map[r.ticker] = r.count })
        setGuruMap(map)
      })
      .catch((e) => { console.warn('[useReportList] 구루 인기도(/guru/stats/popularity) 조회 실패', e) })
  }, [])

  const applyList = useCallback((data) => {
    setReportList(data.stocks ?? data)
    if (data.last_scheduled_date) setLastScheduledDates(data.last_scheduled_date)
  }, [])

  const fetchList = useCallback(() => {
    setListLoading(true)
    setListFailed(false)   // 첫 조회 성공 뒤 ↺ 재조회가 실패해도 드러나도록 진입마다 리셋
    api.get('/api/report/list')
      .then(({ data }) => applyList(data))
      .catch((e) => {
        console.warn('[useReportList] 리포트 목록(/api/report/list) 조회 실패', e)
        setListFailed(true)
      })
      .finally(() => { setListLoading(false); setHasFetched(true) })
  }, [applyList])

  useEffect(() => { fetchList() }, [fetchList])

  const holdingsCount = Object.values(reportList).filter(v => v.category === 'holdings').length
  const watchlistAll = Object.entries(reportList).filter(([, v]) => v.category === 'watchlist')
  const _targetPct = (s) => { const t = s?.target_mean, p = s?.price; return (t != null && p) ? (t - p) / p * 100 : null }
  const _hasWarning = (s, isEtf) => {
    if (isEtf || !s) return false  // ETF는 애널 의견이 없어 '의견 수 적음' 경고 대상 아님
    const total = (s.buy ?? 0) + (s.hold ?? 0) + (s.sell ?? 0)
    return total <= 10
  }
  const watchlistWarnCount = watchlistAll.filter(([, v]) => _hasWarning(v.summary, v.is_etf)).length
  const watchlistLowCount = watchlistAll.filter(([, v]) => {
    if (_hasWarning(v.summary, v.is_etf)) return false
    const g = _targetPct(v.summary)
    return g === null || g >= 40
  }).length
  const watchlistHighCount = watchlistAll.filter(([, v]) => {
    if (_hasWarning(v.summary, v.is_etf)) return false
    const g = _targetPct(v.summary)
    return g !== null && g < 40
  }).length
  const watchlistCount = watchlistAll.length
  const _expectedDate = (market) => {
    if (!lastScheduledDates) return null
    const key = (market || '').toUpperCase() === 'KR' ? 'KR' : 'US'
    return lastScheduledDates[key]
  }
  const _isUngenerated = ([, v]) => {
    const expected = _expectedDate(v.market)
    return !expected
      ? (v.dates.length === 0 || v.summary?.price == null)
      : (v.dates.length === 0 || String(v.dates[0]) < expected)
  }
  const ungeneratedTickers = Object.entries(reportList).filter(_isUngenerated).map(([t]) => t)
  const ungeneratedCount = ungeneratedTickers.length

  return {
    reportList, lastScheduledDates, listLoading, hasFetched, listFailed,
    guruMap, fetchList, applyList,
    holdingsCount, watchlistAll, watchlistCount,
    watchlistWarnCount, watchlistLowCount, watchlistHighCount,
    _targetPct, _hasWarning, _isUngenerated,
    ungeneratedTickers, ungeneratedCount,
  }
}

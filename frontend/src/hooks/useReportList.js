import { useState, useEffect, useCallback } from 'react'
import api from '../api'

export default function useReportList() {
  const [reportList, setReportList] = useState({})
  const [lastScheduledDate, setLastScheduledDate] = useState(null)
  const [listLoading, setListLoading] = useState(true)
  const [hasFetched, setHasFetched] = useState(false)
  const [guruMap, setGuruMap] = useState({})

  useEffect(() => {
    api.get('/api/guru/stats/popularity')
      .then(({ data }) => {
        const map = {}
        data.forEach(r => { if (r.count > 0) map[r.ticker] = r.count })
        setGuruMap(map)
      })
      .catch(() => {})
  }, [])

  const applyList = useCallback((data) => {
    setReportList(data.stocks ?? data)
    if (data.last_scheduled_date) setLastScheduledDate(data.last_scheduled_date)
  }, [])

  const fetchList = useCallback(() => {
    setListLoading(true)
    api.get('/api/report/list')
      .then(({ data }) => applyList(data))
      .finally(() => { setListLoading(false); setHasFetched(true) })
  }, [applyList])

  useEffect(() => { fetchList() }, [fetchList])

  const holdingsCount = Object.values(reportList).filter(v => v.category === 'holdings').length
  const watchlistAll = Object.entries(reportList).filter(([, v]) => v.category === 'watchlist')
  const _targetPct = (s) => { const t = s?.target_mean, p = s?.price; return (t != null && p) ? (t - p) / p * 100 : null }
  const _hasWarning = (s) => {
    if (!s) return false
    const total = (s.buy ?? 0) + (s.hold ?? 0) + (s.sell ?? 0)
    return total <= 10
  }
  const watchlistWarnCount = watchlistAll.filter(([, v]) => _hasWarning(v.summary)).length
  const watchlistLowCount = watchlistAll.filter(([, v]) => {
    if (_hasWarning(v.summary)) return false
    const g = _targetPct(v.summary)
    return g === null || g >= 40
  }).length
  const watchlistHighCount = watchlistAll.filter(([, v]) => {
    if (_hasWarning(v.summary)) return false
    const g = _targetPct(v.summary)
    return g !== null && g < 40
  }).length
  const watchlistCount = watchlistAll.length
  const _isUngenerated = ([, v]) => !lastScheduledDate
    ? (v.dates.length === 0 || v.summary?.price == null)
    : !v.dates.map(String).includes(lastScheduledDate)
  const ungeneratedTickers = Object.entries(reportList).filter(_isUngenerated).map(([t]) => t)
  const ungeneratedCount = ungeneratedTickers.length

  return {
    reportList, lastScheduledDate, listLoading, hasFetched,
    guruMap, fetchList, applyList,
    holdingsCount, watchlistAll, watchlistCount,
    watchlistWarnCount, watchlistLowCount, watchlistHighCount,
    _targetPct, _hasWarning, _isUngenerated,
    ungeneratedTickers, ungeneratedCount,
  }
}

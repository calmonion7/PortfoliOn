import { useState, useEffect, useCallback } from 'react'
import api from '../api'

export default function usePortfolioData() {
  const [stocks, setStocks] = useState([])
  const [watchlist, setWatchlist] = useState([])
  const [listLoading, setListLoading] = useState(true)
  const [hasFetched, setHasFetched] = useState(false)
  const [dashboardCards, setDashboardCards] = useState([])
  const [dashboardLoading, setDashboardLoading] = useState(false)
  const [fx, setFx] = useState(1380)
  const [events7d, setEvents7d] = useState([])

  const fetchAll = useCallback(async () => {
    setListLoading(true)
    const { data } = await api.get('/api/portfolio')
    setStocks(data.stocks || [])
    setWatchlist(data.watchlist || [])
    setListLoading(false)
    setHasFetched(true)
    api.get('/api/portfolio/prices').then(({ data: prices }) => {
      setStocks(prev => prev.map(s => prices[s.ticker] ? { ...s, ...prices[s.ticker] } : s))
    }).catch(() => {})
  }, [])

  const fetchDashboard = useCallback(async ({ invalidate = false } = {}) => {
    setDashboardLoading(true)
    try {
      if (invalidate) await api.delete('/api/stocks/dashboard/cache').catch(() => {})
      const res = await api.get('/api/stocks/dashboard')
      setDashboardCards(res.data || [])
    } catch {
      // silent
    } finally {
      setDashboardLoading(false)
    }
  }, [])

  useEffect(() => { fetchAll() }, [fetchAll])
  useEffect(() => {
    api.get('/api/market/fx').then(({ data }) => {
      const rate = data?.rates?.usdkrw?.current
      if (rate) setFx(rate)
    }).catch(() => {})
  }, [])
  useEffect(() => {
    api.get('/api/digest/latest').then(({ data }) => {
      setEvents7d(data?.events_7d || [])
    }).catch(() => {})
  }, [])

  return { stocks, watchlist, listLoading, hasFetched, dashboardCards, dashboardLoading, fx, events7d, fetchAll, fetchDashboard }
}

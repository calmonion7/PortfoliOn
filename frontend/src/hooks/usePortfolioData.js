import { useState, useEffect, useCallback } from 'react'
import api from '../api'
import { isKrMarketOpen, isUsMarketOpen } from '../utils/marketHours'

export default function usePortfolioData() {
  const [stocks, setStocks] = useState([])
  const [watchlist, setWatchlist] = useState([])
  const [listLoading, setListLoading] = useState(true)
  const [hasFetched, setHasFetched] = useState(false)
  const [dashboardCards, setDashboardCards] = useState([])
  const [dashboardTotals, setDashboardTotals] = useState(null)
  const [dashboardLoading, setDashboardLoading] = useState(false)
  const [dashboardError, setDashboardError] = useState(null)
  const [fx, setFx] = useState(1380)
  const [events7d, setEvents7d] = useState([])
  const [lastUpdated, setLastUpdated] = useState(null)  // 시세 마지막 갱신 시각(폴링·초기 fetch)
  const [priceTick, setPriceTick] = useState(0)  // 라이브 폴링 틱 카운터 — 가격 플래시 발화 게이트(폴링에서만 증가)

  const fetchAll = useCallback(async () => {
    setListLoading(true)
    try {
      const { data } = await api.get('/api/portfolio')
      setStocks(data.stocks || [])
      setWatchlist(data.watchlist || [])
      setListLoading(false)  // 변경 전 순서 보존(listLoading=false → hasFetched=true); finally의 재호출은 no-op
      setHasFetched(true)
      api.get('/api/portfolio/prices').then(({ data: prices }) => {
        setStocks(prev => prev.map(s => prices[s.ticker] ? { ...s, ...prices[s.ticker] } : s))
        setLastUpdated(new Date())
      }).catch((e) => { console.warn('[usePortfolioData] 초기 시세(/portfolio/prices) 조회 실패', e) })
    } catch (e) {
      console.warn('[usePortfolioData] 포트폴리오 목록(/portfolio) 조회 실패', e)
    } finally {
      setListLoading(false)
    }
  }, [])

  const fetchDashboard = useCallback(async ({ invalidate = false } = {}) => {
    setDashboardLoading(true)
    try {
      if (invalidate) await api.delete('/api/stocks/dashboard/cache').catch(() => {})
      const res = await api.get('/api/stocks/dashboard')
      // 응답 형태: { holdings: [...], totals: {...} | null }
      setDashboardCards(res.data?.holdings || [])
      setDashboardTotals(res.data?.totals || null)
      setDashboardError(null)
    } catch (e) {
      console.warn('[usePortfolioData] dashboard(/stocks/dashboard) 조회 실패', e)
      setDashboardError(e)
    } finally {
      setDashboardLoading(false)
    }
  }, [])

  // 장중 자동폴링: /prices를 주기 조회해 보유·관심·대시보드 카드의 가격/등락만 갱신.
  const refreshLivePrices = useCallback(async () => {
    try {
      const { data: prices } = await api.get('/api/portfolio/prices')
      const merge = (arr) => arr.map((s) => (prices[s.ticker] ? { ...s, ...prices[s.ticker] } : s))
      setStocks(merge)
      setWatchlist(merge)
      setDashboardCards((prev) => prev.map((c) => (prices[c.ticker]
        ? {
            ...c,
            current_price: prices[c.ticker].current_price ?? c.current_price,
            daily_change_pct: prices[c.ticker].change_pct ?? c.daily_change_pct,
          }
        : c)))
      setLastUpdated(new Date())
      setPriceTick((t) => t + 1)  // 폴링 틱 → 가격 플래시 발화 허용
    } catch {
      // silent (네트워크/일시 오류 시 다음 틱에 재시도)
    }
  }, [])

  useEffect(() => { fetchAll() }, [fetchAll])

  // 폴링 루프: 15초 베이스. KR 개장 → 매 틱(15s), US만 개장 → 매 4틱(60s), 둘 다 닫힘/숨김탭 → 휴지.
  useEffect(() => {
    let n = 0
    const id = setInterval(() => {
      if (typeof document !== 'undefined' && document.hidden) return
      n += 1
      if (isKrMarketOpen()) refreshLivePrices()
      else if (isUsMarketOpen() && n % 4 === 0) refreshLivePrices()
    }, 15000)
    return () => clearInterval(id)
  }, [refreshLivePrices])
  useEffect(() => {
    api.get('/api/market/fx').then(({ data }) => {
      const rate = data?.rates?.usdkrw?.current
      if (rate) setFx(rate)
    }).catch((e) => { console.warn('[usePortfolioData] FX(/market/fx) 조회 실패', e) })
  }, [])
  useEffect(() => {
    api.get('/api/digest/latest').then(({ data }) => {
      setEvents7d(data?.events_7d || [])
    }).catch((e) => { console.warn('[usePortfolioData] digest(/digest/latest) 조회 실패', e) })
  }, [])

  return { stocks, watchlist, listLoading, hasFetched, dashboardCards, dashboardTotals, dashboardLoading, dashboardError, fx, events7d, lastUpdated, priceTick, fetchAll, fetchDashboard, refreshLivePrices }
}

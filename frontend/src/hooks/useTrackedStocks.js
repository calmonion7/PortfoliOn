import { useState, useEffect, useCallback, useRef } from 'react'
import api from '../api'
import { useToast } from '../components/Toast'

/**
 * 추적 상태(Tracked Status)를 소유하는 공용 훅 — 4값이다:
 * 보유(holding) · 관심(watchlist) · 미추적(none) · **모름(unknown)**.
 *
 * 앞의 셋은 서버가 답을 준 *사실*이고 `unknown`은 답을 못 받은 상태다. 이 넷째 값이
 * 없으면 조회 실패가 "미추적"으로 붕괴해 화면이 **잘못된 동사**를 제시한다 — 이미 관심에
 * 있는 종목에 「☆ 추가」를 보여 누르면 중복 추가가 되고(제거하려던 의도와 반대),
 * 이미 추적 중인 종목을 검색하면 리포트가 아니라 추가 모달로 보낸다.
 * 규칙: **모름이면 액션을 제시하지 않는다**(`wrong < missing`의 어포던스 판).
 *
 * ⚠️ "조회 성공 + 빈 결과"는 **미추적**이다(unknown=false). 빈 결과는 사실이다.
 *
 * 반환: { stockMap, unknown, loaded, toggle, reload }
 */
export default function useTrackedStocks() {
  const { showToast } = useToast()
  const [stockMap, setStockMap] = useState({})
  const [unknown, setUnknown] = useState(false)
  const [loaded, setLoaded] = useState(false)
  // 토글이 성공한 뒤 reload가 실패해도 unknown으로 되돌리지 않기 위한 플래그.
  // 방금 성공한 그 티커의 상태는 확실히 아는 값이라, 재조회 실패로 "모름"이 되면
  // 사용자가 방금 한 행동의 결과를 화면에서 잃는다.
  const trusted = useRef(false)

  const reload = useCallback(async () => {
    try {
      const { data } = await api.get('/api/stocks')
      const map = {}
      ;(data || []).forEach(s => { map[s.ticker] = s.type })
      setStockMap(map)
      setUnknown(false)
      trusted.current = true
      return true
    } catch (e) {
      console.warn('[useTrackedStocks] 보유/관심 조회 실패:', e)
      if (!trusted.current) setUnknown(true)
      return false
    } finally {
      setLoaded(true)
    }
  }, [])

  useEffect(() => { reload() }, [reload])

  const toggle = useCallback(async (ticker, name, isWatched) => {
    try {
      if (isWatched) {
        await api.delete(`/api/watchlist/${ticker}`)
      } else {
        await api.post('/api/watchlist', { ticker, name: name || ticker })
      }
      // 낙관적 로컬 반영 — 이 티커의 결과는 방금 서버가 확인해 줬다.
      trusted.current = true
      setUnknown(false)
      setStockMap(prev => {
        const next = { ...prev }
        if (isWatched) delete next[ticker]
        else next[ticker] = 'watchlist'
        return next
      })
      await reload()
    } catch (e) {
      console.warn('[useTrackedStocks] 관심종목 변경 실패:', e)
      showToast(e?.response?.data?.detail || '관심종목 변경 실패', 'error')
      // re-throw하지 않는다 — 기존 GuruStats·GuruAllocation의 토스트 계약(task#244).
    }
  }, [reload, showToast])

  return { stockMap, unknown, loaded, toggle, reload }
}

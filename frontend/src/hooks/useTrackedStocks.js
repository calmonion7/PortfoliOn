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
 * toggle(payload, isWatched) — payload는 `WatchlistStock`(백엔드)이 받는 필드 집합
 * 그대로(ticker·name·market·exchange·security_type)를 넘겨야 한다. 호출부가 market을
 * 생략하면 백엔드 기본값(`market="US"`)이 조용히 깔린다 — ADR-0032.
 *
 * 반환: { stockMap, unknown, loaded, pending, toggle, reload }
 */
export default function useTrackedStocks() {
  const { showToast } = useToast()
  const [stockMap, setStockMap] = useState({})
  const [unknown, setUnknown] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const [pending, setPending] = useState(() => new Set())
  // pending 중복 클릭 가드는 ref로 — state는 리렌더 후에야 반영돼 같은 틱의 재호출을 못 막는다
  // (Ranking.jsx의 loadingRef와 같은 패턴).
  const pendingRef = useRef(new Set())
  // 토글이 성공한 뒤 reload가 실패해도 unknown으로 되돌리지 않기 위한 플래그.
  // 방금 성공한 그 티커의 상태는 확실히 아는 값이라, 재조회 실패로 "모름"이 되면
  // 사용자가 방금 한 행동의 결과를 화면에서 잃는다.
  const trusted = useRef(false)
  // reload() 세대 가드 — 마운트 시 자동 reload(R0)와 toggle 후 reload(R1)가 동시에
  // in-flight일 때, R0가 R1보다 늦게 도착하면 낡은 응답이 최신 상태를 덮어쓴다
  // (Ranking.jsx fetchPage의 B27과 같은 레이스 클래스, 적대적 리뷰 렌즈2 포착).
  // reload는 호출마다 세대를 올리고, 응답은 자기 세대가 최신일 때만 상태를 반영한다.
  const reloadGenRef = useRef(0)

  const reload = useCallback(async () => {
    const myGen = ++reloadGenRef.current
    try {
      const { data } = await api.get('/api/stocks')
      if (myGen !== reloadGenRef.current) return false  // 낡은 세대 — 이후 reload가 이미 최신 상태 소유
      const map = {}
      ;(data || []).forEach(s => { map[s.ticker] = s.type })
      setStockMap(map)
      setUnknown(false)
      trusted.current = true
      return true
    } catch (e) {
      if (myGen !== reloadGenRef.current) return false
      console.warn('[useTrackedStocks] 보유/관심 조회 실패:', e)
      if (!trusted.current) setUnknown(true)
      return false
    } finally {
      if (myGen === reloadGenRef.current) setLoaded(true)
    }
  }, [])

  useEffect(() => { reload() }, [reload])

  const toggle = useCallback(async (payload, isWatched) => {
    const { ticker } = payload
    if (pendingRef.current.has(ticker)) return false  // 중복 클릭 가드 — 이미 in-flight
    pendingRef.current.add(ticker)
    setPending(new Set(pendingRef.current))
    try {
      if (isWatched) {
        await api.delete(`/api/watchlist/${ticker}`)
      } else {
        // payload를 그대로 POST — 2필드로 좁히면 market 기본값(US)이 조용히 깔린다(ADR-0032).
        await api.post('/api/watchlist', payload)
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
      return true
    } catch (e) {
      console.warn('[useTrackedStocks] 관심종목 변경 실패:', e)
      showToast(e?.response?.data?.detail || '관심종목 변경 실패', 'error')
      // re-throw하지 않는다 — 기존 GuruStats·GuruAllocation의 토스트 계약(task#244).
      return false
    } finally {
      pendingRef.current.delete(ticker)
      setPending(new Set(pendingRef.current))
    }
  }, [reload, showToast])

  return { stockMap, unknown, loaded, pending, toggle, reload }
}

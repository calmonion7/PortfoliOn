import { useState, useEffect } from 'react'
import api from '../api'

/**
 * 기술 리포트 경량 인덱스 — `GET /api/tech-reports/index` (ADR-0043).
 *
 * 소비처가 둘(포트폴리오 「기술 노출」 카드 · 종목 상세 헤더 기술 칩)이고 둘 다 같은
 * 6행짜리 목록만 필요하므로 모듈 레벨에서 **한 번만 받아 공유**한다.
 *
 * ⚠️ **조회 실패가 본문 렌더를 막지 않는다** — 이 인덱스는 *부가* 연결이라, 종목 상세가
 * 통째로 안 보이는 것보다 칩이 없는 게 낫다. 다만 실패를 조용히 삼키지는 않는다:
 * `console.warn`으로 마커를 남기고(CONVENTIONS §4 — graceful 담화는 warn, 마커는 소스
 * 훅명 실명) 아래 `failed`로 소비처에 알린다.
 *
 * ⚠️ 빈 배열의 의미가 **셋**이라 `ready`·`failed`를 함께 준다 — 「아직 안 옴」·「받았는데
 * 0건」·「조회 실패」는 화면이 각각 달라야 한다. 셋을 빈 배열 하나로 합치면 조회 실패가
 * **「노출 없음」이라는 거짓 진술로 붕괴**한다(`wrong < missing` 위반) — 사용자는 실제로
 * 노출이 없다고 읽지만 사실은 물어보지 못한 것이다. 소비처는 `failed`면 카드를 아예
 * 그리지 않아야 한다(없는 값 < 틀린 값).
 */
let _cache = null       // 성공 응답(배열) — 세션 내 재사용
let _inflight = null    // 동시 마운트가 중복 요청하지 않도록 공유하는 promise

export function _resetTechIndexCache() {
  // 테스트 전용 — 모듈 캐시가 케이스 간에 새지 않게 한다.
  _cache = null
  _inflight = null
}

export function fetchTechIndex() {
  if (_cache) return Promise.resolve(_cache)
  if (!_inflight) {
    _inflight = api.get('/api/tech-reports/index')
      .then(r => {
        const list = Array.isArray(r.data?.index) ? r.data.index : []
        _cache = list
        return list
      })
      .catch(e => {
        console.warn('[useTechIndex] 기술 인덱스 조회 실패 — 기술 연결만 생략한다:', e.message)
        // 실패를 **캐시하지 않는다**(다음 마운트가 다시 시도할 수 있어야 한다) —
        // 그리고 빈 배열이 아니라 null로 돌려 「0건」과 구별한다.
        return null
      })
      .finally(() => { _inflight = null })
  }
  return _inflight
}

export default function useTechIndex() {
  const [index, setIndex] = useState(_cache || [])
  const [ready, setReady] = useState(!!_cache)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let alive = true
    fetchTechIndex().then(list => {
      if (!alive) return
      setIndex(list || [])
      setFailed(list === null)
      setReady(true)
    })
    return () => { alive = false }
  }, [])

  return { techIndex: index, ready, failed }
}

/** 그 티커가 등장하는 기술들 — 소비처 2곳이 같은 규칙을 쓰도록 여기 둔다(정확일치만). */
export function techsForTicker(techIndex, ticker) {
  if (!ticker) return []
  return (techIndex || []).filter(t => (t.tickers || []).includes(ticker))
}

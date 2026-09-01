import { useState, useRef, useEffect, useCallback } from 'react'
import api from '../api'
import { useToast } from '../components/Toast'

const POLL_MS = 1500
/** 진행률 조회가 연속 이만큼 실패하면 폴링을 접는다(약 7.5초). 순간적인 blip은 넘기고
 *  지속적인 장애만 잡는 값 — 더 짧으면 정상 생성이 네트워크 흔들림에 끊긴다. */
const MAX_FAIL_STREAK = 5
/** `running:false`인데 완료조건이 성립하지 않는 응답이 연속 이만큼이면 접는다.
 *  `services/progress.py::peek`은 트래커가 없으면 **초기상태**(`running:false, total:0`)를 주는데,
 *  완료조건은 `!running && total > 0 && done >= total`이라 `total === 0`에서는 **영영 불성립**이다
 *  → 성공 응답인데도 무한 폴링(서버 재시작 시 도달). POST 직후 트래커 등록 전의 정상적인
 *  과도 상태도 같은 모양이므로, 한두 틱이 아니라 연속 N회를 요구한다. */
const MAX_IDLE_STREAK = 5

export default function useReportGeneration({ onApplyList }) {
  const { showToast } = useToast()
  const [generating, setGenerating] = useState(null)
  const [genProgress, setGenProgress] = useState({ done: 0, total: 0, failed: [] })
  const pollRef = useRef(null)
  const failStreakRef = useRef(0)
  const idleStreakRef = useRef(0)

  /** 폴링 중단. **`useCallback`으로 안정화한 것이 이 훅의 계약 중 하나다** — 아래 이펙트와
   *  소비처가 이것을 deps에 넣으므로, 매 렌더 새 함수가 되면 React가 직전 destructor를
   *  매 렌더 실행해 폴러를 죽인다(아래 주석 참조). 참조만 건드리므로 deps는 비어 있어도 안전하다. */
  const _stopPoll = useCallback(() => { clearInterval(pollRef.current); pollRef.current = null }, [])

  /** 언마운트 정리를 **훅이 소유한다**.
   *
   * 종전에는 `pages/Reports.jsx`가 `useEffect(() => cleanup, [cleanup])`로 이 일을 했는데,
   * `cleanup`이 `useCallback` 없이 매 렌더 새로 만들어지므로 deps가 매 렌더 바뀌고 React가
   * 직전 destructor(`clearInterval`)를 매 렌더 실행했다. 폴링 틱마다 `setGenProgress`가
   * 리렌더를 일으키므로 **첫 틱 뒤 폴러가 죽었다**(task#343 S1 실측: progress 호출 1회).
   * 그 버그가 아래 두 무한 경로를 우연히 덮고 있었으므로, 덮개를 걷는 지금 유계화가 필수다.
   * 회귀 축: `src/test/report-generation-poll-lifetime.test.jsx`. */
  useEffect(() => _stopPoll, [_stopPoll])

  const _startPoll = (onDone) => {
    _stopPoll()
    failStreakRef.current = 0
    idleStreakRef.current = 0
    pollRef.current = setInterval(async () => {
      let data
      try {
        ({ data } = await api.get('/api/report/progress'))
      } catch (e) {
        failStreakRef.current += 1
        console.warn(`[useReportGeneration] 진행률(/api/report/progress) 조회 실패 (${failStreakRef.current}/${MAX_FAIL_STREAK})`, e)
        if (failStreakRef.current >= MAX_FAIL_STREAK) {
          _stopPoll()
          setGenerating(null)
          showToast('생성 진행 상태를 불러오지 못했습니다', 'error')
        }
        return
      }
      failStreakRef.current = 0
      setGenProgress({ done: data.done, total: data.total, failed: data.failed || [] })
      if (!data.running && data.total > 0 && data.done >= data.total) {
        _stopPoll()
        setGenerating(null)
        onDone(data)
        api.get('/api/report/list')
          .then(({ data: list }) => onApplyList(list))
          .catch((e) => console.warn('[useReportGeneration] 생성 후 목록 갱신 실패', e))
        return
      }
      if (data.running) {
        // ⚠️ `running:true`인 동안에는 **절대 중단하지 않는다** — 느린 종목의 정상 생성을
        //    벽시계 상한으로 오판해 끊는 것을 막기 위해 이 조건을 쓴다.
        idleStreakRef.current = 0
        return
      }
      idleStreakRef.current += 1
      if (idleStreakRef.current >= MAX_IDLE_STREAK) {
        _stopPoll()
        setGenerating(null)
        showToast('생성 진행 상태를 확인할 수 없어 진행률 표시를 중단합니다', 'warning')
      }
    }, POLL_MS)
  }

  const _failedNames = (failed) => failed.map(f => (typeof f === 'string' ? f : (f?.ticker || '?')))

  const _firstError = (failed) => {
    const first = failed[0]
    const raw = typeof first === 'object' ? first?.error : ''
    return raw?.length > 80 ? raw.slice(0, 80) + '…' : raw
  }

  /** 서버가 409로 거부했을 때의 처리.
   *
   * 백엔드는 진행 중 재요청을 409로 거부한다(진행상태 트래커가 user_id 단위라, 이중 클릭뿐
   * 아니라 「전체 생성 → 개별 종목 재생성」이라는 흔한 admin 흐름에서도 발생한다). 이때
   * ⓐ 「리포트 생성 실패」는 **거짓 진술**이다 — 실제로는 앞선 생성이 정상 진행 중이다.
   * ⓑ 두 진입점이 POST **전에** 폴러를 끊으므로 여기서 폴링을 다시 세우지 않으면 진행률·
   *    완료 토스트·목록 갱신이 영구히 오지 않는다(서버는 계속 생성해 스냅샷을 갱신한다).
   * `generating`은 null로 되돌린다 — 거부된 종목이 생성 중인 것처럼 카드에 진행률을 그리는
   * 것 역시 거짓이므로, 진행 중이라는 사실은 토스트로만 말하고 완료 문구도 종목명을 뺀다.
   */
  const _handleConflict = (err) => {
    setGenerating(null)
    showToast(err.response?.data?.detail || '리포트 생성이 이미 진행 중입니다', 'warning')
    _startPoll((data) => {
      if (data.failed?.length) {
        const errStr = _firstError(data.failed)
        showToast(
          data.failed.length === 1 && errStr
            ? `생성 실패: ${_failedNames(data.failed)[0]} — ${errStr}`
            : `생성 실패: ${_failedNames(data.failed).join(', ')}`,
          'error',
        )
      } else {
        showToast(`리포트 ${data.done}개 생성 완료`)
      }
    })
  }

  const _handleError = (err) => {
    if (err?.response?.status === 409) return _handleConflict(err)
    setGenerating(null)
    showToast('리포트 생성 실패', 'error')
  }

  const generateOne = async (ticker) => {
    setGenerating(ticker)
    setGenProgress({ done: 0, total: 0, failed: [] })
    _stopPoll()
    try {
      await api.post(`/api/report/generate/${ticker}`)
      _startPoll((data) => {
        if (data.failed?.length) {
          const f = data.failed[0]
          const tickerName = typeof f === 'string' ? f : (f?.ticker || ticker)
          const errStr = _firstError(data.failed)
          const msg = errStr ? `생성 실패: ${tickerName} — ${errStr}` : `생성 실패: ${tickerName}`
          showToast(msg, 'error')
        } else {
          showToast(`${ticker} 리포트 생성 완료`)
        }
      })
    } catch (err) {
      _handleError(err)
    }
  }

  const generateBatch = async (tickers) => {
    if (!tickers.length) return
    setGenerating('__batch__')
    setGenProgress({ done: 0, total: 0, failed: [] })
    _stopPoll()
    try {
      // date 생략 → 서버가 종목 market별 기대날짜(KR/US)로 분리 생성한다.
      await api.post(`/api/report/generate?tickers=${tickers.join(',')}`)
      _startPoll((data) => {
        if (data.failed?.length) {
          const names = _failedNames(data.failed).join(', ')
          const errStr = _firstError(data.failed)
          const msg = data.failed.length === 1 && errStr
            ? `생성 실패: ${_failedNames(data.failed)[0]} — ${errStr}`
            : `생성 실패: ${names}`
          showToast(msg, 'error')
        } else {
          showToast(`리포트 ${data.done}개 생성 완료`)
        }
      })
    } catch (err) {
      _handleError(err)
    }
  }

  /** 반환 계약 보존 — `report-generation-conflict.test.jsx`가 이것을 부른다.
   *  언마운트 정리는 이제 위 `useEffect`가 소유하므로 소비처가 배선할 필요는 **없지만**,
   *  안정 참조라 배선해도 해롭지 않다(그것이 옛 결함이었다). */
  const cleanup = _stopPoll

  return { generating, genProgress, generateOne, generateBatch, cleanup }
}

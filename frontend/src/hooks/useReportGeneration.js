import { useState, useRef } from 'react'
import api from '../api'
import { useToast } from '../components/Toast'

export default function useReportGeneration({ onApplyList }) {
  const { showToast } = useToast()
  const [generating, setGenerating] = useState(null)
  const [genProgress, setGenProgress] = useState({ done: 0, total: 0, failed: [] })
  const pollRef = useRef(null)

  const _startPoll = (onDone) => {
    pollRef.current = setInterval(async () => {
      try {
        const { data } = await api.get('/api/report/progress')
        setGenProgress({ done: data.done, total: data.total, failed: data.failed || [] })
        if (!data.running && data.total > 0 && data.done >= data.total) {
          clearInterval(pollRef.current)
          setGenerating(null)
          onDone(data)
          api.get('/api/report/list').then(({ data: list }) => onApplyList(list))
        }
      } catch {}
    }, 1500)
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
    clearInterval(pollRef.current)
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
    clearInterval(pollRef.current)
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

  const cleanup = () => clearInterval(pollRef.current)

  return { generating, genProgress, generateOne, generateBatch, cleanup }
}

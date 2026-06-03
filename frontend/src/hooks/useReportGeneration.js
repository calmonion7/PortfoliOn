import { useState, useRef } from 'react'
import api from '../api'
import { useToast } from '../components/Toast'

export default function useReportGeneration({ onApplyList, lastScheduledDate }) {
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
          const rawErr = typeof f === 'object' ? f?.error : ''
          const errStr = rawErr?.length > 80 ? rawErr.slice(0, 80) + '…' : rawErr
          const msg = errStr ? `생성 실패: ${tickerName} — ${errStr}` : `생성 실패: ${tickerName}`
          showToast(msg, 'error')
        } else {
          showToast(`${ticker} 리포트 생성 완료`)
        }
      })
    } catch {
      setGenerating(null)
      showToast('리포트 생성 실패', 'error')
    }
  }

  const generateBatch = async (tickers) => {
    if (!tickers.length) return
    setGenerating('__batch__')
    setGenProgress({ done: 0, total: 0, failed: [] })
    clearInterval(pollRef.current)
    try {
      const dateParam = lastScheduledDate ? `&date=${lastScheduledDate}` : ''
      await api.post(`/api/report/generate?tickers=${tickers.join(',')}${dateParam}`)
      _startPoll((data) => {
        if (data.failed?.length) {
          const toName = f => typeof f === 'string' ? f : (f?.ticker || '?')
          const names = data.failed.map(toName).join(', ')
          const first = data.failed[0]
          const rawErr = typeof first === 'object' ? first?.error : ''
          const errStr = rawErr?.length > 80 ? rawErr.slice(0, 80) + '…' : rawErr
          const msg = data.failed.length === 1 && errStr
            ? `생성 실패: ${toName(first)} — ${errStr}`
            : `생성 실패: ${names}`
          showToast(msg, 'error')
        } else {
          showToast(`리포트 ${data.done}개 생성 완료`)
        }
      })
    } catch {
      setGenerating(null)
      showToast('리포트 생성 실패', 'error')
    }
  }

  const cleanup = () => clearInterval(pollRef.current)

  return { generating, genProgress, generateOne, generateBatch, cleanup }
}

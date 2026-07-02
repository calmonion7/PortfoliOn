import { useState, useRef, useEffect } from 'react'
import api from '../api'

// Reports.jsx의 종목 관리(추가/편집/삭제/승격) 핸들러·모달 state 추출 (R4 part 2/2, ADR-0019).
// 종목관리가 리서치 뷰로 흡수된(ADR-0018) 그 핸들러들의 재배치. 데이터 훅을 다시 호출하지 않고
// 부모가 받은 값(map·fetcher·toast·activeTab)을 args로 받는다. 동작·시각·API 무변경.
export default function useStockManagement({ holdingMap, watchMap, fetchList, fetchAll, showToast, activeTab, setActiveTab, refreshOthers }) {
  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState(null)        // { ...stock, isWatch }
  const [addMode, setAddMode] = useState('holding')    // 'holding' | 'watchlist'
  const [promoteTarget, setPromoteTarget] = useState(null)
  const [mutError, setMutError] = useState('')
  const pollIntervalsRef = useRef(new Set())  // Set: 종목 여러 개 연속 추가 시 동시 폴링을 전부 추적

  useEffect(() => () => { pollIntervalsRef.current.forEach(clearInterval) }, [])

  const pollReportGeneration = (ticker) => {
    let attempts = 0
    const maxAttempts = 6
    const id = setInterval(async () => {
      attempts++
      try {
        const { data } = await api.get(`/api/report/${ticker}/history`)
        if (data && data.length > 0) {
          clearInterval(id); pollIntervalsRef.current.delete(id)
        } else if (attempts >= maxAttempts) {
          clearInterval(id); pollIntervalsRef.current.delete(id)
          showToast(`${ticker} 리포트 생성에 실패했습니다.\n다시 시도해주세요.`, 'warning')
        }
      } catch {
        if (attempts >= maxAttempts) {
          clearInterval(id); pollIntervalsRef.current.delete(id)
          showToast(`${ticker} 리포트 생성에 실패했습니다.\n다시 시도해주세요.`, 'warning')
        }
      }
    }, 15000)
    pollIntervalsRef.current.add(id)
  }

  const refreshAfterMutation = () => { fetchList(); fetchAll() }

  const handleSave = async (stockData) => {
    try {
      const isWatch = editing ? editing.isWatch : addMode === 'watchlist'
      if (editing) {
        await api.put(`/api/${isWatch ? 'watchlist' : 'portfolio'}/${editing.ticker}`, stockData)
        showToast(`${editing.ticker} 수정됐습니다`)
      } else {
        const res = await api.post(`/api/${isWatch ? 'watchlist' : 'portfolio'}`, stockData)
        showToast(`${stockData.ticker} 추가됐습니다`)
        if (res.data?.report_queued) {
          pollReportGeneration(stockData.ticker.toUpperCase())
        }
      }
      setModalOpen(false); setEditing(null); setMutError(''); refreshAfterMutation()
    } catch (err) {
      const msg = err.response?.data?.detail || '저장 실패'
      setMutError(msg); showToast(msg, 'error')
      throw err
    }
  }

  const handleDelete = async (ticker, isWatch) => {
    const msg = isWatch ? `${ticker}를 완전히 삭제하시겠습니까?` : `${ticker}를 보유종목에서 제거하고 관심종목으로 이동합니까?`
    if (!window.confirm(msg)) return
    try {
      await api.delete(`/api/${isWatch ? 'watchlist' : 'portfolio'}/${ticker}`)
      setMutError(''); refreshAfterMutation()
      showToast(`${ticker} 삭제됐습니다`)
    } catch (err) {
      const errMsg = err.response?.data?.detail || '삭제 실패'
      setMutError(errMsg); showToast(errMsg, 'error')
    }
  }

  // 그외(타 사용자) 종목 — 관리자 전용. 전 사용자 user_stocks에서 제거(스냅샷 유지). is_mine=false일 때만 노출.
  const handleGlobalDelete = async (ticker) => {
    if (!window.confirm(`${ticker}를 모든 사용자의 보유·관심 목록에서 제거합니다. 리포트 데이터는 유지됩니다. 계속하시겠습니까?`)) return
    try {
      const { data } = await api.delete(`/api/admin/stocks/${ticker}`)
      setMutError(''); refreshAfterMutation(); refreshOthers?.()
      showToast(`${ticker} 삭제됐습니다 (${data.deleted}건)`)
    } catch (err) {
      const errMsg = err.response?.data?.detail || '삭제 실패'
      setMutError(errMsg); showToast(errMsg, 'error')
    }
  }

  const handlePromote = async ({ quantity, avg_cost }) => {
    try {
      await api.post(`/api/watchlist/${promoteTarget.ticker}/promote`, { quantity, avg_cost })
      showToast(`${promoteTarget.ticker} 보유종목으로 이동됐습니다`)
      setPromoteTarget(null); setActiveTab('holdings'); refreshAfterMutation()
    } catch (err) {
      showToast('이동 실패', 'error')
      throw err
    }
  }

  // 편집 — 수량·평단은 reportList엔 없고 stocks/watchlist에 있다. ticker로 찾아 넘긴다.
  const openEdit = (ticker, category) => {
    const isWatch = category === 'watchlist'
    const src = isWatch ? watchMap[ticker?.toUpperCase()] : holdingMap[ticker?.toUpperCase()]
    setEditing({ ...(src || { ticker, market: 'US' }), isWatch })
    setModalOpen(true)
  }
  const openAdd = () => {
    setEditing(null)
    setAddMode(activeTab === 'watchlist' ? 'watchlist' : 'holding')
    setModalOpen(true)
  }

  return {
    modalOpen, setModalOpen,
    editing, setEditing,
    addMode,
    promoteTarget, setPromoteTarget,
    mutError,
    handleSave, handleDelete, handleGlobalDelete, handlePromote, openEdit, openAdd,
    pollReportGeneration, refreshAfterMutation,
  }
}

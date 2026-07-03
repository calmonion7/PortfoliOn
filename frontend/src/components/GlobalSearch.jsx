import { useState, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import api from '../api'
import StockSearchBox from './StockSearchBox'
import StockModal from './StockModal'
import { useToast } from './Toast'
import { Search } from './ui/icons'

// 전역 종목 검색 (task#141): 어느 화면에서든 헤더에서 종목 검색 →
//  · 추적(보유/관심) 종목  → 리포트 상세로 점프 (기존 location.state 딥링크 규약 재사용)
//  · 미추적 종목          → 관심종목 추가 모달을 프리필로 오픈 (발굴)
// variant='desktop'(TopNav 인라인 입력) | 'mobile'(헤더 아이콘 → 상단 시트 오버레이).
export default function GlobalSearch({ variant = 'desktop' }) {
  const navigate = useNavigate()
  const { showToast } = useToast()
  const [open, setOpen] = useState(false)        // 모바일 오버레이
  const [prefill, setPrefill] = useState(null)   // add 모달 프리필(미추적 선택 시)
  const trackedRef = useRef(null)                // 보유+관심 ticker Set (lazy)

  const ensureTracked = async () => {
    if (trackedRef.current) return trackedRef.current
    try {
      const { data } = await api.get('/api/stocks')  // [{ticker,name,type,market}]
      trackedRef.current = new Set((data || []).map(s => (s.ticker || '').toUpperCase()))
    } catch {
      trackedRef.current = new Set()
    }
    return trackedRef.current
  }

  const handleSelect = async (item) => {
    const t = (item.ticker || '').toUpperCase()
    setOpen(false)
    const tracked = await ensureTracked()
    if (tracked.has(t)) {
      navigate('/', { state: { tab: 'reports', ticker: t } })  // 리포트 상세 점프
    } else {
      setPrefill(item)  // 미추적 → 관심종목 추가 프리필
    }
  }

  const handleSave = async (payload) => {
    try {
      await api.post('/api/watchlist', payload)
      showToast(`${payload.ticker} 관심종목에 추가됐습니다`)
      trackedRef.current?.add((payload.ticker || '').toUpperCase())
      setPrefill(null)
    } catch (err) {
      showToast(err?.response?.data?.detail || '추가 실패', 'error')
      throw err
    }
  }

  const modal = prefill && (
    <StockModal
      mode="watchlist"
      prefill={prefill}
      onSave={handleSave}
      onClose={() => setPrefill(null)}
    />
  )

  if (variant === 'mobile') {
    return (
      <>
        <button className="icon-btn" title="종목 검색" onClick={() => setOpen(true)}><Search /></button>
        {open && (
          <div onClick={() => setOpen(false)}
               style={{ position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(0,0,0,0.4)' }}>
            <div onClick={e => e.stopPropagation()}
                 style={{ position: 'absolute', top: 0, left: 0, right: 0, background: 'var(--bg)',
                          padding: '12px 16px', borderBottom: '1px solid var(--border)' }}>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <StockSearchBox onSelect={handleSelect} autoFocus placeholder="종목 검색 (점프·발굴)" />
                </div>
                <button className="icon-btn" onClick={() => setOpen(false)} title="닫기">✕</button>
              </div>
            </div>
          </div>
        )}
        {modal}
      </>
    )
  }

  // desktop: TopNav 인라인 입력
  return (
    <div style={{ width: 220 }}>
      <StockSearchBox onSelect={handleSelect} placeholder="종목 검색…" />
      {modal}
    </div>
  )
}

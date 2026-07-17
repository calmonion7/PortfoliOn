import { useState, useRef } from 'react'
import useBodyScrollLock from '../hooks/useBodyScrollLock'

export default function PromoteModal({ ticker, market = 'US', onConfirm, onClose }) {
  useBodyScrollLock()
  const [quantity, setQuantity] = useState('')
  const [avgCost, setAvgCost] = useState('')
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState('')
  const mouseDownOnOverlay = useRef(false)

  const handleSubmit = async (e) => {
    e.preventDefault()
    setSaving(true)
    setSaveError('')
    try {
      await onConfirm({ quantity: parseFloat(quantity), avg_cost: parseFloat(avgCost) })
    } catch (err) {
      setSaving(false)
      setSaveError(err?.response?.data?.detail || '전환에 실패했습니다.')
    }
  }

  return (
    <div className="modal-overlay"
      onMouseDown={e => { mouseDownOnOverlay.current = e.target === e.currentTarget }}
      onClick={() => { if (mouseDownOnOverlay.current) onClose() }}
    >
      <div className="modal" style={{ width: 320 }} onClick={e => e.stopPropagation()}>
        <h2 style={{ marginBottom: 4 }}>보유종목으로 전환</h2>
        <p style={{ color: 'var(--tag-track-color)', fontSize: 14, marginBottom: 16 }}>{ticker}</p>
        <form onSubmit={handleSubmit}>
          <div className="form-field">
            <label>수량</label>
            <input
              type="number"
              value={quantity}
              onChange={e => setQuantity(e.target.value)}
              required
              step="0.01"
              min="0.01"
            />
          </div>
          <div className="form-field">
            <label>평균 매입가 ({market === 'KR' ? '₩' : '$'})</label>
            <input
              type="number"
              value={avgCost}
              onChange={e => setAvgCost(e.target.value)}
              required
              step="0.01"
              min="0.01"
            />
          </div>
          {saveError && <p style={{ color: 'var(--color-error)', fontSize: 13, margin: '12px 0 0' }}>{saveError}</p>}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 12 }}>
            <button type="submit" className="btn btn-primary" disabled={saving} style={{ width: '100%', justifyContent: 'center', padding: '12px' }}>
              {saving ? '처리 중…' : '보유종목으로 전환'}
            </button>
            <button type="button" className="btn" disabled={saving} style={{ width: '100%', justifyContent: 'center', padding: '12px', background: 'transparent', borderColor: 'transparent', color: 'var(--text-3)' }} onClick={onClose}>취소</button>
          </div>
        </form>
      </div>
    </div>
  )
}

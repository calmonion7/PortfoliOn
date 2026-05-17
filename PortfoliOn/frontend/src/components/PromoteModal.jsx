import { useState } from 'react'

export default function PromoteModal({ ticker, onConfirm, onClose }) {
  const [quantity, setQuantity] = useState('')
  const [avgCost, setAvgCost] = useState('')

  const handleSubmit = (e) => {
    e.preventDefault()
    onConfirm({ quantity: parseFloat(quantity), avg_cost: parseFloat(avgCost) })
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" style={{ width: 320 }} onClick={e => e.stopPropagation()}>
        <h2 style={{ marginBottom: 4 }}>보유종목으로 전환</h2>
        <p style={{ color: '#80cbc4', fontSize: 14, marginBottom: 16 }}>{ticker}</p>
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
            <label>평균 매입가 ($)</label>
            <input
              type="number"
              value={avgCost}
              onChange={e => setAvgCost(e.target.value)}
              required
              step="0.01"
              min="0.01"
            />
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
            <button type="submit" className="btn-primary">전환</button>
            <button type="button" className="btn-secondary" onClick={onClose}>취소</button>
          </div>
        </form>
      </div>
    </div>
  )
}

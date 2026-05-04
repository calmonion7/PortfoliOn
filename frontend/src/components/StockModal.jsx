import { useState, useEffect } from 'react'

const EMPTY = { ticker: '', name: '', quantity: '', avg_cost: '', competitors: '', moat: '', growth_plan: '' }

export default function StockModal({ stock, onSave, onClose }) {
  const [form, setForm] = useState(EMPTY)
  const isEdit = !!stock

  useEffect(() => {
    if (stock) {
      setForm({ ...stock, competitors: stock.competitors?.join(', ') || '' })
    } else {
      setForm(EMPTY)
    }
  }, [stock])

  const set = (field) => (e) => setForm({ ...form, [field]: e.target.value })

  const handleSubmit = (e) => {
    e.preventDefault()
    onSave({
      ticker: form.ticker.trim().toUpperCase(),
      name: form.name.trim(),
      quantity: parseFloat(form.quantity),
      avg_cost: parseFloat(form.avg_cost),
      competitors: form.competitors.split(',').map(s => s.trim().toUpperCase()).filter(Boolean),
      moat: form.moat.trim(),
      growth_plan: form.growth_plan.trim(),
    })
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <h2>{isEdit ? '종목 수정' : '종목 추가'}</h2>
        <form onSubmit={handleSubmit}>
          {[
            ['ticker', '티커 (예: NFLX)', 'text', !isEdit],
            ['name', '회사명', 'text', false],
            ['quantity', '보유 수량', 'number', false],
            ['avg_cost', '평균 매입가 ($)', 'number', false],
            ['competitors', '경쟁사 티커 (쉼표 구분, 예: DIS,WBD)', 'text', false],
          ].map(([field, label, type, required]) => (
            <div className="form-field" key={field}>
              <label>{label}</label>
              <input
                type={type}
                value={form[field]}
                onChange={set(field)}
                required={required}
                disabled={field === 'ticker' && isEdit}
                step={type === 'number' ? '0.01' : undefined}
              />
            </div>
          ))}
          <div className="form-field">
            <label>경제적 해자</label>
            <textarea rows={2} value={form.moat} onChange={set('moat')} />
          </div>
          <div className="form-field">
            <label>장기 성장 계획</label>
            <textarea rows={2} value={form.growth_plan} onChange={set('growth_plan')} />
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
            <button type="submit" className="btn-primary">저장</button>
            <button type="button" className="btn-secondary" onClick={onClose}>취소</button>
          </div>
        </form>
      </div>
    </div>
  )
}

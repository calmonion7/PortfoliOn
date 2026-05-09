import { useState, useEffect } from 'react'

const HOLDING_EMPTY = { ticker: '', name: '', quantity: '', avg_cost: '', competitors: '', moat: '', growth_plan: '', market: 'US', exchange: '' }
const WATCHLIST_EMPTY = { ticker: '', name: '', competitors: '', moat: '', growth_plan: '', market: 'US', exchange: '' }

const INPUT_STYLE = {
  width: '100%', padding: '6px 10px', background: '#0d1117',
  border: '1px solid #2a3a4a', borderRadius: 4, color: '#ccc', fontSize: 13, boxSizing: 'border-box',
}
const SELECT_STYLE = {
  ...INPUT_STYLE, cursor: 'pointer',
}

export default function StockModal({ stock, onSave, onClose, mode = 'holding' }) {
  const empty = mode === 'watchlist' ? WATCHLIST_EMPTY : HOLDING_EMPTY
  const [form, setForm] = useState(empty)
  const isEdit = !!stock

  useEffect(() => {
    if (stock) {
      setForm({ ...empty, ...stock, competitors: stock.competitors?.join(', ') || '', market: stock.market || 'US', exchange: stock.exchange || '' })
    } else {
      setForm(empty)
    }
  }, [stock, mode])

  const set = (field) => (e) => setForm(f => ({ ...f, [field]: e.target.value }))

  const handleMarketChange = (e) => {
    const m = e.target.value
    setForm(f => ({ ...f, market: m, exchange: m === 'KR' ? (f.exchange || 'KS') : '' }))
  }

  const handleSubmit = (e) => {
    e.preventDefault()
    const ticker = form.market === 'KR'
      ? form.ticker.trim().replace(/\D/g, '').padStart(6, '0')
      : form.ticker.trim().toUpperCase()
    const base = {
      ticker,
      name: form.name.trim(),
      competitors: form.competitors.split(',').map(s => s.trim().toUpperCase()).filter(Boolean),
      moat: form.moat.trim(),
      growth_plan: form.growth_plan.trim(),
      market: form.market,
      exchange: form.market === 'KR' ? (form.exchange || 'KS') : '',
    }
    if (mode === 'holding') {
      onSave({ ...base, quantity: parseFloat(form.quantity), avg_cost: parseFloat(form.avg_cost) })
    } else {
      onSave(base)
    }
  }

  const isKR = form.market === 'KR'
  const currency = isKR ? '₩' : '$'
  const tickerPlaceholder = isKR ? '6자리 종목코드 (예: 005930)' : '티커 (예: NFLX)'
  const costLabel = isKR ? `평균 매입가 (${currency})` : `평균 매입가 (${currency})`

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <h2>{mode === 'watchlist' ? (isEdit ? '관심종목 수정' : '관심종목 추가') : (isEdit ? '종목 수정' : '종목 추가')}</h2>
        <form onSubmit={handleSubmit}>

          {/* 시장 선택 */}
          <div className="form-field">
            <label>시장</label>
            <select value={form.market} onChange={handleMarketChange} style={SELECT_STYLE} disabled={isEdit}>
              <option value="US">🇺🇸 미국 주식 (US)</option>
              <option value="KR">🇰🇷 국내 주식 (KR)</option>
            </select>
          </div>

          {/* KR: 거래소 선택 */}
          {isKR && (
            <div className="form-field">
              <label>거래소</label>
              <select value={form.exchange || 'KS'} onChange={set('exchange')} style={SELECT_STYLE} disabled={isEdit}>
                <option value="KS">KOSPI (.KS)</option>
                <option value="KQ">KOSDAQ (.KQ)</option>
              </select>
            </div>
          )}

          {/* 티커 */}
          <div className="form-field">
            <label>{isKR ? '종목코드' : '티커'}</label>
            <input
              type="text"
              value={form.ticker}
              onChange={set('ticker')}
              required
              disabled={isEdit}
              placeholder={tickerPlaceholder}
              style={INPUT_STYLE}
              maxLength={isKR ? 6 : undefined}
            />
          </div>

          {/* 회사명 */}
          <div className="form-field">
            <label>회사명</label>
            <input type="text" value={form.name} onChange={set('name')} required style={INPUT_STYLE} />
          </div>

          {/* 보유 전용 필드 */}
          {mode === 'holding' && (
            <>
              <div className="form-field">
                <label>보유 수량</label>
                <input type="number" value={form.quantity} onChange={set('quantity')} required step="0.01" style={INPUT_STYLE} />
              </div>
              <div className="form-field">
                <label>{costLabel}</label>
                <input type="number" value={form.avg_cost} onChange={set('avg_cost')} required step={isKR ? '1' : '0.01'} style={INPUT_STYLE} />
              </div>
            </>
          )}

          {/* 경쟁사 */}
          <div className="form-field">
            <label>경쟁사 {isKR ? '(종목코드, 쉼표 구분)' : '(티커, 쉼표 구분)'}</label>
            <input type="text" value={form.competitors} onChange={set('competitors')} style={INPUT_STYLE} />
          </div>

          {/* 경제적 해자 */}
          <div className="form-field">
            <label>경제적 해자</label>
            <textarea rows={2} value={form.moat} onChange={set('moat')} style={{ ...INPUT_STYLE, resize: 'vertical' }} />
          </div>

          {/* 장기 성장 계획 */}
          <div className="form-field">
            <label>장기 성장 계획</label>
            <textarea rows={2} value={form.growth_plan} onChange={set('growth_plan')} style={{ ...INPUT_STYLE, resize: 'vertical' }} />
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

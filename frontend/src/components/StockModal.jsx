import { useState, useEffect, useRef, useCallback } from 'react'
import api from '../api'

const HOLDING_EMPTY = { ticker: '', name: '', quantity: '', avg_cost: '', competitors: '', moat: '', growth_plan: '', market: 'US', exchange: '' }
const WATCHLIST_EMPTY = { ticker: '', name: '', competitors: '', moat: '', growth_plan: '', market: 'US', exchange: '' }

const INPUT_STYLE = {
  width: '100%', padding: '6px 10px', background: 'var(--input-bg)',
  border: '1px solid var(--input-border)', borderRadius: 4, color: 'var(--text)', fontSize: 13, boxSizing: 'border-box',
}

function useDebounce(value, delay) {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay)
    return () => clearTimeout(t)
  }, [value, delay])
  return debounced
}

function SearchBox({ onSelect }) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState([])
  const [loading, setLoading] = useState(false)
  const [open, setOpen] = useState(false)
  const debouncedQuery = useDebounce(query, 350)
  const boxRef = useRef(null)

  useEffect(() => {
    if (!debouncedQuery.trim()) { setResults([]); setOpen(false); return }
    setLoading(true)
    // 항상 ALL로 검색 — 결과 선택 시 market/exchange 자동 설정
    api.get('/api/stocks/search', { params: { q: debouncedQuery, market: 'ALL' } })
      .then(r => { setResults(r.data); setOpen(r.data.length > 0) })
      .catch(() => setResults([]))
      .finally(() => setLoading(false))
  }, [debouncedQuery])

  useEffect(() => {
    const handler = (e) => { if (boxRef.current && !boxRef.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const handleSelect = (item) => {
    onSelect(item)
    setQuery(item.name)
    setOpen(false)
  }

  return (
    <div ref={boxRef} style={{ position: 'relative' }}>
      <div style={{ position: 'relative' }}>
        <input
          type="text"
          value={query}
          onChange={e => { setQuery(e.target.value); setOpen(true) }}
          onFocus={() => results.length > 0 && setOpen(true)}
          placeholder="종목명 또는 티커로 검색..."
          style={{ ...INPUT_STYLE, paddingRight: 32 }}
          autoComplete="off"
        />
        <span style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)', fontSize: 14, pointerEvents: 'none' }}>
          {loading ? '⏳' : '🔍'}
        </span>
      </div>
      {open && results.length > 0 && (
        <div style={{
          position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 9999,
          background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 4,
          maxHeight: 240, overflowY: 'auto', boxShadow: '0 4px 16px rgba(0,0,0,0.4)',
          marginTop: 2,
        }}>
          {results.map((item, i) => (
            <div
              key={i}
              onMouseDown={() => handleSelect(item)}
              style={{
                padding: '8px 12px', cursor: 'pointer', borderBottom: '1px solid var(--border)',
                display: 'flex', alignItems: 'center', gap: 8,
              }}
              onMouseEnter={e => e.currentTarget.style.background = 'var(--bg-hover)'}
              onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
            >
              <span style={{
                fontSize: 9, padding: '1px 4px', borderRadius: 2, flexShrink: 0,
                background: item.market === 'KR' ? '#1a3a2a' : '#1a2a3a',
                color: item.market === 'KR' ? '#81c784' : '#4fc3f7',
                border: `1px solid ${item.market === 'KR' ? '#2e5a3a' : '#2a4a6a'}`,
              }}>
                {item.market === 'KR' ? '🇰🇷' : '🇺🇸'}
              </span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, color: 'var(--text)', fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {item.name}
                </div>
                <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 1 }}>
                  {item.ticker}{item.exchange ? `.${item.exchange}` : ''} · {item.exchange_display}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
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

  const handleSearchSelect = (item) => {
    setForm(f => ({
      ...f,
      ticker: item.ticker,
      name: item.name,
      market: item.market,
      exchange: item.exchange || '',
    }))
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
  const title = mode === 'watchlist' ? (isEdit ? '관심종목 수정' : '관심종목 추가') : (isEdit ? '종목 수정' : '종목 추가')

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <h2>{title}</h2>
        <form onSubmit={handleSubmit}>

          {/* 종목 검색 (신규 추가 시에만) */}
          {!isEdit && (
            <div className="form-field">
              <label>종목 검색 <span style={{ color: 'var(--text-muted)', fontSize: 10, fontWeight: 400 }}>(종목명·티커·종목코드)</span></label>
              <SearchBox onSelect={handleSearchSelect} />
            </div>
          )}

          {/* 시장 선택 */}
          <div className="form-field">
            <label>시장</label>
            <select value={form.market} onChange={handleMarketChange} style={INPUT_STYLE} disabled={isEdit}>
              <option value="US">🇺🇸 미국 주식 (US)</option>
              <option value="KR">🇰🇷 국내 주식 (KR)</option>
            </select>
          </div>

          {/* KR: 거래소 선택 */}
          {isKR && (
            <div className="form-field">
              <label>거래소</label>
              <select value={form.exchange || 'KS'} onChange={set('exchange')} style={INPUT_STYLE} disabled={isEdit}>
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
              placeholder={isKR ? '6자리 종목코드 (예: 005930)' : '티커 (예: NFLX)'}
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
                <label>평균 매입가 ({isKR ? '₩' : '$'})</label>
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

import { useState, useEffect, useRef } from 'react'
import api from '../api'
import { useAuth } from '../contexts/AuthContext'

const HOLDING_EMPTY = { ticker: '', name: '', quantity: '', avg_cost: '', target_price: '', stop_price: '', competitors: '', moat: '', growth_plan: '', market: 'US', exchange: '', security_type: 'EQUITY' }
const WATCHLIST_EMPTY = { ticker: '', name: '', competitors: '', moat: '', growth_plan: '', market: 'US', exchange: '', security_type: 'EQUITY' }

const INPUT_STYLE = {
  width: '100%', padding: '6px 10px', background: 'var(--bg-elev)',
  border: '1px solid var(--border)', borderRadius: 4, color: 'var(--text)', fontSize: 13, boxSizing: 'border-box',
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
  const justSelected = useRef(false)

  useEffect(() => {
    if (justSelected.current) { justSelected.current = false; return }
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
    justSelected.current = true
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
        <span style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-3)', fontSize: 14, pointerEvents: 'none' }}>
          {loading ? '⏳' : '🔍'}
        </span>
      </div>
      {open && results.length > 0 && (
        <div style={{
          position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 9999,
          background: 'var(--bg-elev)', border: '1px solid var(--border)', borderRadius: 4,
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
              onMouseEnter={e => e.currentTarget.style.background = 'var(--surface-hover)'}
              onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
            >
              <span style={{
                fontSize: 9, padding: '1px 4px', borderRadius: 2, flexShrink: 0,
                background: item.market === 'KR' ? 'var(--tag-hold-bg)'  : 'var(--tag-track-bg)',
                color:      item.market === 'KR' ? 'var(--tag-hold-color)' : 'var(--tag-track-color)',
                border: `1px solid ${item.market === 'KR' ? 'var(--tag-hold-border)' : 'var(--tag-track-border)'}`,
              }}>
                {item.market === 'KR' ? '🇰🇷' : '🇺🇸'}
              </span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, color: 'var(--text)', fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {item.name}
                </div>
                <div style={{ fontSize: 10, color: 'var(--text-3)', marginTop: 1 }}>
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
  const { role } = useAuth()
  const isAdmin = role === 'admin'
  const empty = mode === 'watchlist' ? WATCHLIST_EMPTY : HOLDING_EMPTY
  const [form, setForm] = useState(empty)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState('')
  const isEdit = !!stock
  const mouseDownOnOverlay = useRef(false)

  useEffect(() => {
    if (stock) {
      setForm({ ...empty, ...stock, competitors: stock.competitors?.join(', ') || '', market: stock.market || 'US', exchange: stock.exchange || '', target_price: stock.target_price ?? '', stop_price: stock.stop_price ?? '' })
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
      security_type: item.security_type || 'EQUITY',
    }))
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    const ticker = form.market === 'KR'
      ? form.ticker.trim().replace(/\D/g, '').padStart(6, '0')
      : form.ticker.trim().toUpperCase()
    // 일반 사용자: 숨겨진 필드는 기존 값 유지 (없으면 빈 값)
    // moat/growth_plan(구조화 분석)은 모달에서 편집하지 않으며 서버가 기존 값을 보존한다.
    const competitors = isAdmin
      ? form.competitors.split(',').map(s => s.trim().toUpperCase()).filter(Boolean)
      : (isEdit && Array.isArray(stock.competitors) ? stock.competitors : [])
    const base = {
      ticker,
      name: form.name.trim(),
      competitors,
      market: form.market,
      exchange: form.market === 'KR' ? (form.exchange || 'KS') : '',
      security_type: form.security_type || 'EQUITY',
    }
    setSaving(true)
    setSaveError('')
    try {
      if (mode === 'holding') {
        await onSave({
          ...base,
          quantity: parseFloat(form.quantity),
          avg_cost: parseFloat(form.avg_cost),
          target_price: form.target_price !== '' ? parseFloat(form.target_price) : null,
          stop_price: form.stop_price !== '' ? parseFloat(form.stop_price) : null,
        })
      } else {
        await onSave(base)
      }
    } catch (err) {
      setSaving(false)
      setSaveError(err?.response?.data?.detail || '저장에 실패했습니다. 다시 시도해 주세요.')
    }
  }

  const isKR = form.market === 'KR'
  const title = mode === 'watchlist' ? (isEdit ? '관심종목 수정' : '관심종목 추가') : (isEdit ? '종목 수정' : '종목 추가')

  return (
    <div className="modal-overlay"
      onMouseDown={e => { mouseDownOnOverlay.current = e.target === e.currentTarget }}
      onClick={() => { if (mouseDownOnOverlay.current) onClose() }}
    >
      <div className="modal" onClick={e => e.stopPropagation()}>
        <h2>{title}</h2>
        <form onSubmit={handleSubmit}>

          {/* 종목 검색 (신규 추가 시에만) */}
          {!isEdit && (
            <div className="form-field">
              <label>종목 검색 <span style={{ color: 'var(--text-3)', fontSize: 10, fontWeight: 400 }}>(종목명·티커·종목코드)</span></label>
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
              <div className="form-field">
                <label>목표가 (선택, {isKR ? '₩' : '$'})</label>
                <input type="number" value={form.target_price} onChange={set('target_price')} step={isKR ? '1' : '0.01'} placeholder="익절 목표가" style={INPUT_STYLE} />
              </div>
              <div className="form-field">
                <label>손절가 (선택, {isKR ? '₩' : '$'})</label>
                <input type="number" value={form.stop_price} onChange={set('stop_price')} step={isKR ? '1' : '0.01'} placeholder="손절 기준가" style={INPUT_STYLE} />
              </div>
            </>
          )}

          {/* 경쟁사 — admin 전용. 해자/성장계획 등 구조화 분석은 리포트·Claude Cowork에서 관리 */}
          {isAdmin && (
            <div className="form-field">
              <label>경쟁사 {isKR ? '(종목코드, 쉼표 구분)' : '(티커, 쉼표 구분)'}</label>
              <input type="text" value={form.competitors} onChange={set('competitors')} style={INPUT_STYLE} />
            </div>
          )}

          {saveError && (
            <p style={{ color: 'var(--color-error)', fontSize: 13, marginTop: 12, marginBottom: 0 }}>{saveError}</p>
          )}
          <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
            <button type="submit" className="btn btn-primary" disabled={saving}>
              {saving ? '저장 중…' : '저장'}
            </button>
            <button type="button" className="btn" onClick={onClose} disabled={saving}>취소</button>
          </div>
        </form>
      </div>
    </div>
  )
}

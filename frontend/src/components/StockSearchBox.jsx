import { useState, useEffect, useRef } from 'react'
import api from '../api'

// StockModal·전역 검색(GlobalSearch)이 공유하는 종목 검색 입력+드롭다운.
// /api/stocks/search(ALL) 호출·디바운스·바깥클릭 닫기 포함. onSelect(item)로 선택 항목 콜백
// (item shape: {ticker, name, market, exchange, exchange_display, security_type}).

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

export default function StockSearchBox({ onSelect, placeholder = '종목명 또는 티커로 검색...', autoFocus = false }) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState(null)   // null = 현재 검색어로 아직 조회 안 함
  const [loading, setLoading] = useState(false)
  const [open, setOpen] = useState(false)
  const debouncedQuery = useDebounce(query, 350)
  const boxRef = useRef(null)
  const justSelected = useRef(false)
  // 검색어 가드(B49, task#379) — 응답은 자기 검색어가 지금 입력된 검색어일 때만 결과·로딩을 만진다.
  // 디바운스 대기 중(입력은 바뀌었는데 이펙트는 아직)에 착지하는 옛 응답까지 막으려면
  // 이펙트 cleanup이 아니라 최신 입력과 비교해야 한다.
  const latestQuery = useRef('')

  useEffect(() => {
    if (justSelected.current) { justSelected.current = false; return }
    if (!debouncedQuery.trim()) { setResults(null); setOpen(false); setLoading(false); return }
    const q = debouncedQuery
    // 새 검색어로 요청이 나갈 때 옛 결과를 비운다(키 입력마다 비우면 디바운스 창 안에서
    // 직전 검색어로 되돌아갈 때 디바운스 값이 안 바뀌어 재조회 없이 빈 채로 남는다).
    setResults(null)
    setLoading(true)
    // 항상 ALL로 검색 — 결과 선택 시 market/exchange 자동 설정
    api.get('/api/stocks/search', { params: { q, market: 'ALL' } })
      .then(r => { if (q !== latestQuery.current) return; setResults(r.data); setOpen(r.data.length > 0) })
      .catch(() => { if (q === latestQuery.current) setResults(null) })
      .finally(() => { if (q === latestQuery.current) setLoading(false) })
  }, [debouncedQuery])

  useEffect(() => {
    const handler = (e) => { if (boxRef.current && !boxRef.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const handleSelect = (item) => {
    justSelected.current = true
    latestQuery.current = item.name
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
          onChange={e => { latestQuery.current = e.target.value; setQuery(e.target.value); setOpen(true) }}
          onFocus={() => results?.length > 0 && setOpen(true)}
          placeholder={placeholder}
          style={{ ...INPUT_STYLE, paddingRight: 32 }}
          autoComplete="off"
          autoFocus={autoFocus}
        />
        <span style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-3)', fontSize: 14, pointerEvents: 'none' }}>
          {loading ? '⏳' : '🔍'}
        </span>
      </div>
      {open && results?.length > 0 && (
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

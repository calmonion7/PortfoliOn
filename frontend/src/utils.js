export const TAB_STYLE = (active) => ({
  padding: '6px 14px',
  cursor: 'pointer',
  border: 'none',
  borderBottom: active ? '2px solid var(--accent)' : '2px solid transparent',
  background: 'transparent',
  color: active ? 'var(--accent)' : 'var(--text-muted)',
  fontWeight: active ? 600 : 400,
  fontSize: 13,
})

export const fmtPrice = (val, market) => {
  if (val == null) return 'N/A'
  if (market === 'KR') return `₩${Number(val).toLocaleString('ko-KR', { maximumFractionDigits: 0 })}`
  return `$${Number(val).toFixed(2)}`
}

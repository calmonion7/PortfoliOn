export const fmtPrice = (val, market) => {
  if (val == null || !Number.isFinite(Number(val))) return '—'
  if (market === 'KR') return `₩${Number(val).toLocaleString('ko-KR', { maximumFractionDigits: 0 })}`
  return `$${Number(val).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

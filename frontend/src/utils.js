export const fmtPrice = (val, market) => {
  if (val == null) return 'N/A'
  if (market === 'KR') return `₩${Number(val).toLocaleString('ko-KR', { maximumFractionDigits: 0 })}`
  return `$${Number(val).toFixed(2)}`
}

export const krFmt = v => {
  if (v == null) return '-'
  if (Math.abs(v) >= 10000) return `${(v / 10000).toFixed(1)}조`
  return `${Math.round(v).toLocaleString()}억`
}

export const isEstimated = q => {
  if (!q) return false
  const [y, qn] = q.split('Q')
  const endMonth = parseInt(qn) * 3
  return new Date(parseInt(y), endMonth, 0) > new Date()
}

export const CARD_STYLE = {
  background: 'var(--bg-elev)',
  border: '1px solid var(--border)',
  borderRadius: 6,
  padding: '12px 16px',
}

export const SECTION_STYLE = { marginBottom: 40 }

export const SECTION_HEADER_STYLE = {
  color: 'var(--text)',
  fontSize: 16,
  fontWeight: 600,
  marginBottom: 6,
  borderBottom: '1px solid var(--border)',
  paddingBottom: 8,
}

export const DESC_STYLE = {
  fontSize: 12,
  color: 'var(--text-3)',
  marginBottom: 16,
  lineHeight: 1.6,
}

export function LoadingBox() {
  return (
    <div style={{ ...CARD_STYLE, color: 'var(--text-3)', fontSize: 13, padding: 24 }}>
      데이터 수집 중입니다. 처음 로드 시 수분 소요될 수 있습니다...
    </div>
  )
}

export function ErrorBox({ msg }) {
  return (
    <div style={{ ...CARD_STYLE, color: '#e57373', fontSize: 13, padding: 16 }}>
      {msg || '데이터를 불러오지 못했습니다.'}
    </div>
  )
}

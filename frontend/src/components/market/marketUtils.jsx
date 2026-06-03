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

export const SECTION_CONTENT_STYLE = {
  padding: 16,
  background: 'var(--bg)',
}

const SECTION_CARD_OUTER = {
  border: '1px solid var(--border)',
  borderRadius: 12,
  overflow: 'hidden',
  marginBottom: 12,
  background: 'var(--bg-elev)',
}

export function SectionCard({ title, summary, change, changeSuffix = '', changeInverted = false, open, onToggle, children }) {
  const changeColor = change == null ? null
    : change === 0 ? 'var(--text-3)'
    : (change > 0) !== changeInverted ? '#81c784' : '#e57373'
  const changeArrow = change > 0 ? '▲' : change < 0 ? '▼' : '─'
  const decimals = changeSuffix === 'bp' ? 1 : 2

  return (
    <div style={SECTION_CARD_OUTER}>
      <button
        onClick={onToggle}
        style={{
          width: '100%',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          padding: '14px 16px',
          background: 'none',
          border: 'none',
          borderBottom: open ? '1px solid var(--border)' : 'none',
          cursor: 'pointer',
          textAlign: 'left',
        }}
      >
        <span style={{ fontSize: 15, fontWeight: 600, color: 'var(--text)' }}>{title}</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
          {summary && <span style={{ fontSize: 12, color: 'var(--text-3)', fontVariantNumeric: 'tabular-nums' }}>{summary}</span>}
          {change != null && (
            <span style={{ fontSize: 11, color: changeColor, fontVariantNumeric: 'tabular-nums' }}>
              {changeArrow} {Math.abs(change).toFixed(decimals)}{changeSuffix}
            </span>
          )}
          <span style={{ fontSize: 10, color: 'var(--text-3)' }}>{open ? '∧' : '∨'}</span>
        </div>
      </button>
      {open && <div style={SECTION_CONTENT_STYLE}>{children}</div>}
    </div>
  )
}

export function SectionCardLoading({ title }) {
  return (
    <div style={SECTION_CARD_OUTER}>
      <div style={{ padding: '14px 16px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ fontSize: 15, fontWeight: 600, color: 'var(--text)' }}>{title}</span>
        <span style={{ fontSize: 12, color: 'var(--text-3)' }}>…</span>
      </div>
      <div style={SECTION_CONTENT_STYLE}><LoadingBox /></div>
    </div>
  )
}

export function SectionCardError({ title }) {
  return (
    <div style={SECTION_CARD_OUTER}>
      <div style={{ padding: '14px 16px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ fontSize: 15, fontWeight: 600, color: 'var(--text)' }}>{title}</span>
        <span style={{ fontSize: 12, color: '#e57373' }}>오류</span>
      </div>
      <div style={SECTION_CONTENT_STYLE}><ErrorBox /></div>
    </div>
  )
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

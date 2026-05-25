export default function LoadingSpinner({ label = '로딩 중...', size = 28, style = {} }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 10, padding: 40, ...style }}>
      <div style={{
        width: size, height: size,
        borderRadius: '50%',
        border: `3px solid var(--border)`,
        borderTopColor: 'var(--accent)',
        animation: 'spin 0.8s linear infinite',
        flexShrink: 0,
      }} />
      {label && <span style={{ color: 'var(--text-muted)', fontSize: 13 }}>{label}</span>}
    </div>
  )
}

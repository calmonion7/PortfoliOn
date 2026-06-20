import './Skeleton.css'

// Pulse-animated loading placeholders that reserve layout space to avoid CLS.
// variant: card | row | chart | calendar | stat | text
export default function Skeleton({
  variant = 'text',
  count = 1,
  lines = 3,
  height = 240,
  className = '',
}) {
  const block = (key, style) => (
    <div key={key} className="skeleton-block" style={style} aria-hidden="true" />
  )

  let content
  let wrapperClass

  switch (variant) {
    case 'card':
      wrapperClass = 'skeleton-cards'
      content = Array.from({ length: count }, (_, i) => block(i))
      break

    case 'row':
      wrapperClass = 'skeleton-rows'
      content = Array.from({ length: count }, (_, i) => block(i))
      break

    case 'chart':
      wrapperClass = 'skeleton-chart skeleton-block'
      content = null
      break

    case 'calendar':
      wrapperClass = 'skeleton-calendar'
      content = Array.from({ length: 35 }, (_, i) => block(i))
      break

    case 'stat':
      wrapperClass = 'skeleton-stats'
      content = Array.from({ length: count }, (_, i) => block(i))
      break

    case 'text':
    default:
      wrapperClass = 'skeleton-text'
      content = Array.from({ length: lines }, (_, i) => block(i))
      break
  }

  if (variant === 'chart') {
    return (
      <div
        className={`${wrapperClass} ${className}`.trim()}
        style={{ height }}
        aria-hidden="true"
      />
    )
  }

  const style =
    variant === 'stat' ? { '--skeleton-stat-cols': count } : undefined

  return (
    <div className={`${wrapperClass} ${className}`.trim()} style={style}>
      {content}
    </div>
  )
}

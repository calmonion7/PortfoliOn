import './Badge.css'

const variantClass = {
  neutral: 'badge--neutral',
  success: 'badge--success',
  danger: 'badge--danger',
  up: 'badge--up',
  down: 'badge--down',
  warning: 'badge--warning',
  info: 'badge--info',
  'market-kr': 'badge--market-kr',
  'market-us': 'badge--market-us',
}

export default function Badge({ variant = 'neutral', size = 'sm', icon = null, className = '', children, ...props }) {
  const classes = ['badge', variantClass[variant] ?? 'badge--neutral', `badge--${size}`, className].join(' ')
  return (
    <span className={classes} {...props}>
      {icon && <span className="badge__icon">{icon}</span>}
      {children}
    </span>
  )
}

export function MarketBadge({ market, exchange = '' }) {
  const isKR = market === 'KR'
  const krLabel = exchange === 'KS' ? 'KOSPI' : exchange === 'KQ' ? 'KOSDAQ' : 'KR'
  return (
    <Badge variant={isKR ? 'market-kr' : 'market-us'}>
      {isKR ? `🇰🇷 ${krLabel}` : '🇺🇸 US'}
    </Badge>
  )
}

export function ChangeBadge({ value, suffix = '%', size = 'sm' }) {
  if (value == null) return <Badge variant="neutral" size={size}>—</Badge>
  const variant = value >= 0 ? 'up' : 'down' // KR 가격색 관례 — 의미색(success/danger) 아님
  const arrow = value >= 0 ? '▲' : '▼'
  return (
    <Badge variant={variant} size={size}>
      {arrow} {Math.abs(value).toFixed(1)}{suffix}
    </Badge>
  )
}

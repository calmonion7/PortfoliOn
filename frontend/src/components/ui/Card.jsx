import './Card.css'

const paddingClass = { none: 'card--p-none', sm: 'card--p-sm', md: 'card--p-md', lg: 'card--p-lg' }

export default function Card({
  padding = 'md',
  hover = false,
  elevated = false,
  as: As = 'div',
  className = '',
  children,
  ...props
}) {
  const classes = [
    'card',
    paddingClass[padding],
    hover && 'card--hover',
    elevated && 'card--elevated',
    className,
  ].filter(Boolean).join(' ')

  return <As className={classes} {...props}>{children}</As>
}

export function CardHeader({ title, subtitle, action, className = '' }) {
  return (
    <div className={`card__header ${className}`}>
      <div>
        {title && <h3 className="card__title">{title}</h3>}
        {subtitle && <p className="card__subtitle">{subtitle}</p>}
      </div>
      {action && <div className="card__action">{action}</div>}
    </div>
  )
}

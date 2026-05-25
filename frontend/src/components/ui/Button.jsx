import './Button.css'

const sizeClass = { sm: 'btn--sm', md: 'btn--md', lg: 'btn--lg' }
const variantClass = {
  primary: 'btn--primary',
  secondary: 'btn--secondary',
  ghost: 'btn--ghost',
  danger: 'btn--danger',
}

export default function Button({
  variant = 'primary',
  size = 'md',
  loading = false,
  disabled = false,
  icon = null,
  iconOnly = false,
  fullWidth = false,
  type = 'button',
  className = '',
  children,
  ...props
}) {
  const classes = [
    'btn',
    sizeClass[size],
    variantClass[variant],
    iconOnly && 'btn--icon-only',
    fullWidth && 'btn--full',
    loading && 'btn--loading',
    className,
  ].filter(Boolean).join(' ')

  return (
    <button type={type} className={classes} disabled={disabled || loading} {...props}>
      {loading && <span className="btn__spinner" aria-hidden />}
      {!loading && icon && <span className="btn__icon">{icon}</span>}
      {!iconOnly && <span className="btn__label">{children}</span>}
    </button>
  )
}

import './Stat.css'
import { ChangeBadge } from './Badge'

export default function Stat({
  label,
  value,
  change = null,
  changeSuffix = '%',
  valueColor = null,
  helperText = null,
  size = 'md',
  className = '',
}) {
  const valueColorClass = valueColor ? `stat__value--${valueColor}` : ''
  return (
    <div className={`stat stat--${size} ${className}`}>
      <div className="stat__label">{label}</div>
      <div className={`stat__value tabular ${valueColorClass}`}>{value}</div>
      {(change != null || helperText) && (
        <div className="stat__meta">
          {change != null && <ChangeBadge value={change} suffix={changeSuffix} />}
          {helperText && <span className="stat__helper">{helperText}</span>}
        </div>
      )}
    </div>
  )
}

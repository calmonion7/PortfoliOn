import './Input.css'

export default function Input({
  value,
  onChange,
  placeholder,
  type = 'text',
  className = '',
  style,
  ...rest
}) {
  return (
    <input
      type={type}
      value={value}
      onChange={onChange}
      placeholder={placeholder}
      className={`ui-input ${className}`.trim()}
      style={style}
      {...rest}
    />
  )
}

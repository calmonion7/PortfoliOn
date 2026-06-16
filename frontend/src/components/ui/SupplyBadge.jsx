import Badge from './Badge'

// 수급 종합 스코어 밴드 enum → 표시 매핑(ADR-0014). band enum은 locale-독립 저장값,
// label/variant만 표시용. 결측/US/null은 "해당 없음" muted(neutral + 흐리게).
const BAND_DISPLAY = {
  favorable: { label: '우호', variant: 'success' },
  neutral: { label: '중립', variant: 'neutral' },
  caution: { label: '경계', variant: 'danger' },
}

export default function SupplyBadge({ band, size = 'sm' }) {
  const display = BAND_DISPLAY[band]
  if (!display) {
    return (
      <Badge variant="neutral" size={size} style={{ opacity: 0.5 }}>
        해당 없음
      </Badge>
    )
  }
  return (
    <Badge variant={display.variant} size={size}>
      {display.label}
    </Badge>
  )
}

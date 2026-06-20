import Badge from './Badge'

// 내부자 지분공시 신호 배지(KR 전용). direction enum은 locale-독립 저장값, label/색만 표시용.
// 이 앱은 빨강=상승·파랑=하락(가격 관례)이라 success(--up=빨강)/danger(--down=파랑) 변형은
// 가격 색과 충돌 → 신호는 전용 색을 명시 지정한다(순매수=초록·순매도=주황·중립=회색).
// 결측/US/null은 "해당 없음" muted(neutral + 흐리게). SupplyBadge.jsx와 동일 구조.
const DIR_DISPLAY = {
  buy: { label: '순매수', style: { background: 'var(--semantic-buy-soft)', color: 'var(--semantic-buy)', borderColor: 'var(--semantic-buy)' } },
  sell: { label: '순매도', style: { background: 'var(--semantic-sell-soft)', color: 'var(--semantic-sell)', borderColor: 'var(--semantic-sell)' } },
  neutral: { label: '중립' }, // neutral 변형(회색) 그대로
}

export default function InsiderBadge({ direction, size = 'sm' }) {
  const display = DIR_DISPLAY[direction]
  if (!display) {
    return (
      <Badge variant="neutral" size={size} style={{ opacity: 0.5 }}>
        해당 없음
      </Badge>
    )
  }
  return (
    <Badge variant="neutral" size={size} style={display.style}>
      {display.label}
    </Badge>
  )
}

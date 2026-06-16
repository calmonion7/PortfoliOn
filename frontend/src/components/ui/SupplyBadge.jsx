import Badge from './Badge'

// 수급 종합 스코어 밴드 enum → 표시 매핑(ADR-0014). band enum은 locale-독립 저장값,
// label/색만 표시용. 이 앱은 빨강=상승·파랑=하락(가격 관례)이라 success(--up=빨강)/
// danger(--down=파랑) 변형은 가격 색과 충돌 → 밴드는 전용 색을 명시 지정한다
// (우호=초록·중립=회색·경계=주황). 결측/US/null은 "해당 없음" muted(neutral + 흐리게).
const BAND_DISPLAY = {
  favorable: { label: '우호', style: { background: 'rgba(76, 175, 80, 0.14)', color: '#4caf50', borderColor: 'rgba(76, 175, 80, 0.30)' } },
  neutral: { label: '중립' }, // neutral 변형(회색) 그대로
  caution: { label: '경계', style: { background: 'rgba(245, 124, 0, 0.16)', color: '#f57c00', borderColor: 'rgba(245, 124, 0, 0.32)' } },
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
    <Badge variant="neutral" size={size} style={display.style}>
      {display.label}
    </Badge>
  )
}

import Badge from './Badge'

// 수급 종합 스코어 밴드 enum → 표시 매핑(ADR-0014). band enum은 locale-독립 저장값,
// label/색만 표시용. 이 앱은 빨강=상승·파랑=하락(가격 관례)이라 success(--up=빨강)/
// danger(--down=파랑) 변형은 가격 색과 충돌 → 밴드는 전용 색을 명시 지정한다
// (우호=초록·중립=회색·경계=주황). 결측/US/null은 "해당 없음"(neutral 기본색, 대비 AA 확보 위해 흐림 제거 — task#177 F26).
const BAND_DISPLAY = {
  favorable: { label: '우호', style: { background: 'var(--color-success-soft)', color: 'var(--color-success)', borderColor: 'var(--color-success)' } },
  neutral: { label: '중립' }, // neutral 변형(회색) 그대로
  caution: { label: '경계', style: { background: 'var(--warn-soft)', color: 'var(--warn)', borderColor: 'var(--warn)' } },
}

export default function SupplyBadge({ band, size = 'sm' }) {
  const display = BAND_DISPLAY[band]
  if (!display) {
    return (
      <Badge variant="neutral" size={size}>
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

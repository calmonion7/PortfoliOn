import Badge from './Badge'

// 구루 분기 활동 배지(US 13F). kind enum은 locale-독립 저장값, label/기호/색만 표시용.
// 이 앱은 빨강=상승·파랑=하락(가격 관례)이라 up(--up=빨강)/down(--down=파랑) 변형은 가격 색과
// 충돌 → 매매 방향은 전용 색을 명시 지정한다(매수=초록·매도=주황).
// InsiderBadge.jsx(순매수/순매도)와 동일 구조이며 같은 --semantic-buy/--semantic-sell 토큰을 쓴다.
const BUY = { background: 'var(--semantic-buy-soft)', color: 'var(--semantic-buy)', borderColor: 'var(--semantic-buy)' }
const SELL = { background: 'var(--semantic-sell-soft)', color: 'var(--semantic-sell)', borderColor: 'var(--semantic-sell)' }

const KIND_DISPLAY = {
  buy: { label: '신규', mark: '★', style: BUY },
  add: { label: '추가', mark: '▲', style: BUY },
  reduce: { label: '축소', mark: '▼', style: SELL },
  sold_out: { label: '매도', mark: '✕', style: SELL },
}

// kind가 없거나 미지의 값이면 아무것도 렌더하지 않는다(graceful) — 활동 없는 종목이 표본의 18%다.
export default function GuruActivityBadge({ kind, size = 'sm' }) {
  const display = KIND_DISPLAY[kind]
  if (!display) return null
  return (
    <Badge variant="neutral" size={size} style={display.style} data-activity={kind}>
      {display.mark} {display.label}
    </Badge>
  )
}

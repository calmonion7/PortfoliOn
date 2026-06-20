import Card from '../ui/Card'
import Badge, { MarketBadge } from '../ui/Badge'

// 근거 플래그 칩 색 — ⚠️ 가격 토큰(success=빨/danger=파, ADR-0015) 금지.
// SupplyBadge식으로 neutral Badge에 kind별 전용색을 명시 지정한다.
// kind enum은 백엔드 derive_flags 출력(value/momentum/smart_money/missing).
const FLAG_STYLE = {
  value:       { background: 'var(--color-info-soft)',    color: 'var(--color-info)',    borderColor: 'var(--color-info-soft)' },    // 밸류 — 정보(블루)
  momentum:    { background: 'var(--warn-soft)',          color: 'var(--warn)',          borderColor: 'var(--warn-soft)' },          // 모멘텀 — 경계(주황)
  smart_money: { background: 'var(--semantic-buy-soft)',  color: 'var(--semantic-buy)',  borderColor: 'var(--semantic-buy-soft)' },  // 스마트머니 — 시맨틱 buy(초록)
  missing:     { background: 'var(--bg-elev-2)',          color: 'var(--text-3)',        borderColor: 'var(--border)' },             // 데이터 부족 — 회색 muted
}

const fmtScore = (s) => (s == null ? null : Number(s).toFixed(1))

// 추천 카드(발굴/관심 공유). footer는 선택 액션 영역(없으면 미렌더).
export default function RecCard({ item, footer = null }) {
  const score = fmtScore(item.score)
  return (
    <Card padding="sm" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {/* 헤더: 종목명/티커 + 시장 배지 */}
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <span style={{ display: 'block', color: 'var(--text)', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.name || item.ticker}</span>
          <span style={{ display: 'block', fontSize: 10, color: 'var(--text-3)' }}>{item.ticker}</span>
        </div>
        <MarketBadge market={item.market} exchange={item.exchange} />
      </div>

      {/* 추천 점수 */}
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
        {score != null ? (
          <>
            <span style={{ color: 'var(--accent)', fontWeight: 700, fontSize: 20, fontVariantNumeric: 'tabular-nums' }}>{score}</span>
            <span style={{ fontSize: 11, color: 'var(--text-3)' }}>점</span>
          </>
        ) : (
          <span style={{ fontSize: 12, color: 'var(--text-3)' }}>점수 대기</span>
        )}
      </div>

      {/* 근거 플래그 칩 */}
      {item.flags && item.flags.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
          {item.flags.map((flag, j) => (
            <Badge key={j} variant="neutral" style={FLAG_STYLE[flag.kind] || FLAG_STYLE.missing}>
              {flag.label}
            </Badge>
          ))}
        </div>
      )}

      {/* 선택 액션(딥다이브 등). 발굴 섹션만 주입, 관심 섹션은 없음. */}
      {footer}
    </Card>
  )
}

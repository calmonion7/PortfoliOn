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
// guruCount = 이 종목을 top10에 담은 US 13F 구루 수(부모가 /api/guru/managers 역인덱스로 주입).
export default function RecCard({ item, footer = null, guruCount = 0 }) {
  const score = fmtScore(item.score)
  return (
    <Card padding="sm" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {/* 헤더: 종목명/티커 + 시장 배지 */}
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <span style={{ display: 'block', color: 'var(--text)', fontWeight: 700, fontSize: 16, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.name || item.ticker}</span>
          <span style={{ display: 'block', fontSize: 10, color: 'var(--text-3)' }}>{item.ticker}</span>
        </div>
        <MarketBadge market={item.market} exchange={item.exchange} />
      </div>

      {/* 추천 점수 */}
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
        {score != null ? (
          <>
            <span style={{ color: 'var(--text-2)', fontWeight: 600, fontSize: 14, fontVariantNumeric: 'tabular-nums' }}>{score}</span>
            <span style={{ fontSize: 11, color: 'var(--text-3)' }}>점</span>
          </>
        ) : (
          <span style={{ fontSize: 12, color: 'var(--text-3)' }}>점수 대기</span>
        )}
      </div>

      {/* 근거 플래그 칩 */}
      {item.flags && item.flags.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
          {item.flags.map((flag, j) => {
            // 구루 칩 제자리 교체: 백엔드 이진 "구루 신규 매수"(실제론 top10 보유 멤버십)를
            // 라이브 보유 개수로. guruCount<1(미로딩·fetch 실패·미보유)이면 원본 유지(graceful).
            // ⚠️ 라벨 문자열 결합 — backend/services/recommendation/scoring.py 의 "구루 신규 매수"
            //    라벨을 바꾸면 이 매처도 함께 갱신할 것.
            const label = (flag.label === '구루 신규 매수' && guruCount >= 1)
              ? `구루 ${guruCount}명 보유`
              : flag.label
            return (
              <Badge key={j} variant="neutral" style={FLAG_STYLE[flag.kind] || FLAG_STYLE.missing}>
                {label}
              </Badge>
            )
          })}
        </div>
      )}

      {/* 선택 액션(딥다이브 등). 발굴 섹션만 주입, 관심 섹션은 없음. */}
      {footer}
    </Card>
  )
}

import Card from '../ui/Card'
import Stat from '../ui/Stat'
import { deriveTechKpis } from '../reports/techReportUtils'

// 선도기술 리포트 KPI 스트립(task#280 S2) — 헤더 직하에서 결론·지표가 첫 화면에 잡히게 하는 요약 레이어.
// 파생은 전부 deriveTechKpis가 한다(결측은 —, 산문에서 수치를 긁지 않는다 — ADR-0033 결정 3).
// 여기는 표시만 하며 값 계산을 두지 않는다(폰트 분기도 파생값의 `text` 플래그가 지시한다).
//
// ⚠️ valueColor를 넘기지 않는다 — Stat은 `stat__value--${valueColor}`로 클래스를 *문자열 조립*하므로
//    CSS에 없는 값을 받아도 아무도 죽지 않고 색만 조용히 사라진다(가토 ⑪). Stat.css에는 가격 방향
//    전용 --up/--down만 있고 의미 variant가 없다. 여기 6칩은 전부 중립 수치라 색 자체가 불필요하다.
//
// 레이아웃은 **고정 트랙 그리드가 아니라 내용 주도 flex-wrap**이다(task#280 적대리뷰 F2).
//    옛 구현은 `repeat(auto-fit, minmax(180px, 1fr))`였고 그 180px의 근거는 "최장 값 = 시장 규모
//    `$7.5B → $17.4B` ≈ 158px"였다. **그 전제가 실데이터에서 틀렸다** — 라이브 SMR의 선두 칩은
//    `CNNC (중국핵공업집단) +1`이고 18px 값 폰트로 ASCII 10자(≈10.8px/자) + 한글 7자(전각 ≈18px/자)
//    = **약 234px**다(한글을 라틴 폭으로 재면 여기서 14% 과소평가한다 — 가토 ④ⓒ). 즉 180px 트랙은
//    PC 3열(229px)에서조차 선두 칩을 2줄로 접고 있었고, 모바일 350(카드 안쪽 244px)에서는 1열로
//    떨어져 스트립 높이가 332px까지 부풀어 첫 화면을 벗어났다.
//    ⚠️ 값 문자열은 발행 데이터(회사명)라 자를 수도 줄일 수도 없다 → **트랙을 값에 맞추는 게 아니라
//    폭을 값에서 받아야** 한다. flex 항목의 `flex-basis: auto`는 max-content로 해석되고, wrap은
//    한 줄에 max-content 합이 들어가는 만큼만 담으므로 **값이 컨테이너보다 좁은 한 절대 접히지 않는다**
//    (컨테이너보다 넓어지면 그 칩만 단독 줄에서 접힌다 — 넘침이 아니라 접힘으로 graceful).
//    실측 기반 계산(칩 1행 높이 43.7px · gap 14):
//      · m350 카드 안쪽 244px → 4행 ≈ 217px (종전 1열 6행 332px)
//      · m390 카드 안쪽 284px → 3~4행 ≈ 159~217px (선두 칩 폭이 경계에 걸린다)
//      · PC 카드 안쪽 714px  → 6칩 합 ≈ 600px + gap 70 = 670px → **1행 ≈ 44px**
const STRIP = { display: 'flex', flexWrap: 'wrap', gap: 14 }
// 줄에 남는 폭은 그 줄의 칩들이 나눠 가진다(빈 칸을 남기지 않는다). 폭 하한은 주지 않는다 —
// 하한을 주는 순간 다시 "값보다 좁은 상자"가 생겨 접힘이 돌아온다.
const CHIP = { flex: '1 1 auto' }
// 회사명 칩만 일반 폰트(F13). ui/Stat은 다른 소비처가 있는 수치 프리미티브라 Stat을 고치지 않고
// 여기서 값 노드에 인라인으로 덮는다(인라인 > 클래스라 `.stat__value`의 mono·tabular를 이긴다).
const TEXT_VALUE = { fontFamily: 'var(--font-sans)', fontVariantNumeric: 'normal' }

export default function TechKpiStrip({ report }) {  // report: 발행물 1건 (null/undefined면 전 칩 —)
  return (
    <Card padding="md">
      <div data-testid="tech-report-kpis" style={STRIP}>
        {deriveTechKpis(report).map((c) => (
          <div key={c.label} style={CHIP}>
            <Stat size="sm" label={c.label}
              value={c.text ? <span style={TEXT_VALUE}>{c.value}</span> : c.value} />
          </div>
        ))}
      </div>
    </Card>
  )
}

// 선도기술 리포트(ADR-0033, task#282 S2) — 기관별 시장규모 추정치 가로 막대.
// 순수 표시 컴포넌트(fetch 없음). props: estimates(report.market?.estimates 배열 그대로).
// 백엔드 MarketEstimate 계약(routers/tech_reports.py): institution·year·size{value,currency,unit}·scope?·is_basis?
// — currency/unit/year는 배열 내 전부 동일하도록 서버가 이미 강제하므로 프론트는 환산하지 않는다
// (ShareChart.jsx·MarketGrowthChart.jsx와 같은 ADR-0031 규율 — formatMarketSize가 입력 단위 그대로 표시).

import { formatMarketSize } from '../reports/techReportUtils.js'

// estimates[] → 렌더 가능한 정렬 목록 + 파생값. 컴포넌트와 페이지 게이트가 이 함수 하나를 공유한다
// (MilestoneTimeline.jsx의 milestoneTimelineLayout과 같은 패턴 — 느슨한 자체 판정을 페이지가 따로
// 구현하면 필터 결과가 어긋나 제목만 남는 회귀가 난다, task#281 선례).
// 값 내림차순. size.value가 유한하지 않거나 음수인 항목은 제외(wrong<missing).
export function marketEstimatesLayout(estimates) {
  const rows = (Array.isArray(estimates) ? estimates : [])
    .filter((e) => e && e.size && Number.isFinite(e.size.value) && e.size.value >= 0)
    .sort((a, b) => b.size.value - a.size.value)

  if (rows.length === 0) return { rows, year: null, max: 0, multiplierTxt: null }

  const year = rows[0].year
  const max = rows[0].size.value
  const min = rows[rows.length - 1].size.value
  // min<=0이거나 1건뿐이면 배수가 Infinity/무의미 — 문구를 생략한다(wrong<missing).
  const multiplierTxt = rows.length > 1 && min > 0 ? `${(max / min).toFixed(1)}배` : null

  return { rows, year, max, multiplierTxt }
}

export default function MarketEstimates({ estimates }) {
  const { rows, year, max, multiplierTxt } = marketEstimatesLayout(estimates)
  if (rows.length === 0) return null

  return (
    <div data-testid="market-estimates" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {rows.map((e, i) => {
        const label = e.scope ? `${e.institution} · ${e.scope}` : e.institution
        const sizeTxt = formatMarketSize(e.size) ?? '—'
        const widthPct = max > 0 ? (e.size.value / max) * 100 : 0
        return (
          <div key={`${e.institution}-${i}`} data-testid="market-estimate-row" style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
            {/* 기관명+scope만 ellipsis(줄어도 되는 것) — 값·기준 마커는 flexShrink:0 형제로 고정(가토 축2) */}
            <span title={label} style={{ width: 120, flexShrink: 0, fontSize: 12, color: 'var(--text-2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {label}
            </span>
            <div style={{ flex: 1, minWidth: 0, height: 14, background: 'var(--bg-elev-2)', borderRadius: 3, overflow: 'hidden' }}>
              <div data-testid="market-estimate-bar" style={{ width: `${widthPct}%`, height: '100%', background: 'var(--data-1)', borderRadius: 3 }} />
            </div>
            <span className="mono tnum" style={{ flexShrink: 0, whiteSpace: 'nowrap', fontSize: 12, fontWeight: 700, color: 'var(--text)' }}>
              {sizeTxt}
            </span>
            {e.is_basis === true && (
              <span
                data-testid="market-estimate-basis-marker"
                title="성장 곡선이 채택한 기관"
                style={{ flexShrink: 0, fontSize: 10, fontWeight: 700, color: 'var(--accent)', border: '1px solid var(--accent)', borderRadius: 3, padding: '0 4px', whiteSpace: 'nowrap' }}
              >
                기준
              </span>
            )}
          </div>
        )
      })}
      <p data-testid="market-estimates-caption" style={{ fontSize: 11, color: 'var(--text-3)', margin: '4px 0 0' }}>
        기관별 {year}년 추정{multiplierTxt && ` · 최대·최소 ${multiplierTxt}`}
      </p>
    </div>
  )
}

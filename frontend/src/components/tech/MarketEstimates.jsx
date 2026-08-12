// 주요기술 리포트(ADR-0033, task#282 S2) — 기관별 시장규모 추정치 가로 막대.
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

  // ⚠️ 트랙(flex:1)이 흡수하는 잔여폭이 행마다 다르면 `width:N%`의 기준이 행마다 달라져 **더 작은 값이
  // 더 긴 막대**가 된다 — 라이브 실측에서 정확히 그랬다($12.5B→75.98px vs $9B→84.86px, 트랙
  // [153,103,160,146,160]). 원인은 ① 값 문자열의 자연폭이 행마다 다르고($9B < $12.5B) ② `기준` 마커가
  // 한 행에만 있다는 것. 그래서 값·마커가 먹는 폭을 **행 전체에서 균일하게 예약**한다.
  // 폭은 상수로 추정하지 않고 데이터에서 파생한다(task#281 COL_W 처방) — 서버가 배열 내 currency·unit
  // 동일을 강제하므로(Market._estimates_consistency) 값 문자열은 자릿수만 다르고, mono 폰트에서 1글자=1ch다.
  // jsdom엔 레이아웃이 없어 vitest는 이 px 불변식을 원리적으로 못 잰다 — 게이트는 라이브 프로브의
  // est-bar-monotonic이고, vitest는 그 구조적 대리지표(폭 선언이 행마다 동일 · 마커 슬롯이 전 행에 존재)를 본다.
  const sizeTexts = rows.map((e) => formatMarketSize(e.size) ?? '—')
  const valueCh = Math.max(...sizeTexts.map((s) => s.length))
  const anyBasis = rows.some((e) => e.is_basis === true)

  return (
    <div data-testid="market-estimates" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {rows.map((e, i) => {
        const label = e.scope ? `${e.institution} · ${e.scope}` : e.institution
        const sizeTxt = sizeTexts[i]
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
            {/* 값·마커는 flexShrink:0 + **행마다 동일한 예약폭** — 자연폭에 맡기면 트랙 기준이 흔들린다(위 주석) */}
            <span className="mono tnum" data-testid="market-estimate-value" style={{ flexShrink: 0, width: `${valueCh}ch`, textAlign: 'right', whiteSpace: 'nowrap', fontSize: 12, fontWeight: 700, color: 'var(--text)' }}>
              {sizeTxt}
            </span>
            {anyBasis && (
              <span
                data-testid={e.is_basis === true ? 'market-estimate-basis-marker' : 'market-estimate-basis-slot'}
                title={e.is_basis === true ? '성장 곡선이 채택한 기관' : undefined}
                aria-hidden={e.is_basis === true ? undefined : 'true'}
                style={{
                  flexShrink: 0, fontSize: 10, fontWeight: 700, whiteSpace: 'nowrap', borderRadius: 3, padding: '0 4px',
                  // 마커 없는 행도 같은 폭을 예약한다(visibility:hidden은 박스를 유지한다 — display:none이면 폭이 사라져 원인이 재발).
                  visibility: e.is_basis === true ? 'visible' : 'hidden',
                  color: 'var(--accent)', border: '1px solid var(--accent)',
                }}
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

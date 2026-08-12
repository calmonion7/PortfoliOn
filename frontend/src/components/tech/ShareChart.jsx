// 주요기술 리포트(ADR-0033, task#277 S2) — 업체별 시장점유율(share_pct) 가로 막대.
// 순수 표시 컴포넌트(fetch 없음). props: players(report.players 배열 그대로) · shareBasis(report.market?.share_basis).
// SegmentAnalysisSection.jsx의 막대·색·잘림 규율(task#275)을 그대로 따른다 — 새 디자인 언어를 만들지 않는다.

// 가격방향(--up/--down)과 교차 사용 금지(task#194) — 카테고리 팔레트만 순환.
const DATA_COLORS = ['var(--data-1)', 'var(--data-2)', 'var(--data-3)', 'var(--data-4)', 'var(--data-5)', 'var(--corr-pos)', 'var(--corr-neg)']

// Σ가 100%를 이 이상 넘으면 데이터 이상(중복 집계 등)으로 보고 캡션에 경고만 붙인다.
// 막대 자체는 지우지 않는다 — 과보수 가드가 정상값까지 지운 실사례가 있다(task#249).
const OVERFLOW_THRESHOLD = 100.5

export default function ShareChart({ players, shareBasis }) {
  const rows = (players || [])
    .filter((p) => p && Number.isFinite(p.share_pct) && p.share_pct >= 0)
    .sort((a, b) => b.share_pct - a.share_pct)

  // 상용 시장 미형성(SMR·재사용 로켓 등)이 정상 상태 — 빈 차트를 보이지 않는다.
  if (rows.length === 0) return null

  const total = rows.reduce((s, p) => s + p.share_pct, 0)
  const overflow = total > OVERFLOW_THRESHOLD

  return (
    <div data-testid="tech-share-chart" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {rows.map((p, i) => (
        <div key={p.name ?? i} data-testid="tech-share-chart-row" style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
          {/* 업체명만 ellipsis(줄어도 되는 것) — 수치는 flexShrink:0 형제로 고정(task#275 가토) */}
          <span title={p.name} style={{ width: 96, flexShrink: 0, fontSize: 12, color: 'var(--text-2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {p.name}
          </span>
          <div style={{ flex: 1, minWidth: 0, height: 14, background: 'var(--bg-elev-2)', borderRadius: 3, overflow: 'hidden' }}>
            <div style={{ width: `${Math.min(Math.max(p.share_pct, 0), 100)}%`, height: '100%', background: DATA_COLORS[i % DATA_COLORS.length], borderRadius: 3 }} />
          </div>
          <span className="mono tnum" style={{ flexShrink: 0, whiteSpace: 'nowrap', fontSize: 12, fontWeight: 700, color: 'var(--text)' }}>
            {p.share_pct.toFixed(1)}%
          </span>
        </div>
      ))}
      {/* 기준 없는 점유율은 의미가 없다 — shareBasis 없으면 캡션째로 생략(값을 빈칸으로 보이지 않는다) */}
      {shareBasis && (
        <p data-testid="tech-share-chart-caption" style={{ fontSize: 11, color: 'var(--text-3)', margin: '4px 0 0' }}>
          점유율 기준: {shareBasis}
          {overflow && <span style={{ color: 'var(--warn)' }}> · 합계 {total.toFixed(1)}%(100% 초과 — 기준 상이 가능)</span>}
        </p>
      )}
    </div>
  )
}

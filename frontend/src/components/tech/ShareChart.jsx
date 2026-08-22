// 주요기술 리포트(ADR-0033, task#277 S2) — 업체별 시장점유율(share_pct) 가로 막대.
// 순수 표시 컴포넌트(fetch 없음). props: players(report.players 배열 그대로) · shareBasis(report.market?.share_basis).
// SegmentAnalysisSection.jsx의 막대·색·잘림 규율(task#275)을 그대로 따른다 — 새 디자인 언어를 만들지 않는다.
// task#301 S2 — players[].category가 있으면 groupByCategory로 묶어 그룹별 소라벨+막대묶음을 렌더한다.
// Σ 초과 경고도 그룹 단위로 옮긴다(그룹마다 독립 판정) — 분류 전무 시엔 기존 평면 렌더·전체 합 판정을 그대로 보존한다.

import { groupByCategory } from '../reports/techReportUtils'

// 가격방향(--up/--down)과 교차 사용 금지(task#194) — 카테고리 팔레트만 순환.
const DATA_COLORS = ['var(--data-1)', 'var(--data-2)', 'var(--data-3)', 'var(--data-4)', 'var(--data-5)', 'var(--corr-pos)', 'var(--corr-neg)']

// Σ가 100%를 이 이상 넘으면 데이터 이상(중복 집계 등)으로 보고 경고만 붙인다(그룹 모드=그룹 소라벨,
// 평면 모드=캡션). 막대 자체는 지우지 않는다 — 과보수 가드가 정상값까지 지운 실사례가 있다(task#249).
const OVERFLOW_THRESHOLD = 100.5

const CHART_WRAP_STYLE = { display: 'flex', flexDirection: 'column', gap: 8 }
const GROUPS_WRAP_STYLE = { display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }
const GROUP_STYLE = { display: 'flex', flexDirection: 'column', gap: 8 }
// 라벨은 자기 막대묶음과 붙어야 한다(축④) — 그룹 간 var(--space-4) > 라벨↔막대 var(--space-2)라야
// 한 덩어리로 읽힌다(CategoryGroups.jsx가 쓰던 것과 같은 근거·같은 값).
const GROUP_LABEL_STYLE = {
  margin: '0 0 var(--space-2)',
  fontSize: 'var(--font-size-xs)', fontWeight: 'var(--font-weight-semibold)', color: 'var(--text-3)',
}
const ROW_STYLE = { display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }
// 업체명만 ellipsis(줄어도 되는 것) — 수치는 flexShrink:0 형제로 고정(task#275 가토)
const NAME_STYLE = { width: 96, flexShrink: 0, fontSize: 12, color: 'var(--text-2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }
const TRACK_STYLE = { flex: 1, minWidth: 0, height: 14, background: 'var(--bg-elev-2)', borderRadius: 3, overflow: 'hidden' }
// ⚠️ 값 칸은 `flexShrink:0`만으로 부족하다 — 폭을 **예약**하지 않으면 자연폭이 행마다 달라
// 트랙(flex:1)이 흡수하는 잔여폭이 갈리고, 그러면 `width:N%`의 기준이 행마다 달라진다
// (CONVENTIONS §9.6 마지막 항 · TESTING §9 ⑦ "퍼센트는 옳고 픽셀이 틀리다").
// 라이브 실측(2026-08-22, GET만): `ai-datacenter-equipment` 11행에서 `7.0%`(4자)만 값칸 28.92px이고
// 나머지 10행은 36.14px → 트랙 폭이 **2종**(pc1440 607.08 / 599.86 · m390 177.08 / 169.86 ·
// m350 137.08 / 129.86)으로 갈렸다. `robotics`(4행)도 같다. 단조성 위반은 아직 0인데, 값 문자열
// 길이가 다른 두 행의 값이 서로 가깝지 않아서일 뿐이다 — 즉 **지금은 우연히 안 보이는 상태**이고
// 형제 MarketEstimates.jsx는 같은 원인으로 이미 역전($12.5B 75.98px < $9B 84.86px)을 냈다.
// 그래서 형제와 같은 처방을 쓴다: 값 문자열의 최대 길이를 데이터에서 파생해 전 행에 같은 폭을 예약.
// 폭은 상수로 추정하지 않는다. mono 폰트에서 1글자 = 1ch이고 `%`·`.`도 같은 advance다.
// ⚠️ valueCh는 **그룹별이 아니라 전체 rows에서** 계산한다 — 그룹마다 다르게 잡으면 그룹 간
// 트랙 폭이 달라져 분류를 넘나드는 막대 비교가 다시 무의미해진다.
// jsdom엔 레이아웃이 없어 vitest는 이 px 불변식을 원리적으로 못 잰다 — 게이트는 라이브 프로브의
// `share-track-uniform`/`share-bar-monotonic`이고 vitest는 구조적 대리지표(폭 선언이 전 행 동일)를 본다.
const PCT_STYLE = { flexShrink: 0, whiteSpace: 'nowrap', textAlign: 'right', fontSize: 12, fontWeight: 700, color: 'var(--text)' }
const CAPTION_STYLE = { fontSize: 11, color: 'var(--text-3)', margin: '4px 0 0' }
const WARN_STYLE = { color: 'var(--warn)' }

function overflowLabel(total) {
  return ` · 합계 ${total.toFixed(1)}%(100% 초과 — 기준 상이 가능)`
}

// 값 문자열의 유일한 출처 — 렌더와 폭 계산이 같은 함수를 쓴다(따로 조립하면 둘이 어긋난다).
const pctText = (p) => `${p.share_pct.toFixed(1)}%`

export default function ShareChart({ players, shareBasis }) {
  const rows = (players || [])
    .filter((p) => p && Number.isFinite(p.share_pct) && p.share_pct >= 0)
    .sort((a, b) => b.share_pct - a.share_pct)

  // 상용 시장 미형성(SMR·재사용 로켓 등)이 정상 상태 — 빈 차트를 보이지 않는다.
  if (rows.length === 0) return null

  const groups = groupByCategory(rows)
  const grouped = groups.length > 0

  // 색 순환은 그룹 여부와 무관하게 기존 rows 순서를 그대로 따른다 — 값이 아니라 객체 참조를 키로
  // 써서(그룹으로 재배열돼도 같은 참조) 그룹화 전후로 같은 업체가 같은 색을 유지한다.
  const colorIndex = new Map(rows.map((p, i) => [p, i]))
  // 렌더당 1개만 만들어 전 행이 공유한다(행마다 새 객체를 만들지 않는다).
  const pctStyle = { ...PCT_STYLE, width: `${Math.max(...rows.map((p) => pctText(p).length))}ch` }
  const renderRow = (p) => (
    <div key={p.name ?? colorIndex.get(p)} data-testid="tech-share-chart-row" style={ROW_STYLE}>
      <span title={p.name} style={NAME_STYLE}>{p.name}</span>
      <div data-testid="tech-share-chart-track" style={TRACK_STYLE}>
        <div data-testid="tech-share-chart-bar" style={{ width: `${Math.min(Math.max(p.share_pct, 0), 100)}%`, height: '100%', background: DATA_COLORS[colorIndex.get(p) % DATA_COLORS.length], borderRadius: 3 }} />
      </div>
      <span className="mono tnum" data-testid="tech-share-chart-value" style={pctStyle}>
        {pctText(p)}
      </span>
    </div>
  )

  // 평면 모드(분류 전무)일 때만 전체 합으로 판정 — 기존 동작 보존. 그룹 모드는 그룹별로 아래서 판정한다.
  const total = rows.reduce((s, p) => s + p.share_pct, 0)
  const overflow = !grouped && total > OVERFLOW_THRESHOLD

  return (
    <div data-testid="tech-share-chart" style={CHART_WRAP_STYLE}>
      {grouped ? (
        <div style={GROUPS_WRAP_STYLE}>
          {groups.map((g, gi) => {
            const groupTotal = g.players.reduce((s, p) => s + p.share_pct, 0)
            const groupOverflow = groupTotal > OVERFLOW_THRESHOLD
            return (
              // key는 라벨(category)이 아니라 인덱스 — 루틴이 '미분류'를 문자로 쓰면 라벨이 같은
              // 그룹이 둘일 수 있다(CategoryGroups.jsx의 F6 가토와 동일 근거).
              <div key={gi} data-testid="tech-share-chart-group" style={GROUP_STYLE}>
                <div style={GROUP_LABEL_STYLE}>
                  {g.category}
                  {groupOverflow && <span style={WARN_STYLE}>{overflowLabel(groupTotal)}</span>}
                </div>
                {g.players.map(renderRow)}
              </div>
            )
          })}
        </div>
      ) : (
        rows.map(renderRow)
      )}
      {/* 기준 없는 점유율은 의미가 없다 — shareBasis 없으면 캡션째로 생략(값을 빈칸으로 보이지 않는다) */}
      {shareBasis && (
        <p data-testid="tech-share-chart-caption" style={CAPTION_STYLE}>
          점유율 기준: {shareBasis}
          {overflow && <span style={WARN_STYLE}>{overflowLabel(total)}</span>}
        </p>
      )}
    </div>
  )
}

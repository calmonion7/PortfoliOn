// 진척 타임라인(task#281 S3) — milestones[]{year, actor?, event, status}를 연도축 + 상태 마커로 그린다.
// recharts를 쓰지 않는다(ADR-0033 결정4와 같은 근거): 좌표가 순수함수 산출이라 vitest가 불변식을 직접
// 단언할 수 있고, recharts 셀렉터 함정 3종(pie label이 별도 레이어 / 축 틱이 .recharts-surface 하위가
// 아님 / .recharts-surface 첫 매치가 범례 아이콘)을 원천적으로 피한다. 선례 TechGraph.jsx.
//
// ⚠️ 고정 viewBox + `width:100%`만 주면 컨테이너 폭에 비례해 **텍스트까지** 축소돼 350px에서 라벨이
//    6~7px로 렌더된다(task#277 실측 — 기하는 전부 경계 안이라 넘침·잘림·겹침 축이 원리적으로 못 잡고
//    육안이 유일한 포착 수단이었다). 그래서 설계폭을 `minWidth`==`maxWidth`로 못박아 라벨을 항상
//    12px로 유지하고, 좁은 화면은 **자체 overflow-x 스크롤러**가 받는다(페이지 본문은 가로 스크롤하지
//    않는다). 설계폭은 연도 열 수에서 나오므로 마일스톤이 늘면 스크롤이 길어질 뿐 글자는 줄지 않는다.
//
// ⚠️ 그 "축소 대신 스크롤" 원칙은 **열 폭에도 적용된다**(task#281 리뷰 F1). 열 폭을 상수로 고정하면
//    스크롤러가 무한폭인데도 라벨이 116px에서 잘렸고, ellipsis는 문자열 *끝*을 먹으므로 동사가 끝에
//    오는 한국어에선 사건 종류(가동·착공·계통연결·상업운전)가 **항상 먼저** 사라진다(가토 ⑦).
//    복구 경로도 없다 — <title> 툴팁은 터치 기기에 hover가 없다. 그래서 열 폭은 **라벨 실측 최대폭에서
//    파생**한다. 열이 넓어진 만큼 스크롤이 길어질 뿐 글자는 온전히 남는다.
//
// 색은 토큰만 — 마커는 **의미 상태**(success/warn/neutral)이지 가격 방향이 아니므로 `--up`/`--down`을
// 절대 쓰지 않는다. 클래스 문자열 조립도 하지 않는다(가토 ⑪ — CSS에 없는 클래스는 조용히 무채색이 된다).

const PAD_X = 10
const COL_W_MIN = 148 // 연도 열 최소 폭 — 라벨이 짧아도 이보다 좁히지 않는다(5열이면 746px)
const COL_GAP = 14 // 열 사이 간격 — 라벨 가용폭에서 뺀다
const MARKER_R = 5
const LABEL_X_OFF = 18 // 열 좌측 → 라벨 시작(마커 지름 10 + 여백 8)
const AXIS_Y = 30
const ROWS_TOP = AXIS_Y + 12
const ROW_H = 32 // 이벤트 줄 + 주체 줄 2줄분 고정 높이(주체가 없어도 행 높이를 바꾸지 않는다)
const EVENT_DY = 12 // 행 상단 기준 이벤트 줄(=마커) 중심
const ACTOR_DY = 25
const PAD_BOTTOM = 6
const MAX_ROWS = 3 // 한 해에 3행까지 — 초과분은 마지막 슬롯을 "+N개" 폴드로 접는다(N == 숨긴 개수)
const FONT_SIZE = 12
const ACTOR_FONT_SIZE = 11
const YEAR_FONT_SIZE = 12

const STATUSES = ['done', 'in_progress', 'planned']
const STATUS_LABEL = { done: '완료', in_progress: '진행 중', planned: '예정' }

// milestones[] → { columns, items, colW, width, height, axisY }. 순수함수 — DOM에 의존하지 않는다.
// 문자 측정만 `measure`로 주입받고 기본값은 DOM 없는 추정기라, 기존 좌표 불변식 테스트가 그대로 돈다
// (렌더는 `measureTextWidth`를 주입해 getComputedTextLength 실측을 쓴다).
// 열 x는 연도 오름차순으로 단조 증가하고, 같은 해 이벤트는 같은 열 안에서 세로로 쌓인다(행 높이 ROW_H
// 고정이라 서로 겹치지 않는다). 좌표는 전부 viewBox 좌표계다.
export function milestoneTimelineLayout({ milestones } = {}, { measure = estimateTextWidth } = {}) {
  const list = (Array.isArray(milestones) ? milestones : [])
    .map((m, i) => ({ m, i }))
    .filter(({ m }) => m && typeof m.year === 'number' && Number.isFinite(m.year)
      && typeof m.event === 'string' && m.event.trim().length > 0)
    .sort((a, b) => a.m.year - b.m.year || a.i - b.i) // 연도 오름차순, 같은 해는 입력 순서 유지
    .map(({ m }) => m)

  const years = []
  const byYear = new Map()
  for (const m of list) {
    if (!byYear.has(m.year)) { byYear.set(m.year, []); years.push(m.year) }
    byYear.get(m.year).push(m)
  }
  if (years.length === 0) return { columns: [], items: [], colW: COL_W_MIN, width: 0, height: 0, axisY: AXIS_Y }

  // 열 구성(표시/접힘)을 먼저 확정하고 → 그 라벨들을 실측해 → 열 폭을 파생한다(F1).
  const plan = years.map((year, col) => {
    const group = byYear.get(year)
    const shown = group.length > MAX_ROWS ? group.slice(0, MAX_ROWS - 1) : group
    return { year, col, shown, hidden: group.slice(shown.length) }
  })

  let maxLabelW = 0
  const widest = (str, fontSize) => {
    if (!str) return
    const w = measure(str, fontSize)
    if (Number.isFinite(w) && w > maxLabelW) maxLabelW = w
  }
  plan.forEach(({ shown, hidden }) => {
    shown.forEach((m) => {
      widest(m.event, FONT_SIZE)
      if (typeof m.actor === 'string' && m.actor.trim()) widest(m.actor, ACTOR_FONT_SIZE)
    })
    if (hidden.length > 0) widest(`+${hidden.length}개`, FONT_SIZE)
  })
  // 올림해서 파생 — 렌더의 truncateLabel이 같은 측정기로 재므로 부동소수 오차로 말줄임이 끼지 않는다.
  const colW = Math.max(COL_W_MIN, Math.ceil(maxLabelW) + LABEL_X_OFF + COL_GAP)
  const labelW = colW - COL_GAP - LABEL_X_OFF

  const columns = plan.map(({ year, col }) => ({ year, col, x: PAD_X + col * colW }))
  const items = []
  let maxRows = 1

  plan.forEach(({ year, col, shown, hidden }) => {
    const x = PAD_X + col * colW
    maxRows = Math.max(maxRows, shown.length + (hidden.length > 0 ? 1 : 0))

    const base = (row) => {
      const y = ROWS_TOP + row * ROW_H
      return {
        year, col, row, x, y, w: colW - COL_GAP, h: ROW_H,
        markerX: x + MARKER_R, markerY: y + EVENT_DY, r: MARKER_R,
        labelX: x + LABEL_X_OFF, labelW,
      }
    }
    shown.forEach((m, row) => {
      items.push({
        id: `${year}-${row}`, ...base(row), fold: false, hidden: 0,
        event: m.event,
        actor: typeof m.actor === 'string' && m.actor.trim() ? m.actor : null,
        status: STATUSES.includes(m.status) ? m.status : 'planned',
      })
    })
    if (hidden.length > 0) {
      items.push({
        id: `${year}-more`, ...base(shown.length), fold: true, hidden: hidden.length,
        event: `+${hidden.length}개`, actor: null, status: null,
        hiddenEvents: hidden.map((m) => m.event), // 접어도 원문은 <title>로 남긴다(wrong < missing)
      })
    }
  })

  return {
    columns,
    items,
    colW,
    width: PAD_X * 2 + columns.length * colW - COL_GAP,
    height: ROWS_TOP + maxRows * ROW_H + PAD_BOTTOM,
    axisY: AXIS_Y,
  }
}

// ── 문자폭 실측 — 숨은 SVG <text> 싱글톤. jsdom엔 getComputedTextLength가 없으므로 추정 폴백을
//    반드시 남긴다(지우면 단위테스트가 통째 깨진다). 라틴 기준 추정은 한글 전각을 과소평가하므로
//    전각 문자를 더 넓게 잡는다(task#237).
let _measureNode = null
function getMeasureNode() {
  if (_measureNode) return _measureNode
  if (typeof document === 'undefined') return null
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  svg.setAttribute('width', '0')
  svg.setAttribute('height', '0')
  svg.setAttribute('aria-hidden', 'true')
  svg.style.position = 'absolute'
  svg.style.overflow = 'hidden'
  svg.style.pointerEvents = 'none'
  const text = document.createElementNS('http://www.w3.org/2000/svg', 'text')
  svg.appendChild(text)
  document.body.appendChild(svg)
  _measureNode = text
  return _measureNode
}

const WIDE_CHAR_RE = /[ㄱ-힣一-鿿]/
function estimateTextWidth(str, fontSize) {
  let w = 0
  for (const ch of str) w += WIDE_CHAR_RE.test(ch) ? fontSize * 0.95 : fontSize * 0.55
  return w
}

function measureTextWidth(str, fontSize) {
  const el = getMeasureNode()
  if (!el) return estimateTextWidth(str, fontSize)
  try {
    el.textContent = str
    el.style.fontSize = `${fontSize}px`
    const len = el.getComputedTextLength()
    if (Number.isFinite(len) && len > 0) return len
  } catch {
    // jsdom: getComputedTextLength 미구현 — 추정 폴백으로 내려간다
  }
  return estimateTextWidth(str, fontSize)
}

// maxWidth에 맞게 말줄임(…). 원문은 <title>에 보존한다.
export function truncateLabel(label, maxWidth, fontSize) {
  if (!label) return ''
  if (measureTextWidth(label, fontSize) <= maxWidth) return label
  let lo = 0, hi = label.length
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2)
    if (measureTextWidth(label.slice(0, mid) + '…', fontSize) <= maxWidth) lo = mid
    else hi = mid - 1
  }
  return lo > 0 ? label.slice(0, lo) + '…' : '…'
}

// ── 스타일(토큰만) ─────────────────────────────────────────────
const SCROLL_STYLE = { overflowX: 'auto', overflowY: 'hidden' }
const TICK_STYLE = { stroke: 'var(--border)', strokeWidth: 1 }
const YEAR_TEXT_STYLE = {
  fontFamily: 'var(--font-mono)', fontVariantNumeric: 'tabular-nums',
  fontSize: YEAR_FONT_SIZE, fontWeight: 700, fill: 'var(--text-2)',
}
const EVENT_TEXT_STYLE = { fontSize: FONT_SIZE, fill: 'var(--text)' }
const FOLD_TEXT_STYLE = { fontSize: FONT_SIZE, fill: 'var(--text-3)' }
const ACTOR_TEXT_STYLE = { fontSize: ACTOR_FONT_SIZE, fill: 'var(--text-3)' }
// 의미 상태 색 — success/warn/neutral. 가격 방향 --up/--down과 교차 사용 금지.
// ⚠️ planned는 `none`이어야 진짜 **외곽선**이다(F3). 이 SVG의 조상은 Card가 아니라 TechReport 루트
//    div라 실제 배경은 `--bg`인데 `--bg-elev`로 채우면 "비어 보여야 할 원"이 다른 색 원반이 된다.
//    in_progress는 반원 오버레이가 읽히려면 베이스가 불투명해야 하므로 `none`이 아니라 배경색이다.
const MARKER_STYLE = {
  done: { fill: 'var(--color-success)', stroke: 'var(--color-success)', strokeWidth: 1.5 },
  in_progress: { fill: 'var(--bg)', stroke: 'var(--warn)', strokeWidth: 1.5 },
  planned: { fill: 'none', stroke: 'var(--text-3)', strokeWidth: 1.5 },
}
const HALF_FILL_STYLE = { fill: 'var(--warn)' }
const LEGEND_STYLE = {
  display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 'var(--space-3)',
  marginTop: 'var(--space-2)',
}
const LEGEND_ITEM_STYLE = {
  display: 'flex', alignItems: 'center', gap: 'var(--space-1)',
  fontSize: 'var(--font-size-xs)', color: 'var(--text-3)', whiteSpace: 'nowrap',
}
const NOTE_STYLE = {
  marginTop: 'var(--space-1)', fontSize: 'var(--font-size-xs)', color: 'var(--text-3)',
}
// 등간격 표기 고지 — x는 연도값이 아니라 열 서수라 2026→2029(3년)와 2029→2034(5년)가 같은 거리다(F4).
const SPACING_NOTE = '가로 간격은 등간격입니다 — 연도 사이의 실제 경과 시간에 비례하지 않습니다.'

// 오른쪽 반원(진행 중 = 반채움) — 채움/외곽선만으로는 3단계를 구분할 수 없다.
function halfDiscPath(cx, cy, r) {
  return `M${cx},${cy - r} A${r},${r} 0 0 1 ${cx},${cy + r} Z`
}

function StatusMarker({ cx, cy, r, status }) { // status: 'done'|'in_progress'|'planned'
  return (
    <>
      <circle cx={cx} cy={cy} r={r} style={MARKER_STYLE[status] || MARKER_STYLE.planned} />
      {status === 'in_progress' && <path d={halfDiscPath(cx, cy, r)} style={HALF_FILL_STYLE} />}
    </>
  )
}

// 항목 하나의 접근성 이름 — 연도·주체·이벤트·상태를 한 줄로(F2). 이 정보는 화면 어디에도 텍스트로
// 중복되지 않으므로, 이게 없으면 AT 사용자에게 이 섹션이 추가한 정보가 0이 된다.
export function milestoneAriaLabel(it) {
  if (it.fold) return `${it.year}년 그 외 ${it.hidden}건: ${it.hiddenEvents.join(', ')}`
  const head = it.actor ? `${it.year}년 ${it.actor} ${it.event}` : `${it.year}년 ${it.event}`
  return `${head} (${STATUS_LABEL[it.status] || STATUS_LABEL.planned})`
}

// milestones[] → 연도축 타임라인. 순수 표시 컴포넌트(fetch 없음). 데이터가 없으면 섹션째 생략되도록
// null을 반환한다(구발행물은 milestones가 SQL NULL로 오므로 `?? []`가 아니라 배열 여부로 판정).
export default function MilestoneTimeline({ milestones }) {
  const { columns, items, width, height } = milestoneTimelineLayout({ milestones }, { measure: measureTextWidth })
  if (items.length === 0) return null

  const legend = STATUSES.filter((s) => items.some((it) => it.status === s))

  return (
    <div data-testid="milestone-timeline">
      <div style={SCROLL_STYLE}>
        <svg
          data-testid="milestone-timeline-svg"
          viewBox={`0 0 ${width} ${height}`}
          style={{ width: '100%', minWidth: width, maxWidth: width, height: 'auto', display: 'block' }}
          role="group"
          aria-label={`진척 타임라인 — ${SPACING_NOTE}`}
        >
          {/* 연도 눈금 — 값은 항목 aria-label에 이미 들어가므로 AT에는 감춘다(중복 낭독 방지).
              전 구간을 잇는 축선은 두지 않는다(F4): x가 연도값이 아니라 열 서수라 연속 축선이
              "가로 거리 = 경과 시간"이라는 정량 축 문법을 만든다. 열별 눈금만 남겨 범주형 스트립으로 읽힌다. */}
          <g aria-hidden="true">
            {columns.map((c) => (
              <g key={c.year} data-testid="milestone-column" data-year={c.year}>
                <line x1={c.x + MARKER_R} y1={AXIS_Y} x2={c.x + MARKER_R} y2={ROWS_TOP} style={TICK_STYLE} />
                <text x={c.x} y={AXIS_Y - 8} style={YEAR_TEXT_STYLE}>{c.year}</text>
              </g>
            ))}
          </g>
          <g role="list">
            {items.map((it) => (
              <g
                key={it.id}
                data-testid={it.fold ? 'milestone-fold' : 'milestone-item'}
                data-year={it.year}
                data-status={it.status || ''}
                data-hidden={it.fold ? it.hidden : undefined}
                role="listitem"
                aria-label={milestoneAriaLabel(it)}
              >
                {!it.fold && <StatusMarker cx={it.markerX} cy={it.markerY} r={it.r} status={it.status} />}
                <title>{it.fold ? it.hiddenEvents.join(' · ') : it.event}</title>
                <text
                  x={it.labelX}
                  y={it.y + EVENT_DY}
                  dominantBaseline="middle"
                  aria-hidden="true"
                  style={it.fold ? FOLD_TEXT_STYLE : EVENT_TEXT_STYLE}
                >
                  {truncateLabel(it.event, it.labelW, FONT_SIZE)}
                </text>
                {it.actor && (
                  <text x={it.labelX} y={it.y + ACTOR_DY} dominantBaseline="middle" aria-hidden="true" style={ACTOR_TEXT_STYLE}>
                    {truncateLabel(it.actor, it.labelW, ACTOR_FONT_SIZE)}
                  </text>
                )}
              </g>
            ))}
          </g>
        </svg>
      </div>
      <div style={LEGEND_STYLE} data-testid="milestone-legend">
        {legend.map((s) => (
          <span key={s} style={LEGEND_ITEM_STYLE}>
            <svg width="12" height="12" aria-hidden="true" style={{ display: 'block', flexShrink: 0 }}>
              <StatusMarker cx={6} cy={6} r={MARKER_R} status={s} />
            </svg>
            {STATUS_LABEL[s]}
          </span>
        ))}
      </div>
      {/* 범례 밖에 둔다 — 범례는 "존재하는 상태 수 == span 수"가 불변식이라 여기 끼면 그 대조가 깨진다 */}
      <div style={NOTE_STYLE} data-testid="milestone-spacing-note">{SPACING_NOTE}</div>
    </div>
  )
}

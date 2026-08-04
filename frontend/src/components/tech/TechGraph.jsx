// 3열 연관기술 관계도 — 순수 레이아웃 techGraphLayout + 정적 SVG 렌더 TechGraph(task#277 S4, ADR-0033 결정4).
// 줌/드래그/팬 없음(정적 SVG로 결정) — 좌표가 순수함수 산출이라 vitest가 좌표 불변식을 직접 단언한다.
// 보완·경합 기술(complements/competitors)은 3열 DAG에 넣으면 방향이 거짓이 되므로 SVG 밖 칩 그룹으로 분리.
import Badge from '../ui/Badge'

const MAX_PER_COL = 5 // 열당 최대 5노드 — 초과분은 마지막 슬롯을 "+N개" 폴드로 접는다
const NODE_W_RATIO = 0.72 // 노드폭 = 열폭의 72%(나머지는 열 사이 여백)
const ROW_GAP = 12 // 같은 열 노드 사이 수직 간격(px) — bbox 비겹침 여유폭
const NODE_H_MAX = 56 // 노드 높이 상한(px) — maxN이 작을 때(열당 1개뿐인 흔한 케이스) 노드가 SVG 전체
// 높이로 늘어나 세로 기둥이 되는 것을 막는다(적대 리뷰 [high]). 남는 세로공간은 columnYs의 중앙정렬이 흡수.
const FONT_SIZE = 12
const PAD_X = 10 // 노드 안 텍스트 좌우 패딩(px) — truncateLabel 가용폭 계산에 사용

// 유효 문자열 라벨만 남긴다(capColumn과 동일 필터) — sr-only 전체 목록에 재사용, 캡은 적용 안 함.
function validLabels(items) {
  return Array.isArray(items) ? items.filter((v) => typeof v === 'string' && v.trim()) : []
}

// 열 하나를 최대 5칸으로 접는다: 5개 이하면 전부 개별 노드, 넘으면 앞 4개 + 마지막 슬롯을 "+N개" 폴드로.
function capColumn(items) {
  const list = validLabels(items)
  if (list.length <= MAX_PER_COL) return { shown: list, overflow: 0 }
  return { shown: list.slice(0, MAX_PER_COL - 1), overflow: list.length - (MAX_PER_COL - 1) }
}

function columnNodeCount(capped) {
  return capped.shown.length + (capped.overflow > 0 ? 1 : 0)
}

// 좌→우 단방향 베지어 — a 우측 중앙 → b 좌측 중앙, 중간 x에서 수평 접선(엣지 교차를 줄인다)
function edgePath(a, b) {
  const x1 = a.x + a.w, y1 = a.y + a.h / 2
  const x2 = b.x, y2 = b.y + b.h / 2
  const mx = (x1 + x2) / 2
  return `M${x1},${y1} C${mx},${y1} ${mx},${y2} ${x2},${y2}`
}

// { prerequisites, target, derivatives, width, height } → { nodes, edges }.
// 열 x는 고정(0/1/2, 열 간 단조 증가), 행은 열 안에서 등간격 중앙정렬. width/height는 SVG viewBox 크기.
export function techGraphLayout({ prerequisites, target, derivatives, width = 640, height = 260 } = {}) {
  const pre = capColumn(prerequisites)
  const der = capColumn(derivatives)
  const preCount = columnNodeCount(pre)
  const derCount = columnNodeCount(der)
  const hasTarget = typeof target === 'string' && target.trim().length > 0
  const maxN = Math.max(preCount, derCount, hasTarget ? 1 : 0, 1)

  const colW = width / 3
  const nodeW = colW * NODE_W_RATIO
  // maxN 열 기준으로 전 열 공통 노드 높이를 정하되 NODE_H_MAX로 캡한다 — maxN이 작으면(1~2) 캡 없이는
  // 노드가 height 전체를 채워 세로 기둥이 된다. 캡이 만든 여백은 columnYs의 중앙정렬이 패딩으로 흡수한다.
  const nodeH = Math.min(NODE_H_MAX, Math.max(1, (height - (maxN - 1) * ROW_GAP) / maxN))
  const colX = (col) => col * colW + (colW - nodeW) / 2

  // count개 노드를 열 안에서 세로 중앙정렬한 y좌표 배열(공통 nodeH·ROW_GAP 사용)
  function columnYs(count) {
    if (count <= 0) return []
    const contentH = count * nodeH + (count - 1) * ROW_GAP
    const startY = Math.max(0, (height - contentH) / 2)
    return Array.from({ length: count }, (_, i) => startY + i * (nodeH + ROW_GAP))
  }

  function buildNodes(col, capped, prefix) {
    const ys = columnYs(columnNodeCount(capped))
    const nodes = capped.shown.map((label, i) => ({
      id: `${prefix}-${i}`, label, col, x: colX(col), y: ys[i], w: nodeW, h: nodeH,
    }))
    if (capped.overflow > 0) {
      nodes.push({
        id: `${prefix}-more`, label: `+${capped.overflow}개`, col, x: colX(col), y: ys[ys.length - 1], w: nodeW, h: nodeH, fold: true,
      })
    }
    return nodes
  }

  const nodes = [...buildNodes(0, pre, 'pre')]
  let targetNode = null
  if (hasTarget) {
    const [y] = columnYs(1)
    targetNode = { id: 'target', label: target, col: 1, x: colX(1), y, w: nodeW, h: nodeH, isTarget: true }
    nodes.push(targetNode)
  }
  nodes.push(...buildNodes(2, der, 'der'))

  const edges = []
  if (targetNode) {
    nodes.filter((n) => n.col === 0).forEach((n) => edges.push({ from: n.id, to: 'target', path: edgePath(n, targetNode) }))
    nodes.filter((n) => n.col === 2).forEach((n) => edges.push({ from: 'target', to: n.id, path: edgePath(targetNode, n) }))
  }

  return { nodes, edges }
}

// 숨은 SVG <text> 싱글톤 — 앱 전체에서 재사용, 실측 실패(jsdom 등)엔 CJK 보정 추정으로 폴백(task#237 패턴).
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

// 라틴 6.2px/자 추정은 한글 전각을 14% 과소평가한다(task#237) — 전각 문자는 더 넓게 잡는다.
const WIDE_CHAR_RE = /[ㄱ-힝一-鿿]/
function estimateTextWidth(str, fontSize) {
  let w = 0
  for (const ch of str) w += WIDE_CHAR_RE.test(ch) ? fontSize * 0.95 : fontSize * 0.55
  return w
}

// jsdom에는 getComputedTextLength가 없다 — 추정 폴백을 반드시 남긴다(안 남기면 단위테스트가 통째 깨진다).
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

// maxWidth에 맞게 라벨을 잘라 말줄임(…)을 붙인다 — 이름은 줄어도 되므로 문자열 끝을 먹는 ellipsis로 충분.
function truncateLabel(label, maxWidth, fontSize) {
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

// 3열 DAG는 본질적으로 넓다. `width:100%`만 주면 고정 viewBox가 컨테이너 폭에 비례해 **텍스트까지**
// 축소돼 350px에서 라벨이 6px로 렌더된다(실측) — 기하는 전부 경계 안이라 넘침·잘림·겹침 축이 원리적으로
// 못 잡는다. 넓은 콘텐츠는 자체 스크롤러에 담는 것이 이 앱 관례이므로 `minWidth`로 설계 크기를 지켜
// 라벨을 12px로 유지하고, 좁은 화면에서는 가로 스크롤한다(페이지 본문은 가로 스크롤하지 않는다).
const GRAPH_SCROLL_STYLE = { overflowX: 'auto', overflowY: 'hidden' }
const SVG_STYLE = { width: '100%', height: 'auto', display: 'block' }
const EDGE_STYLE = { fill: 'none', stroke: 'var(--border-strong)', strokeWidth: 1.25 }
const NODE_RECT_STYLE = { fill: 'var(--bg-elev)', stroke: 'var(--border)', strokeWidth: 1 }
const NODE_RECT_TARGET_STYLE = { fill: 'var(--accent-soft)', stroke: 'var(--accent)', strokeWidth: 1.5 }
const NODE_RECT_FOLD_STYLE = { fill: 'var(--bg-elev-2)', stroke: 'var(--border)', strokeWidth: 1, strokeDasharray: '4 3' }
const NODE_TEXT_STYLE = { fontSize: FONT_SIZE, fill: 'var(--text)' }
const NODE_TEXT_TARGET_STYLE = { fontSize: FONT_SIZE, fill: 'var(--accent)', fontWeight: 700 }
const NODE_TEXT_FOLD_STYLE = { fontSize: FONT_SIZE, fill: 'var(--text-3)' }
const ARROW_FILL_STYLE = { fill: 'var(--border-strong)' }
const CHIP_WRAP_STYLE = { display: 'flex', flexDirection: 'column', gap: 'var(--space-2)', marginTop: 'var(--space-3)' }
const CHIP_GROUP_STYLE = { display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 'var(--space-2)' }
const CHIP_LABEL_STYLE = { fontSize: 'var(--font-size-xs)', color: 'var(--text-3)', fontWeight: 'var(--font-weight-medium)', flexShrink: 0, whiteSpace: 'nowrap' }

// related{prerequisites,derivatives,complements,competitors} + target(대상 기술 표시명) → 3열 관계도 SVG
// + 보완/경합 칩 그룹. 순수 표시 컴포넌트(fetch 없음) — techGraphLayout 결과만 그린다.
export default function TechGraph({ related, target, width = 640, height = 260 }) {
  const prerequisites = related?.prerequisites
  const derivatives = related?.derivatives
  const complements = Array.isArray(related?.complements) ? related.complements : []
  const competitors = Array.isArray(related?.competitors) ? related.competitors : []
  const hasTarget = typeof target === 'string' && target.trim().length > 0

  // eco: 노드 최대 ~11개짜리 배치 계산이라 렌더마다 다시 돌려도 비용이 없다 — useMemo 생략(YAGNI).
  const { nodes, edges } = techGraphLayout({ prerequisites, target, derivatives, width, height })

  // sr-only 전체 목록용 — SVG는 열당 5개로 캡하지만(MAX_PER_COL) 텍스트는 캡할 이유가 없어 원본을 그대로 쓴다.
  const preLabels = validLabels(prerequisites)
  const derLabels = validLabels(derivatives)

  const hasGraph = nodes.length > 0
  const hasChips = complements.length > 0 || competitors.length > 0
  if (!hasGraph && !hasChips) return null

  return (
    <div data-testid="tech-graph">
      {hasGraph && (
        <>
        <div style={GRAPH_SCROLL_STYLE}>
        <svg
          data-testid="tech-graph-svg"
          viewBox={`0 0 ${width} ${height}`}
          style={{ ...SVG_STYLE, minWidth: width }}
          aria-hidden="true"
        >
          <defs>
            <marker id="tech-graph-arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
              <path d="M0,0 L8,4 L0,8 Z" style={ARROW_FILL_STYLE} />
            </marker>
          </defs>
          {edges.map((e) => (
            <path key={`${e.from}>${e.to}`} d={e.path} style={EDGE_STYLE} markerEnd="url(#tech-graph-arrow)" />
          ))}
          {nodes.map((n) => {
            const rectStyle = n.fold ? NODE_RECT_FOLD_STYLE : n.isTarget ? NODE_RECT_TARGET_STYLE : NODE_RECT_STYLE
            const textStyle = n.fold ? NODE_TEXT_FOLD_STYLE : n.isTarget ? NODE_TEXT_TARGET_STYLE : NODE_TEXT_STYLE
            const label = truncateLabel(n.label, n.w - PAD_X * 2, FONT_SIZE)
            return (
              <g key={n.id} data-testid="tech-graph-node" data-node-id={n.id} data-col={n.col}>
                <rect x={n.x} y={n.y} width={n.w} height={n.h} rx="8" style={rectStyle} />
                <title>{n.label}</title>
                <text x={n.x + n.w / 2} y={n.y + n.h / 2} textAnchor="middle" dominantBaseline="central" style={textStyle}>
                  {label}
                </text>
              </g>
            )
          })}
        </svg>
        </div>
        {/* svg가 aria-hidden(role="img"는 ARIA leaf role이라 자손 텍스트를 접근성 트리에서 통째 프루닝한다,
            task#282) — 같은 값을 열 그룹 구조로 다시 노출한다. SVG는 열당 5개로 캡하지만(preLabels/derLabels는
            원본 raw 배열) 텍스트는 캡할 이유가 없어 폴드로 접힌 초과분도 전부 싣는다. */}
        <ul className="sr-only" data-testid="tech-graph-sr-list">
          {preLabels.length > 0 && (
            <li>
              전제·선행
              <ul>
                {preLabels.map((label, i) => <li key={`sr-pre-${i}-${label}`}>{label}</li>)}
              </ul>
            </li>
          )}
          {hasTarget && <li>대상: {target}</li>}
          {derLabels.length > 0 && (
            <li>
              파생·응용
              <ul>
                {derLabels.map((label, i) => <li key={`sr-der-${i}-${label}`}>{label}</li>)}
              </ul>
            </li>
          )}
        </ul>
        </>
      )}
      {hasChips && (
        <div style={CHIP_WRAP_STYLE}>
          {complements.length > 0 && (
            <div style={CHIP_GROUP_STYLE} data-testid="tech-graph-complements">
              <span style={CHIP_LABEL_STYLE}>보완 기술</span>
              {complements.map((name) => <Badge key={name} variant="neutral">{name}</Badge>)}
            </div>
          )}
          {competitors.length > 0 && (
            <div style={CHIP_GROUP_STYLE} data-testid="tech-graph-competitors">
              <span style={CHIP_LABEL_STYLE}>경합 기술</span>
              {competitors.map((name) => <Badge key={name} variant="neutral">{name}</Badge>)}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

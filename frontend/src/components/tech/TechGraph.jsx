// 연관기술 관계도 — **세로 흐름 HTML**(task#317. ADR-0033 결정4 「3열 계층 SVG」와 ADR-0034 보정④
// 「SVG 표면의 스크롤러는 유지」를 뒤집는다).
//
// ⚠️ 왜 SVG를 버렸나(라이브 실측 2026-08-20): 3열 DAG는 `minWidth:640`짜리 자체 가로 스크롤러에
//    담겨 있었고 모바일 가용폭은 m390 320px · m350 278px라 2배 넘게 밀렸다. 게다가 노드 가용폭
//    `640/3 × 0.72 − 20 = 133.6px`에서 최장 기술명 26자(`전신제어(loco-manipulation) 정책`)가
//    12px 한글 기준 11자쯤에서 `…`로 끊겼고, 폰에는 hover가 없어 `title` 툴팁 폴백이 닿지 않는다.
//    그리고 엣지가 정보를 0비트 담았다 — 「모든 전제 → 대상」·「대상 → 모든 파생」 완전 팬이라
//    화살표가 말하는 것은 열 이름이 이미 말하는 것과 같았다. 세로 HTML은 자연 줄바꿈하므로
//    스크롤러·말줄임이 **동시에** 사라지고, 좌표 계산·문자폭 실측(getComputedTextLength)도 함께
//    사라졌다. 선례는 같은 문제로 가로 SVG를 버린 MilestoneTimeline(task#282)이다.
//
// 접근성: 진짜 DOM 텍스트이므로 시맨틱 목록(<ol>/<ul>)을 쓰고 방향 마커만 aria-hidden(장식)이다.
//    옛 구현의 sr-only 이중 목록은 **제거**했다 — 그것은 svg가 aria-hidden이라 같은 값을 다시
//    노출해야 했던 우회이고, 칩이 진짜 텍스트가 된 지금은 스크린리더가 같은 이름을 두 번 읽는다.
//
// 방향 없는 관계(보완·경합)를 흐름 밖 칩으로 분리하는 **구별은 유지**한다(ADR-0033 결정4의 근거 —
// 방향 없는 관계에 화살표를 그리면 그림이 데이터에 없는 사실을 말한다). 뒤집은 것은 구현뿐이다.
import Badge from '../ui/Badge'

const FLOW_STYLE = { display: 'flex', flexDirection: 'column', gap: 'var(--space-2)', margin: 0, padding: 0, listStyle: 'none' }
const GROUP_STYLE = { display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }
const GROUP_LABEL_STYLE = { fontSize: 'var(--font-size-xs)', color: 'var(--text-3)', fontWeight: 'var(--font-weight-medium)' }
const ITEMS_STYLE = { display: 'flex', flexWrap: 'wrap', gap: 'var(--space-1)', margin: 0, padding: 0, listStyle: 'none' }
const ARROW_STYLE = { alignSelf: 'center', color: 'var(--text-3)', fontSize: 'var(--font-size-sm)', lineHeight: 1 }
const DIVIDER_STYLE = { border: 0, borderTop: '1px solid var(--border)', margin: 'var(--space-3) 0 0' }

// ⚠️ `.badge`에는 전역 `white-space: nowrap`(Badge.css:8)과 `line-height: 1`이 있다. 그대로 쓰면 26자
//    이름이 한 줄로 버티며 **min-content를 밀어** 없애려던 가로 스크롤을 페이지 수준에서 되살린다
//    (`break-word`는 min-content에 영향을 주지 않고 `anywhere`만 그 끊김 기회를 min-content 계산에
//    넣는다 — ADR-0034 보정④가 표에서 실측한 함정과 같은 메커니즘). 공용 프리미티브의 전역 규칙은
//    건드리지 않고 이 섹션 안에서만 인라인 오버라이드한다(소비처 전수 grep 비용 회피).
const CHIP_STYLE = { whiteSpace: 'normal', overflowWrap: 'anywhere', lineHeight: 1.35, textAlign: 'left' }
// 대상 강조 — 옛 SVG의 NODE_RECT_TARGET_STYLE + NODE_TEXT_TARGET_STYLE 직접 이식(같은 토큰).
const CHIP_TARGET_STYLE = { ...CHIP_STYLE, background: 'var(--accent-soft)', color: 'var(--accent)', borderColor: 'var(--accent)', fontWeight: 700 }

const CHIP_WRAP_STYLE = { display: 'flex', flexDirection: 'column', gap: 'var(--space-2)', marginTop: 'var(--space-3)' }
const CHIP_GROUP_STYLE = { display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 'var(--space-2)' }
const CHIP_LABEL_STYLE = { fontSize: 'var(--font-size-xs)', color: 'var(--text-3)', fontWeight: 'var(--font-weight-medium)', flexShrink: 0, whiteSpace: 'nowrap' }

function validLabels(items) {
  return Array.isArray(items) ? items.filter((v) => typeof v === 'string' && v.trim()) : []
}

// related{prerequisites,derivatives,complements,competitors} + target → 세로 흐름 3그룹 + 구분선 + 방향 없는 관계 칩(순수 표시, fetch 없음).
export default function TechGraph({ related, target }) {
  const complements = validLabels(related?.complements)
  const competitors = validLabels(related?.competitors)
  const hasTarget = typeof target === 'string' && target.trim().length > 0

  // eco: 상한이 없다 — 캡·폴드를 지웠으므로 들어온 만큼 전부 그린다(라이브 최장 그룹 5개, 최장 이름 26자).
  const groups = [
    { key: 'prerequisites', label: '전제·선행', names: validLabels(related?.prerequisites) },
    { key: 'target', label: '대상 기술', names: hasTarget ? [target.trim()] : [] },
    { key: 'derivatives', label: '파생·응용', names: validLabels(related?.derivatives) },
  ].filter((g) => g.names.length > 0)

  const hasChips = complements.length > 0 || competitors.length > 0
  if (groups.length === 0 && !hasChips) return null

  return (
    <div data-testid="tech-graph">
      {groups.length > 0 && (
        <ol style={FLOW_STYLE} data-testid="tech-graph-flow">
          {groups.map((g, i) => (
            <li key={g.key} style={GROUP_STYLE} data-testid="tech-graph-group" data-group={g.key}>
              <span style={GROUP_LABEL_STYLE}>{g.label}</span>
              <ul style={ITEMS_STYLE}>
                {/* key에 인덱스를 섞는다 — 백엔드 `List[str]`에 unique 제약이 없어 같은 키 안 중복이 가능하다(라이브 실측 0건, 옛 SVG는 `pre-0` 인덱스 id라 면역이었다). */}
                {g.names.map((name, j) => (
                  <li key={`${g.key}-${j}-${name}`}>
                    <Badge variant="neutral" style={g.key === 'target' ? CHIP_TARGET_STYLE : CHIP_STYLE} data-testid="tech-graph-item">{name}</Badge>
                  </li>
                ))}
              </ul>
              {i < groups.length - 1 && <span style={ARROW_STYLE} aria-hidden="true">↓</span>}
            </li>
          ))}
        </ol>
      )}
      {groups.length > 0 && hasChips && <hr style={DIVIDER_STYLE} />}
      {hasChips && (
        <div style={CHIP_WRAP_STYLE}>
          {complements.length > 0 && (
            <div style={CHIP_GROUP_STYLE} data-testid="tech-graph-complements">
              <span style={CHIP_LABEL_STYLE}>보완 기술</span>
              {complements.map((name, j) => <Badge key={`comp-${j}-${name}`} variant="neutral" style={CHIP_STYLE}>{name}</Badge>)}
            </div>
          )}
          {competitors.length > 0 && (
            <div style={CHIP_GROUP_STYLE} data-testid="tech-graph-competitors">
              <span style={CHIP_LABEL_STYLE}>경합 기술</span>
              {competitors.map((name, j) => <Badge key={`competi-${j}-${name}`} variant="neutral" style={CHIP_STYLE}>{name}</Badge>)}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

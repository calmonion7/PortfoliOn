// 「구성과 연관」 — 소제목 2개로 갈린 한 섹션 (task#320 · ADR-0046).
//
//   무엇으로 이뤄졌나  = `composition.tech[]`를 **안쪽으로 분해**한 지분(뿌리 + 항목별 막대)
//   무엇과 이어지나    = `related` 4분류를 **바깥으로 잇는** 경계 포인터(칩, 발행물이면 링크)
//
// ⚠️ **두 필드의 방향이 반대다 — 이것이 이 섹션 설계의 축이다.** `related`는 경계 포인터고
//    (ADR-0044 결정 3 · 루틴 프롬프트 §3: 「배제한 것을 본문에서 다루지 말고 `related`에 이름만」),
//    `composition.tech`는 지분 분해다. 그래서 **「전제 기술이 대상의 N%를 차지한다」는 문장은 분모가
//    없어 성립하지 않고**, `related`에 점유율을 붙이는 안은 기각됐다. 두 반쪽은 서로 다른 질문에
//    답하므로 한 섹션 안에서 소제목으로 가른다(합치지도, 이름으로 조인하지도 않는다).
//
// ⚠️ 옛 이 파일(task#317)은 「연관기술 관계도」 하나였고, 4분류 라벨 아래 칩이 널려 있어 **관계를
//    하나도 표현하지 못했다** — 세로 `↓`는 「모든 전제 → 대상」 완전 팬이라 정보 0비트였다.
//    task#320이 그 자리에 **구성 계층**을 넣고 경계는 경계로 남겼다. 방향 없는 관계(보완·경합)를
//    흐름 밖 칩으로 분리하는 **구별은 그대로 유지**한다(방향 없는 관계에 화살표를 그리면 그림이
//    데이터에 없는 사실을 말한다 — ADR-0033 결정4의 근거).
//
// 접근성: 진짜 DOM 텍스트이므로 시맨틱 목록(<ol>/<ul>)을 쓰고 방향 마커만 aria-hidden(장식)이다.
//    막대는 값이 이미 텍스트(`35%`)로 있으므로 `aria-hidden`(중복 낭독 방지)이다.
import { Link } from 'react-router-dom'
import Badge from '../ui/Badge'
import { rampPositions, rampColor, currentRamp } from './shareRamp'

const FLOW_STYLE = { display: 'flex', flexDirection: 'column', gap: 'var(--space-2)', margin: 0, padding: 0, listStyle: 'none' }
const GROUP_STYLE = { display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }
const GROUP_LABEL_STYLE = { fontSize: 'var(--font-size-xs)', color: 'var(--text-3)', fontWeight: 'var(--font-weight-medium)' }
const ITEMS_STYLE = { display: 'flex', flexWrap: 'wrap', gap: 'var(--space-1)', margin: 0, padding: 0, listStyle: 'none' }
// ⚠️ 좌측 정렬 — `alignSelf: 'center'`였던 옛 값은 흐름을 가운데로 밀어 왼쪽 정렬된 칩 열과 어긋났다.
const ARROW_STYLE = { alignSelf: 'flex-start', color: 'var(--text-3)', fontSize: 'var(--font-size-sm)', lineHeight: 1 }
const DIVIDER_STYLE = { border: 0, borderTop: '1px solid var(--border)', margin: 'var(--space-3) 0 0' }

// ⚠️ `.badge`에는 전역 `white-space: nowrap`(Badge.css:8)과 `line-height: 1`이 있다. 그대로 쓰면 26자
//    이름이 한 줄로 버티며 **min-content를 밀어** 없애려던 가로 스크롤을 페이지 수준에서 되살린다
//    (`break-word`는 min-content에 영향을 주지 않고 `anywhere`만 그 끊김 기회를 min-content 계산에
//    넣는다 — ADR-0034 보정④가 표에서 실측한 함정과 같은 메커니즘). 공용 프리미티브의 전역 규칙은
//    건드리지 않고 이 섹션 안에서만 인라인 오버라이드한다.
const CHIP_STYLE = { whiteSpace: 'normal', overflowWrap: 'anywhere', lineHeight: 1.35, textAlign: 'left' }
const CHIP_TARGET_STYLE = { ...CHIP_STYLE, background: 'var(--accent-soft)', color: 'var(--accent)', borderColor: 'var(--accent)', fontWeight: 700 }
// 발행물 링크 칩 — 탭 타깃 34px 핀(task#309·#316 관례: `padding: 7px 12px` + `lineHeight: '18px'`).
// `.badge`를 쓰지 않는다: 전역 `line-height: 1`이 그 핀과 싸우고, 링크는 배지가 아니라 진짜 이동이다.
const LINK_CHIP_STYLE = {
  display: 'inline-block', padding: '7px 12px', lineHeight: '18px', fontSize: 'var(--font-size-xs)',
  border: '1px solid var(--accent)', borderRadius: 12, color: 'var(--accent)', background: 'var(--accent-soft)',
  textDecoration: 'none', whiteSpace: 'normal', overflowWrap: 'anywhere', textAlign: 'left',
}

const SUB_WRAP = { display: 'flex', flexDirection: 'column', gap: 'var(--space-4, 16px)' }
const SUB_TITLE = { margin: 0, fontSize: 'var(--font-size-sm)', fontWeight: 'var(--font-weight-semibold)', color: 'var(--text)' }
const SUB_BLOCK = { display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }

// 구성 소블록 -----------------------------------------------------------------
const COMP_ROOT_STYLE = {
  display: 'flex', flexWrap: 'wrap', alignItems: 'baseline', gap: 'var(--space-2)',
  fontSize: 'var(--font-size-sm)', fontWeight: 700, color: 'var(--text)',
}
// 「남은 난제 100% 기준」 — **상시 노출**이다. 같은 화면 위쪽 주요 업체 표에 **시장점유율 열**이
// 실재하므로, 이 문구가 없으면 독자가 35%를 그것으로 읽는다.
const COMP_BASIS_STYLE = { fontSize: 'var(--font-size-xs)', fontWeight: 400, color: 'var(--text-3)' }
const COMP_LIST_STYLE = { display: 'flex', flexDirection: 'column', gap: 'var(--space-2)', margin: 0, padding: 0, listStyle: 'none' }
// ⚠️ `<li>`를 flex 컨테이너로 둔다 — 자식이 blockify돼 `clientWidth`가 유효해지고(순수 인라인이면 0이라
//    프로브의 넘침 축이 원리적으로 무의미해진다, frontend/CLAUDE.md) 세로 padding도 정상 반영된다.
const COMP_ITEM_STYLE = { display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 }
const COMP_NAME_ROW = { display: 'flex', alignItems: 'baseline', gap: 'var(--space-2)', minWidth: 0 }
const COMP_NAME_STYLE = { fontSize: 'var(--font-size-xs)', color: 'var(--text-2, var(--text))', overflowWrap: 'anywhere', minWidth: 0 }
const COMP_SHARE_STYLE = { fontSize: 'var(--font-size-xs)', fontFamily: 'var(--font-mono)', color: 'var(--text-3)', marginLeft: 'auto', flexShrink: 0 }
const COMP_TRACK_STYLE = { height: 7, borderRadius: 4, background: 'var(--ramp-track)', overflow: 'hidden' }
const ANATOMY_LINK_STYLE = { display: 'inline-block', fontSize: 'var(--font-size-xs)', color: 'var(--accent)', textDecoration: 'none', padding: '7px 0', lineHeight: '18px' }

function validLabels(items) {
  return Array.isArray(items) ? items.filter((v) => typeof v === 'string' && v.trim()) : []
}

/**
 * 경계 칩 — 발행물과 이름이 일치하면 링크, 아니면 일반 칩.
 *
 * ⚠️ **조회 실패를 「발행물 없음」으로 붕괴시키지 않는다**(task#307 · `useTechIndex` docstring):
 *    `nameToSlug`가 null이면(= 인덱스 조회 실패) **칩은 그대로 렌더하고 링크만 뺀다**. 칩 이름은
 *    사실이므로 사라지면 안 되고, 링크 부재를 「그런 발행물이 없다」로 렌더하면 화면이 모르는 것을
 *    안다고 말한다. 그래서 이 컴포넌트는 실패와 「일치 0건」을 **같게** 다룬다 — 둘 다 링크 없음이지만
 *    어느 쪽도 「없다」고 *말하지* 않는다(문구를 쓰지 않는 것이 그 규율을 지키는 방법이다).
 */
function BoundaryChip({ name, nameToSlug }) {
  const slug = nameToSlug ? nameToSlug[name] : null
  if (!slug) return <Badge variant="neutral" style={CHIP_STYLE} data-testid="tech-graph-item">{name}</Badge>
  return (
    <Link to={`/tech-report/${slug}`} style={LINK_CHIP_STYLE} data-testid="tech-graph-link-item">
      {name} <span aria-hidden="true">→</span>
    </Link>
  )
}

export default function TechGraph({ related, target, composition, slug, techIndex, indexFailed }) {
  const complements = validLabels(related?.complements)
  const competitors = validLabels(related?.competitors)
  const hasTarget = typeof target === 'string' && target.trim().length > 0

  // 발행물 이름 → slug. 실패면 **null**을 넘겨 「일치 0건」과 구별 가능한 상태로 둔다(위 규율).
  const nameToSlug = indexFailed || !Array.isArray(techIndex)
    ? null
    : techIndex.reduce((acc, t) => { if (t?.name && t?.slug) acc[t.name] = t.slug; return acc }, {})

  const prerequisites = validLabels(related?.prerequisites)
  const derivatives = validLabels(related?.derivatives)
  const hasChips = complements.length > 0 || competitors.length > 0
  // ⚠️ **경계의 정의역은 「진짜 경계 데이터가 있다」다 — 대상 노드는 세지 않는다.**
  //    `target`은 `TECH_NAMES[slug] || slug`라 **항상 채워져 있으므로**, 그것을 정의역에 넣으면
  //    관계가 하나도 없는 판에서도 「무엇과 이어지나 · 대상 기술 X」만 남은 **유령 소블록**이 뜬다
  //    (게이트는 컴포넌트 자신의 채택 조건과 같은 식이어야 한다 — 이 페이지의 규율).
  const hasBoundary = prerequisites.length > 0 || derivatives.length > 0 || hasChips
  // 흐름은 **방향 있는 관계가 하나라도 있을 때만** 그린다 — 대상 노드 혼자면 흐름이 아니다
  // (보완·경합만 있는 판에서 「대상 기술 X」 한 줄이 위에 붙는 것을 막는다).
  const groups = (prerequisites.length > 0 || derivatives.length > 0) ? [
    { key: 'prerequisites', label: '전제·선행', names: prerequisites },
    { key: 'target', label: '대상 기술', names: hasTarget ? [target.trim()] : [] },
    { key: 'derivatives', label: '파생·응용', names: derivatives },
  ].filter((g) => g.names.length > 0) : []

  const items = rampPositions(composition?.tech)
  const ramp = currentRamp()
  const hasComposition = items.length > 0

  if (!hasComposition && !hasBoundary) return null

  return (
    <div data-testid="tech-graph" style={SUB_WRAP}>
      {/* ── 무엇으로 이뤄졌나 ─────────────────────────────────────────────
          부재 시에도 **소제목을 렌더한다** — 「아직 해부되지 않음」 안내가 그 자리를 지킨다
          (무음 생략이 아니다: 숨기면 그런 화면이 있는 줄도 모른다, ADR-0042 결정 6). */}
      <section style={SUB_BLOCK} data-testid="tech-graph-composition">
        <h4 style={SUB_TITLE}>무엇으로 이뤄졌나</h4>
        {hasComposition ? (
          <>
            <div style={COMP_ROOT_STYLE} data-tech-comp-root="">
              <span>◆ {hasTarget ? target.trim() : (slug || '')}</span>
              <span style={COMP_BASIS_STYLE}>남은 난제 100% 기준</span>
            </div>
            <ul style={COMP_LIST_STYLE}>
              {items.map((it, i) => (
                <li key={`comp-${i}-${it.name}`} style={COMP_ITEM_STYLE}
                    data-tech-comp-item="" data-share={it.share}
                    data-comp-kind={it.residual ? 'other' : 'ramp'} data-comp-name={it.name}>
                  <div style={COMP_NAME_ROW}>
                    <span style={COMP_NAME_STYLE}>{it.name}</span>
                    <span style={COMP_SHARE_STYLE}>{it.share}%</span>
                  </div>
                  <div style={COMP_TRACK_STYLE} aria-hidden="true">
                    <div data-tech-comp-bar="" style={{
                      width: `${Math.max(0, Math.min(100, it.share))}%`, height: '100%',
                      background: rampColor(it.t, ramp.hi, ramp.lo, ramp.residual),
                    }} />
                  </div>
                </li>
              ))}
            </ul>
          </>
        ) : (
          <div>
            <Link to={`/tech-anatomy/${slug || ''}`} style={ANATOMY_LINK_STYLE} data-testid="tech-graph-anatomy-link">
              아직 해부되지 않음 →
            </Link>
          </div>
        )}
      </section>

      {/* ── 무엇과 이어지나 ───────────────────────────────────────────────
          ⚠️ **유령 소제목 금지** — 경계 데이터가 전부 비면 이 소제목도 렌더하지 않는다
          (이 페이지의 규율: 게이트는 컴포넌트 자신의 채택 조건과 같은 식). */}
      {hasBoundary && (
        <section style={SUB_BLOCK} data-testid="tech-graph-boundary">
          <h4 style={SUB_TITLE}>무엇과 이어지나</h4>
          {groups.length > 0 && (
            <ol style={FLOW_STYLE} data-testid="tech-graph-flow">
              {groups.map((g, i) => (
                <li key={g.key} style={GROUP_STYLE} data-testid="tech-graph-group" data-group={g.key}>
                  <span style={GROUP_LABEL_STYLE}>{g.label}</span>
                  <ul style={ITEMS_STYLE}>
                    {/* key에 인덱스를 섞는다 — 백엔드 `List[str]`에 unique 제약이 없다. */}
                    {g.names.map((name, j) => (
                      <li key={`${g.key}-${j}-${name}`}>
                        {g.key === 'target'
                          ? <Badge variant="neutral" style={CHIP_TARGET_STYLE} data-testid="tech-graph-item">{name}</Badge>
                          : <BoundaryChip name={name} nameToSlug={nameToSlug} />}
                      </li>
                    ))}
                  </ul>
                  {i < groups.length - 1 && <span style={ARROW_STYLE} aria-hidden="true">↓</span>}
                </li>
              ))}
            </ol>
          )}
          {groups.length > 0 && hasChips && <hr style={DIVIDER_STYLE} />}
          {/* 보완·경합 — **라벨을 칩 위로** 통일한다(#319 S4ⓐ를 이 태스크가 흡수).
              옛 구현은 라벨이 칩과 같은 줄에 있어 위 흐름 그룹(라벨이 위)과 관례가 어긋났다. */}
          {complements.length > 0 && (
            <div style={GROUP_STYLE} data-testid="tech-graph-complements">
              <span style={GROUP_LABEL_STYLE}>보완 기술</span>
              <ul style={ITEMS_STYLE}>
                {complements.map((name, j) => (
                  <li key={`comp-${j}-${name}`}><BoundaryChip name={name} nameToSlug={nameToSlug} /></li>
                ))}
              </ul>
            </div>
          )}
          {competitors.length > 0 && (
            <div style={GROUP_STYLE} data-testid="tech-graph-competitors">
              <span style={GROUP_LABEL_STYLE}>경합 기술</span>
              <ul style={ITEMS_STYLE}>
                {competitors.map((name, j) => (
                  <li key={`competi-${j}-${name}`}><BoundaryChip name={name} nameToSlug={nameToSlug} /></li>
                ))}
              </ul>
            </div>
          )}
        </section>
      )}
    </div>
  )
}

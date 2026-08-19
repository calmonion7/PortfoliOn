// 기술 해부 — 자가 서로 다른 [[지분 축]] 3개의 파생·조인·색 배정 (ADR-0042, task#306 S1).
//
// 이 모듈은 순수함수만 갖는다 — TechAnatomy.jsx는 여기서 나온 것을 그리기만 한다.
// 세 축은 **분모가 달라 합칠 수 없다**(기술=남은 난제 총량 / 광물=원재료비 / 전문가=인력 병목
// 총량). 그래서 축마다 독립으로 100%가 닫히고, 화면은 축마다 별도 막대 + 「기준」 문구를 상시
// 노출한다 — 안 하면 독자가 광물 32%와 기술 32%를 같은 뜻으로 읽는다(ADR-0042 결정 2).

// 축의 정본 — 순서·제목·기준 문구가 여기 한 곳에 있다. 화면·프로브·테스트가 이걸 공유한다.
export const AXIS_META = [
  { key: 'tech', title: '필요 기술', basis: '남은 난제 총량 기준' },
  { key: 'minerals', title: '핵심 광물', basis: '원재료비 기준' },
  { key: 'experts', title: '전문가', basis: '인력 병목 총량 기준' },
]

// 세그먼트 색 — 항목 **순서** 기준 결정론적 배정. 토큰이 5개라 6·7번째는 1·2번째와 같은 색이
// 되지만 **인접하지는 않는다**(연속 인덱스는 항상 다른 토큰으로 간다) — 항목 상한이 7이라
// 같은 색 두 조각이 맞붙는 경우는 원리적으로 없다.
export const SEGMENT_TOKENS = ['--data-1', '--data-2', '--data-3', '--data-4', '--data-5']
export function segmentColor(i) {
  return `var(${SEGMENT_TOKENS[i % SEGMENT_TOKENS.length]})`
}

/** composition → 렌더할 축 배열. 빈 축은 제외한다(루틴이 모르는 축은 통째로 생략한다). */
export function deriveAxes(composition) {
  if (!composition) return []
  return AXIS_META
    .map((meta) => {
      const raw = Array.isArray(composition[meta.key]) ? composition[meta.key] : []
      // share_pct가 수치인 항목만 — 발행 시점 검증을 통과했으므로 정상 판에선 전부 남는다.
      // 구판·손상 데이터에서 NaN/누락이 들어와도 막대가 깨지지 않게 하는 방어다.
      const items = raw
        .filter((it) => it && Number.isFinite(it.share_pct))
        .map((it, i) => ({ ...it, color: segmentColor(i) }))
      return { ...meta, items }
    })
    .filter((axis) => axis.items.length > 0)
}

/**
 * 기술 축 항목의 `leaders[]`(이름만)를 `players[]`와 이름으로 조인해 기술수준·티커·국가를 붙인다.
 *
 * 매칭 실패는 **이름만 남기고 조용히 통과**한다 — 발행 시점에 `_composition_leaders_exist_in_players`가
 * 이미 422로 걸렀으므로 여기서 다시 던지면 구판 하나 때문에 페이지 전체가 죽는다(wrong < missing).
 */
export function joinLeaders(items, players) {
  const byName = new Map((players || []).filter((p) => p && p.name).map((p) => [p.name, p]))
  return (items || []).map((it) => ({
    ...it,
    leaderChips: (Array.isArray(it.leaders) ? it.leaders : []).map((name) => {
      const p = byName.get(name)
      return p
        ? { name, tech_level: p.tech_level, ticker: p.ticker ?? null, country: p.country ?? null }
        : { name, tech_level: null, ticker: null, country: null }
    }),
  }))
}

/** 표시용 — `share_pct`는 5의 배수라 소수점이 없다(40.0 → "40%"). */
export function formatShare(v) {
  return Number.isFinite(v) ? `${Number.isInteger(v) ? v : v.toFixed(1)}%` : ''
}

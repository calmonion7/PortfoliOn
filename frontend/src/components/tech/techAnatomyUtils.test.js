import { describe, it, expect } from 'vitest'
import { AXIS_META, SEGMENT_TOKENS, segmentColor, deriveAxes, joinLeaders, formatShare } from './techAnatomyUtils'
import { LIVE_SSB } from './__fixtures__/techAnatomy.fixture'

// 기술 해부 순수함수 (ADR-0042, task#306 S1).
//
// ⚠️ 픽스처가 *분기를 실제로 타는지*를 별도로 단언한다 — 이빨(판별력)과 커버리지(분기 진입)는
// 다른 축이고, 전자를 갖췄다는 사실이 후자의 알리바이가 되지 않는다(task#301 실사례:
// 두 픽스처 모두 `category`가 없어 groupByCategory가 []를 반환 → 그룹핑 분기를 아예 안 탔는데
// 이빨 단언을 갖춘 테스트가 초록으로 통과했다).

describe('픽스처가 실제로 각 분기를 타는가 (게이트 함수 직접 적용)', () => {
  it('deriveAxes가 3축 전부를 반환한다 — 축 필터 분기를 실제로 지나간다', () => {
    expect(deriveAxes(LIVE_SSB.composition).length).toBe(3)
  })

  it('leaders가 비어있지 않은 항목이 있어 조인 분기를 탄다', () => {
    const withLeaders = LIVE_SSB.composition.tech.filter((t) => (t.leaders || []).length > 0)
    expect(withLeaders.length).toBeGreaterThan(0)
  })

  it('producers가 비어있지 않은 광물이 있어 채굴사 칩 분기를 탄다', () => {
    const withProducers = LIVE_SSB.composition.minerals.filter((m) => (m.producers || []).length > 0)
    expect(withProducers.length).toBeGreaterThan(0)
  })

  it('「칩 없음」 분기도 덮는다 — 라이브 판은 5종 모두 producers가 있으므로 변형으로 판다', () => {
    // ⚠️ 이 단언이 라이브 픽스처만으로 통과할 것이라 기대했으나 실제로는 0이었다(2026-08-19 판의
    // 광물 5종이 전부 producers를 갖는다). `producers`는 선택 필드라 **빈 경우가 프로덕션에서
    // 실제로 도달 가능**하므로, 완화하지 않고 라이브 *형태*에서 파생한 변형으로 그 분기를 덮는다.
    const populated = LIVE_SSB.composition.minerals.filter((m) => (m.producers || []).length > 0)
    expect(populated.length).toBe(LIVE_SSB.composition.minerals.length)   // 현 라이브 상태를 못박음

    const stripped = LIVE_SSB.composition.minerals.map((m) => ({ ...m, producers: [] }))
    const axis = deriveAxes({ minerals: stripped })[0]
    expect(axis.items.every((i) => (i.producers || []).length === 0)).toBe(true)
    expect(axis.items.length).toBe(stripped.length)   // 칩이 없다고 항목이 사라지지 않는다
  })
})

describe('deriveAxes', () => {
  it('축 순서는 AXIS_META 순서다 — 기술 → 광물 → 전문가', () => {
    expect(deriveAxes(LIVE_SSB.composition).map((a) => a.key)).toEqual(['tech', 'minerals', 'experts'])
  })

  it('각 축이 기준 문구를 갖는다 — 세 자가 이름 없이 섞이는 것을 막는 유일한 장치다', () => {
    const axes = deriveAxes(LIVE_SSB.composition)
    expect(axes.map((a) => a.basis)).toEqual(['남은 난제 총량 기준', '원재료비 기준', '인력 병목 총량 기준'])
    // 이빨 — 세 기준이 서로 달라야 의미가 있다(같으면 문구가 있어도 축을 못 가른다)
    expect(new Set(axes.map((a) => a.basis)).size).toBe(3)
  })

  it('빈 축은 제외한다 — 루틴이 모르는 축은 통째로 생략된다', () => {
    const only = deriveAxes({ experts: LIVE_SSB.composition.experts })
    expect(only.map((a) => a.key)).toEqual(['experts'])
  })

  it('null·빈 객체는 축 0개', () => {
    expect(deriveAxes(null)).toEqual([])
    expect(deriveAxes(undefined)).toEqual([])
    expect(deriveAxes({})).toEqual([])
  })

  it('share_pct가 비유한값인 항목은 떨군다 — 막대가 깨지지 않게 (구판 방어)', () => {
    const axes = deriveAxes({
      experts: [
        { name: 'A', share_pct: 50, rationale: 'r' },
        { name: 'B', share_pct: null, rationale: 'r' },
        { name: 'C', share_pct: 50, rationale: 'r' },
      ],
    })
    expect(axes[0].items.map((i) => i.name)).toEqual(['A', 'C'])
  })

  it('실데이터의 축별 합이 정확히 100이다 — 막대가 꽉 차는 것이 Σ=100의 시각적 진술이다', () => {
    for (const axis of deriveAxes(LIVE_SSB.composition)) {
      expect(axis.items.reduce((s, i) => s + i.share_pct, 0)).toBe(100)
    }
  })
})

describe('segmentColor', () => {
  it('항목 순서 기준 결정론적 배정', () => {
    expect(segmentColor(0)).toBe('var(--data-1)')
    expect(segmentColor(4)).toBe('var(--data-5)')
    expect(segmentColor(5)).toBe('var(--data-1)')   // 순환
  })

  it('인접한 두 조각은 항상 다른 색이다 — 상한 7까지', () => {
    for (let i = 0; i < 6; i++) expect(segmentColor(i)).not.toBe(segmentColor(i + 1))
  })

  it('실데이터 각 축에서 색 배정이 항목과 1:1이고 인접 중복이 없다', () => {
    for (const axis of deriveAxes(LIVE_SSB.composition)) {
      const colors = axis.items.map((i) => i.color)
      expect(colors.length).toBe(axis.items.length)
      expect(colors.every((c) => SEGMENT_TOKENS.some((t) => c.includes(t)))).toBe(true)
      for (let i = 0; i < colors.length - 1; i++) expect(colors[i]).not.toBe(colors[i + 1])
    }
  })
})

describe('joinLeaders', () => {
  const tech = LIVE_SSB.composition.tech
  const players = LIVE_SSB.players

  it('players에 있는 이름은 기술수준·티커·국가를 얻는다', () => {
    const joined = joinLeaders(tech, players)
    const chips = joined.flatMap((t) => t.leaderChips)
    expect(chips.length).toBeGreaterThan(0)
    // 실데이터의 모든 leader는 players에 실재한다(발행 시점 422 게이트가 보장)
    expect(chips.every((c) => Number.isFinite(c.tech_level))).toBe(true)
    // 이빨 — 조인이 실제로 값을 가져왔는지(전부 null이면 위 단언이 무의미)
    const samsung = chips.find((c) => c.name === '삼성SDI')
    expect(samsung?.tech_level).toBe(5)
  })

  it('players에 없는 이름은 이름만 남기고 조용히 통과한다 — 던지지 않는다', () => {
    const joined = joinLeaders([{ name: 'X', share_pct: 100, rationale: 'r', leaders: ['없는업체'] }], players)
    expect(joined[0].leaderChips).toEqual([{ name: '없는업체', tech_level: null, ticker: null, country: null }])
  })

  it('leaders가 없거나 players가 비어도 안전하다', () => {
    expect(joinLeaders([{ name: 'X', share_pct: 100, rationale: 'r' }], players)[0].leaderChips).toEqual([])
    expect(joinLeaders(tech, [])[0].leaderChips.every((c) => c.tech_level === null)).toBe(true)
    expect(joinLeaders(null, null)).toEqual([])
  })
})

describe('formatShare', () => {
  it('5의 배수는 소수점 없이', () => {
    expect(formatShare(40)).toBe('40%')
    expect(formatShare(40.0)).toBe('40%')
  })
  it('비유한값은 빈 문자열', () => {
    expect(formatShare(null)).toBe('')
    expect(formatShare(NaN)).toBe('')
  })
})

describe('AXIS_META', () => {
  it('세 축이고 key가 백엔드 Composition 필드명과 바이트 동일하다', () => {
    expect(AXIS_META.map((m) => m.key)).toEqual(['tech', 'minerals', 'experts'])
  })
})

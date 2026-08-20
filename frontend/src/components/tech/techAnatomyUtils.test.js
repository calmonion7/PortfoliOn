import { describe, it, expect } from 'vitest'
import { AXIS_META, SEGMENT_TOKENS, segmentColor, deriveAxes, joinLeaders, formatShare, itemCompanies, crossHoldings, buildCompanyIndex, trackedState } from './techAnatomyUtils'
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

// ─────────────────────────────────────────────────────────────────────────────
// crossHoldings — 보유·관심 종목 × 기술/광물 축 교차 (task#315 S1)
//
// ⚠️ **광물 축은 라이브에서 dormant했다 — 2026-08-20 스냅샷이고 유효기간이 있다**: 그 날
// 실측으로 테스트 계정 추적 26종목 ↔ 라이브 발행분의 `producers[].ticker` 17개 겹침이 **0건**
// 이었다(기술축은 4건 — 000660·005930·035420·TSLA). 추적 목록·발행 producers 둘 다 하루 단위로
// 변하므로 **이 문장을 근거로 「검증/미검증」을 판정하지 말 것**: 프로브가 실행 시점에
// `producers[].ticker ∩ /api/stocks`를 계산해 0이면 「미검증」 라벨을 출력에 실어야 한다.
// 그동안 광물축 교차는 **여기 픽스처가 유일한 검증 수단**이다.
// 라이브에서 밟으려고 종목을 추가하지 않는다(사용자 확정).
const PLAYERS = LIVE_SSB.players
const AXES = deriveAxes(LIVE_SSB.composition)

describe('crossHoldings 픽스처가 실제로 각 분기를 타는가 (게이트 함수 직접 적용)', () => {
  // 이빨(not.toEqual)은 판별력을 보장하지 **분기 진입**을 보장하지 않는다(task#301).
  // 아래 4줄이 「이 픽스처가 그 경로를 지나간다」의 증명이다.

  it('기술 축 분기 진입 — 티커를 가진 선도기업이 실재한다', () => {
    const withTicker = itemCompanies('tech', LIVE_SSB.composition.tech[0], PLAYERS).filter((c) => c.ticker)
    expect(withTicker.map((c) => c.ticker)).toEqual(['006400', 'TM'])   // 삼성SDI·토요타
  })

  it('광물 축 분기 진입 — producers 티커가 실재하고 그 경로로 hit이 잡힌다 (픽스처 전용 축)', () => {
    expect(itemCompanies('minerals', LIVE_SSB.composition.minerals[0], PLAYERS).map((c) => c.ticker))
      .toEqual(['ALB', 'SQM', '002460'])
    // 기술 축을 통째로 뺀 판 → mineralItemHits가 오직 광물 경로에서만 나온 것임이 확정된다
    const mineralsOnly = deriveAxes({ minerals: LIVE_SSB.composition.minerals })
    const r = crossHoldings({ axes: mineralsOnly, players: PLAYERS, stockMap: { VALE: 'holding' } })
    expect(r.mineralItemHits).toBe(1)
    expect(r.techItemHits).toBe(0)
  })

  it('「대조할 수 없는 업체」 분기 진입 — 라이브 판에 실제로 존재한다', () => {
    // Gotion(궈쉬안)=players ticker null · 칭산홀딩스=producers ticker null
    // + 간펑리튬(002460)·CMOC(603993)=CN 6자리라 KR 코드와 충돌해 대조 불가(finding 1).
    // 이데미쓰코산은 기술축에선 null이지만 광물축에서 5019를 얻으므로 **세지 않는다**.
    // ⚠️ 이 수는 2였다 — finding 1 수정으로 「다른 시장의 6자리 코드」가 세 번째 원인으로
    // 추가됐다(숨기지 않고 부기로 노출한다).
    expect(crossHoldings({ axes: AXES, players: PLAYERS, stockMap: {} }).unmatchedCount).toBe(4)
  })

  it('전문가 축은 원리적으로 대상이 아니다 — 업체 목록 자체가 빈다 (ADR-0042 결정 4)', () => {
    expect(itemCompanies('experts', LIVE_SSB.composition.experts[0], PLAYERS)).toEqual([])
  })
})

describe('crossHoldings', () => {
  it('ⓐ 겹침 있음 — 보유·관심을 섞지 않고 항목 수를 축별로 센다', () => {
    const r = crossHoldings({ axes: AXES, players: PLAYERS, stockMap: { '006400': 'holding', ALB: 'watchlist' } })
    expect(r.holdingTickers).toEqual(['006400'])         // 삼성SDI
    expect(r.watchTickers).toEqual(['ALB'])              // 앨버말(리튬)
    expect(r.techItemHits).toBe(2)                       // 대면적 성막 · 고전류밀도 두 난제에 걸렸다
    expect(r.mineralItemHits).toBe(1)                    // 리튬
    expect(r.measurable).toBe(true)
    // 이빨 — 판에 있는 다른 티커까지 긁어오면 위 단언이 무의미해진다
    expect(r.holdingTickers).not.toContain('TM')
    expect(r.watchTickers).not.toContain('SQM')
  })

  it('ⓑ 겹침 0 + 미매칭 있음 — 「없음」과 「못 잼」이 갈린다', () => {
    const r = crossHoldings({ axes: AXES, players: PLAYERS, stockMap: { AAPL: 'holding' } })
    expect(r.holdingTickers).toEqual([])
    expect(r.watchTickers).toEqual([])
    expect(r.techItemHits).toBe(0)
    expect(r.mineralItemHits).toBe(0)
    expect(r.unmatchedCount).toBe(4)  // 티커 없음 2 + CN 6자리 2 (finding 1)
    expect(r.measurable).toBe(true)   // 잴 수는 있었고, 그 결과가 0이다 — 이게 ⓐ상태다
  })

  it('ⓒ measurable === false — 티커를 가진 업체가 하나도 없는 판은 물어볼 수 없다', () => {
    const namelessPlayers = PLAYERS.map((p) => ({ ...p, ticker: null }))
    const axes = deriveAxes({ tech: LIVE_SSB.composition.tech })
    const r = crossHoldings({ axes, players: namelessPlayers, stockMap: { '006400': 'holding' } })
    expect(r.measurable).toBe(false)
    expect(r.techItemHits).toBe(0)
    expect(r.unmatchedCount).toBeGreaterThan(0)   // 업체는 있는데 티커가 없다
  })

  it('ⓓ 전문가 축만 있는 판 — measurable false, 미매칭도 0(업체 개념이 없다)', () => {
    const axes = deriveAxes({ experts: LIVE_SSB.composition.experts })
    expect(axes.map((a) => a.key)).toEqual(['experts'])   // 이 판이 정말 전문가 축만인지 못박음
    const r = crossHoldings({ axes, players: PLAYERS, stockMap: { '006400': 'holding', ALB: 'holding' } })
    expect(r).toEqual({
      holdingTickers: [], watchTickers: [], techItemHits: 0, mineralItemHits: 0,
      unmatchedCount: 0, measurable: false,
    })
  })

  it('ⓔ producers 없는 판 — 광물 축은 0이지만 기술 축은 계속 잰다', () => {
    const axes = deriveAxes({
      tech: LIVE_SSB.composition.tech,
      minerals: LIVE_SSB.composition.minerals.map((m) => ({ ...m, producers: [] })),
    })
    expect(axes.map((a) => a.key)).toEqual(['tech', 'minerals'])   // 광물 항목은 남아 있다
    const r = crossHoldings({ axes, players: PLAYERS, stockMap: { '006400': 'holding', ALB: 'watchlist' } })
    expect(r.mineralItemHits).toBe(0)
    expect(r.watchTickers).toEqual([])      // ALB는 이 판에 등장하지 않는다
    expect(r.techItemHits).toBe(2)
    expect(r.measurable).toBe(true)
  })

  it('ⓕ 같은 티커가 두 축에 동시 등장 — 종목은 1개, 항목 hit은 축별로 1씩', () => {
    // 라이브 형태에서 파생: Vale를 players에 올려 기술 축 선도기업으로도 등장시킨다.
    const players = [...PLAYERS, { name: 'Vale', country: '브라질', ticker: 'VALE', tech_level: 3 }]
    const tech = [{ name: '원료 조달', share_pct: 100, rationale: 'r', leaders: ['Vale'] }]
    const axes = deriveAxes({ tech, minerals: LIVE_SSB.composition.minerals })
    const r = crossHoldings({ axes, players, stockMap: { VALE: 'holding' } })
    expect(r.holdingTickers).toEqual(['VALE'])   // 중복 카운트 없음 — 종목 1개다
    expect(r.techItemHits).toBe(1)
    expect(r.mineralItemHits).toBe(1)            // 니켈 — 축을 가로질러 합산하지 않는다(ADR-0042 결정 2)
  })

  it('빈 인자·null에 안전하다 — measurable false로 떨어진다', () => {
    expect(crossHoldings()).toEqual({
      holdingTickers: [], watchTickers: [], techItemHits: 0, mineralItemHits: 0,
      unmatchedCount: 0, measurable: false,
    })
    expect(crossHoldings({ axes: null, players: null, stockMap: null }).measurable).toBe(false)
    expect(crossHoldings({ axes: AXES, players: PLAYERS }).holdingTickers).toEqual([])   // stockMap 없음
  })

  it('holding/watchlist 아닌 값은 무시한다 — 미추적(none)이 hit이 되면 요약이 거짓이 된다', () => {
    const r = crossHoldings({ axes: AXES, players: PLAYERS, stockMap: { '006400': 'none', ALB: undefined } })
    expect(r.holdingTickers).toEqual([])
    expect(r.techItemHits).toBe(0)
    expect(r.mineralItemHits).toBe(0)
  })
})

describe('crossHoldings — 전문가 축 배제가 load-bearing인가 (fault-injection 대조)', () => {
  // 위 ⓓ만으로는 이 축의 **이빨이 없었다**: 라이브 전문가 항목엔 업체 필드가 아예 없어서
  // 「축 키 필터」를 지워도 31개가 전부 통과했다(주입 실측). 즉 방어가 두 겹인데
  // 어느 것도 단독으로 load-bearing이 아니었다(CLAUDE.md task#305의 그 구별).
  // 그래서 **업체 필드를 실은 전문가 축**으로 대조군을 만든다 — 「모든 축을 균일하게 순회」라는
  // 그럴듯한 리팩터가 정확히 이 형태로 결정 4를 깨뜨린다.
  it('전문가 항목이 producers·leaders를 실어도 한 건도 세지 않는다 (ADR-0042 결정 4)', () => {
    const axes = deriveAxes({
      experts: LIVE_SSB.composition.experts.map((e) => ({
        ...e,
        leaders: ['삼성SDI'],
        producers: [{ name: '앨버말', ticker: 'ALB', country: 'US', share_pct: null }],
      })),
    })
    const r = crossHoldings({ axes, players: PLAYERS, stockMap: { '006400': 'holding', ALB: 'watchlist' } })
    expect(r.holdingTickers).toEqual([])
    expect(r.watchTickers).toEqual([])
    expect(r.techItemHits + r.mineralItemHits).toBe(0)
    expect(r.measurable).toBe(false)      // 전문가 축만인 판은 「0」이 아니라 「못 잼」이다
    expect(r.unmatchedCount).toBe(0)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// 적대검토 후속 (task#315) — 티커 매칭의 두 결함
//
// ⚠️ 이 저장소가 추적하는 티커 공간은 **KR(6자리 숫자) · US(알파벳)** 둘뿐이다
// (`/api/stocks`의 market은 KR 아니면 US). 그래서 **6자리 숫자 티커는 KR 종목코드**이고,
// 같은 형태를 쓰는 해외 거래소(선전·상하이)의 업체와 **문자 그대로 충돌**한다.
describe('crossHoldings — 6자리 숫자 티커의 시장 충돌 (finding 1)', () => {
  it('CN 6자리(간펑리튬 002460)는 KR 종목코드와 충돌하므로 대조하지 않는다', () => {
    // 002460은 KOSPI 실재 종목코드다(kospi_tickers.json). 사용자가 그걸 보유하면
    // 중국 리튬 채굴사가 「내 보유 종목」으로 선언돼 화면이 투자판단용 거짓을 말한다.
    const r = crossHoldings({ axes: AXES, players: PLAYERS, stockMap: { '002460': 'holding' } })
    expect(r.holdingTickers).toEqual([])
    expect(r.mineralItemHits).toBe(0)
  })

  it('대조군 — 한국 업체의 6자리(삼성SDI 006400)는 계속 대조된다', () => {
    const r = crossHoldings({ axes: AXES, players: PLAYERS, stockMap: { '006400': 'holding' } })
    expect(r.holdingTickers).toEqual(['006400'])
    expect(r.techItemHits).toBe(2)
  })

  it('대조군 — 알파벳 티커는 국가 무관 대조(토요타 TM = 일본 기업의 US ADR)', () => {
    const r = crossHoldings({ axes: AXES, players: PLAYERS, stockMap: { TM: 'watchlist' } })
    expect(r.watchTickers).toEqual(['TM'])
  })

  it('대조 불가 업체는 부기에 남는다 — 숨기지 않는다', () => {
    // Gotion·칭산홀딩스(티커 없음) + 간펑리튬·CMOC(CN 6자리라 대조 불가) = 4곳
    expect(crossHoldings({ axes: AXES, players: PLAYERS, stockMap: {} }).unmatchedCount).toBe(4)
  })

  it('대조 가능한 티커가 하나도 없는 판은 measurable=false — CN 6자리만 있는 광물축', () => {
    const cnOnly = deriveAxes({
      minerals: LIVE_SSB.composition.minerals.map((m) => ({
        ...m, producers: [{ name: '간펑리튬', ticker: '002460', country: 'CN', share_pct: null }],
      })),
    })
    expect(crossHoldings({ axes: cnOnly, players: [], stockMap: { '002460': 'holding' } }).measurable).toBe(false)
  })
})

describe('crossHoldings — 축 간 티커 해결 (finding 6·11)', () => {
  // 이데미쓰코산: players[].ticker=null · minerals[4].producers[0].ticker='5019'
  // (같은 발행 페이로드 안). 축-로컬 티커만 보면 광물축에서만 ◆가 붙고 기술축은 무표시가 된다.
  it('한 축에서 얻은 티커를 다른 축에서도 쓴다 — 같은 회사가 갈라지지 않는다', () => {
    const r = crossHoldings({ axes: AXES, players: PLAYERS, stockMap: { 5019: 'holding' } })
    expect(r.holdingTickers).toEqual(['5019'])
    expect(r.techItemHits).toBe(1)      // 「전해질 소재 양산·연속화」 — 이데미쓰코산 단독
    expect(r.mineralItemHits).toBe(1)   // 「황·인(P2S5 원료)」
  })

  it('buildCompanyIndex가 두 소스를 합친다 — players 우선, 없으면 producers', () => {
    const idx = buildCompanyIndex({ axes: AXES, players: PLAYERS })
    expect(idx.get('삼성SDI').ticker).toBe('006400')
    expect(idx.get('이데미쓰코산').ticker).toBe('5019')   // players는 null인데 producers가 준다
    expect(idx.get('이데미쓰코산').country).toBe('JP')    // 국가도 함께 — 6자리 가드가 오배제하지 않게
    expect(idx.has('Gotion(궈쉬안)')).toBe(false)         // 어디에도 티커가 없다
  })

  it('joinLeaders가 인덱스로 티커·국가를 채운다 — 칩 마커가 축 간에 일치한다', () => {
    const idx = buildCompanyIndex({ axes: AXES, players: PLAYERS })
    const chips = joinLeaders(LIVE_SSB.composition.tech, PLAYERS, idx).flatMap((t) => t.leaderChips)
    expect(chips.find((c) => c.name === '이데미쓰코산').ticker).toBe('5019')
    expect(chips.find((c) => c.name === 'Gotion(궈쉬안)').ticker).toBeNull()
  })
})

describe('축 간 폴백이 6자리 가드에 걸리지 않는다 (내 수정끼리의 상호작용)', () => {
  // finding 6·11의 폴백은 티커만 옮기면 **국가가 null로 남아** finding 1의 6자리 가드가
  // 그 업체를 오히려 배제한다 — 두 수정이 서로를 무력화하는 자리다. 그래서 인덱스가
  // `{ticker, country}`를 함께 싣는다. 이빨: `?? e?.country`를 지우면 이 테스트가 깨진다.
  it('players에 없는 이름이 producers에서 KR 6자리를 얻어도 대조된다', () => {
    const tech = [{
      name: '국내 소재 조달', share_pct: 100, rationale: 'r',
      leaders: ['한국소재'],   // players에 없다 → dangling
    }]
    const minerals = LIVE_SSB.composition.minerals.map((m, i) => (i === 0
      ? { ...m, producers: [{ name: '한국소재', ticker: '123456', country: 'KR', share_pct: null }] }
      : m))
    const axes = deriveAxes({ tech, minerals })
    const r = crossHoldings({ axes, players: PLAYERS, stockMap: { 123456: 'holding' } })
    expect(r.holdingTickers).toEqual(['123456'])
    expect(r.techItemHits).toBe(1)      // 폴백이 국가까지 옮기지 않으면 0이 된다
    expect(r.mineralItemHits).toBe(1)
  })
})

describe('trackedState — 마커·배지·요약이 공유하는 단일 판정 (finding 1·15)', () => {
  it('대조 가능 티커만 상태를 준다', () => {
    expect(trackedState({ '006400': 'holding' }, { ticker: '006400', country: '한국' })).toBe('holding')
    expect(trackedState({ '002460': 'holding' }, { ticker: '002460', country: 'CN' })).toBeNull()
    expect(trackedState({ TM: 'watchlist' }, { ticker: 'TM', country: '일본' })).toBe('watchlist')
    expect(trackedState({ '006400': 'none' }, { ticker: '006400', country: '한국' })).toBeNull()
    expect(trackedState({}, { ticker: null, country: '한국' })).toBeNull()
  })
})

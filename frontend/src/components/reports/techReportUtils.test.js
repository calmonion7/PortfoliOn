import { describe, it, expect } from 'vitest'
import {
  formatMarketSize, splitSeries, formatMarketSummary, TECH_NAMES, TECH_LEVEL_LABELS,
  deriveTechKpis, sortPlayers, parseDescriptionSections,
} from './techReportUtils'

// 선도기술 리포트(ADR-0033, task#276 S5) 순수 헬퍼 — red-first(TDD 대상은 formatMarketSize·splitSeries).

describe('formatMarketSize — 통화·단위 그대로 표시(환산 없음, ADR-0033)', () => {
  it('USD bn → $12.5B', () => {
    expect(formatMarketSize({ value: 12.5, currency: 'USD', unit: 'bn' })).toBe('$12.5B')
  })
  it('KRW tn → 3조원', () => {
    expect(formatMarketSize({ value: 3, currency: 'KRW', unit: 'tn' })).toBe('3조원')
  })
  it('KRW mn → 340백만원', () => {
    expect(formatMarketSize({ value: 340, currency: 'KRW', unit: 'mn' })).toBe('340백만원')
  })
  it('1자리 소수로 반올림', () => {
    expect(formatMarketSize({ value: 12.34, currency: 'USD', unit: 'mn' })).toBe('$12.3M')
  })
  it('enum 밖 currency → null', () => {
    expect(formatMarketSize({ value: 1, currency: 'JPY', unit: 'bn' })).toBeNull()
  })
  it('enum 밖 unit → null', () => {
    expect(formatMarketSize({ value: 1, currency: 'USD', unit: 'eok' })).toBeNull()
  })
  it('value가 숫자가 아니면 null', () => {
    expect(formatMarketSize({ value: NaN, currency: 'USD', unit: 'bn' })).toBeNull()
    expect(formatMarketSize({ value: '12', currency: 'USD', unit: 'bn' })).toBeNull()
  })
  it('size 자체가 없으면 null', () => {
    expect(formatMarketSize(null)).toBeNull()
    expect(formatMarketSize(undefined)).toBeNull()
  })
})

describe('splitSeries — history/forecast 경계와 빈 배열 처리', () => {
  it('연도순 정렬(입력이 뒤섞여도)', () => {
    const market = {
      history: [{ year: 2023, size: { value: 1, currency: 'USD', unit: 'bn' } }, { year: 2021, size: { value: 1, currency: 'USD', unit: 'bn' } }],
      forecast: [{ year: 2030, size: { value: 2, currency: 'USD', unit: 'bn' } }, { year: 2028, size: { value: 2, currency: 'USD', unit: 'bn' } }],
    }
    const { history, forecast } = splitSeries(market)
    expect(history.map(p => p.year)).toEqual([2021, 2023])
    expect(forecast.map(p => p.year)).toEqual([2028, 2030])
  })
  it('market이 undefined면 두 배열 모두 빈 배열', () => {
    expect(splitSeries(undefined)).toEqual({ history: [], forecast: [] })
  })
  it('한쪽 배열만 있어도 나머지는 빈 배열(배열이 아닌 값도 안전)', () => {
    expect(splitSeries({ history: [{ year: 2024, size: { value: 1, currency: 'USD', unit: 'bn' } }] })).toEqual({
      history: [{ year: 2024, size: { value: 1, currency: 'USD', unit: 'bn' } }],
      forecast: [],
    })
    expect(splitSeries({ history: null, forecast: undefined })).toEqual({ history: [], forecast: [] })
  })
})

describe('formatMarketSummary — 텍스트 요약(차트는 2/2 몫)', () => {
  const market = {
    history: [{ year: 2024, size: { value: 12.5, currency: 'USD', unit: 'bn' } }],
    forecast: [{ year: 2030, size: { value: 30.5, currency: 'USD', unit: 'bn' } }],
    cagr_pct: 12.3, as_of: '2026-08-03',
  }
  it('현재 → 예상, CAGR', () => {
    expect(formatMarketSummary(market)).toBe('$12.5B (2024) → $30.5B (2030), CAGR 12.3%')
  })
  it('history/forecast 둘 다 비면 null', () => {
    expect(formatMarketSummary({ as_of: '2026-08-03' })).toBeNull()
  })
  it('한쪽만 있어도 요약(CAGR 없으면 생략)', () => {
    expect(formatMarketSummary({ history: market.history })).toBe('$12.5B (2024)')
  })
})

// ── task#280 S2·S3·S4 (KPI 스트립 / 업체 표 정렬 / 산문 섹션 분해) ────────────────

// 라이브 SMR 발행분 형태(2026-08-04): cagr_pct null · share_pct 전무 · gap_years === 0 이 2곳.
// ⚠️ 선두 업체명은 라이브 실값 `CNNC (중국핵공업집단)` 그대로 둔다(부연 괄호 포함). 짧은 이름으로
//    바꿔 두면 "선두 칩이 최장 값"이라는 사실이 픽스처에서 사라지고, 실제로 그 때문에 F2 진단이
//    시장 규모 칩을 최장으로 오인했다(레이아웃 근거가 픽스처에 의존한다).
const SMR = {
  difficulty: { score: 4, rationale: '…' },
  market: {
    history: [{ year: 2024, size: { value: 5.8, currency: 'USD', unit: 'bn' } }],
    forecast: [
      { year: 2030, size: { value: 9.6, currency: 'USD', unit: 'bn' } },
      { year: 2035, size: { value: 15.2, currency: 'USD', unit: 'bn' } },
    ],
    cagr_pct: null,
    as_of: '2026-08-04',
  },
  players: [
    { name: 'CNNC (중국핵공업집단)', country: '중국', tech_level: 5, gap_years: 0, leader_name: 'CNNC (링룽 1호)', state_led: true },
    { name: 'Rosatom', country: '러시아', tech_level: 5, gap_years: 0, leader_name: 'CNNC (링룽 1호)', state_led: true },
    { name: 'NuScale', country: '미국', tech_level: 4, gap_years: 3, leader_name: 'CNNC (링룽 1호)', ticker: 'SMR', state_led: false },
    { name: 'GE Vernova', country: '미국', tech_level: 4, gap_years: 5, ticker: 'GEV', state_led: false },
    { name: '두산에너빌리티', country: '한국', tech_level: 4, gap_years: null, ticker: '034020', state_led: false },
    { name: 'X-energy', country: '미국', tech_level: 3, gap_years: 6, state_led: false },
    { name: 'Terrestrial', country: '캐나다', tech_level: 3, gap_years: null, state_led: false },
    { name: 'Rolls-Royce', country: '영국', tech_level: 3, gap_years: 4, state_led: false },
    { name: '한국원자력연구원', country: '한국', tech_level: 4, gap_years: 4, state_led: true },
  ],
}

// 라이브 reusable-rocket 발행분 형태(2026-08-04): players 8 · cagr_pct 12.97 · 선두 1곳(SpaceX) ·
// leader_name에 부연 괄호 · share_pct 실값 1건. SMR 판만 보면 "선두 복수"·"cagr null" 분기만 덮여
// 단수 선두·실 cagr 조합이 미검증으로 남는다(실제로 그래서 놓쳤다 — 두 판을 함께 둔다).
const RR = {
  difficulty: { score: 4, rationale: '…' },
  market: {
    history: [{ year: 2025, size: { value: 8.44, currency: 'USD', unit: 'bn' } }],
    forecast: [{ year: 2034, size: { value: 32.08, currency: 'USD', unit: 'bn' } }],
    cagr_pct: 12.97,
    as_of: '2026-08-04',
  },
  players: [
    { name: 'SpaceX', country: '미국', tech_level: 5, gap_years: 0, leader_name: 'SpaceX (Grasshopper 호핑 2013년)', share_pct: 50.9 },
    { name: 'Blue Origin', country: '미국', tech_level: 4, gap_years: 9, leader_name: 'SpaceX (Grasshopper 호핑 2013년)' },
    { name: 'LandSpace (란드스페이스)', country: '중국', tech_level: 3, gap_years: 10, leader_name: 'SpaceX (Grasshopper 호핑 2013년)' },
    { name: 'Rocket Lab', country: '미국', tech_level: 3, gap_years: 11, leader_name: 'SpaceX (Grasshopper 호핑 2013년)' },
    { name: 'Relativity Space', country: '미국', tech_level: 2, gap_years: 11, leader_name: 'SpaceX (Grasshopper 호핑 2013년)' },
    { name: 'Stoke Space', country: '미국', tech_level: 2, gap_years: 11, leader_name: 'SpaceX (Grasshopper 호핑 2013년)' },
    { name: 'ArianeGroup·ESA (Themis)', country: '유럽', tech_level: 2, gap_years: 13, leader_name: 'SpaceX (Grasshopper 호핑 2013년)' },
    { name: 'CNES·DLR·JAXA (Callisto)', country: '유럽·일본', tech_level: 1, gap_years: 13, leader_name: 'SpaceX (Grasshopper 호핑 2013년)' },
  ],
}

const kpiMap = (report) => Object.fromEntries(deriveTechKpis(report).map(c => [c.label, c.value]))

describe('deriveTechKpis — KPI 스트립 6칩(결측은 추정 없이 —, ADR-0033 결정 3)', () => {
  it('SMR 실응답 형태: 6칩이 기대대로이고 CAGR만 —', () => {
    const chips = deriveTechKpis(SMR)
    expect(chips).toHaveLength(6)
    expect(chips.map(c => c.label)).toEqual(['기술난이도', '선두 업체', '시장 규모', 'CAGR', '주요 업체', '양산상용'])
    const m = kpiMap(SMR)
    expect(m['기술난이도']).toBe('4/5')
    // gap_years === 0 이 2곳 → 첫 1곳 + "+1" (0을 falsy로 흘리면 여기서 —가 되어 실패한다)
    expect(m['선두 업체']).toBe('CNNC (중국핵공업집단) +1')
    // 시장 규모는 formatMarketSize/splitSeries 재사용 — 새 환산 금지(ADR-0033 결정 3)
    expect(m['시장 규모']).toBe('$5.8B → $15.2B')
    expect(m['CAGR']).toBe('—')          // cagr_pct: null → 산문(8.78%)에서 긁어오지 않는다
    expect(m['주요 업체']).toBe('9곳')
    expect(m['양산상용']).toBe('2곳')    // tech_level === 5 개수
    // 결측 칩은 CAGR 하나뿐
    expect(chips.filter(c => c.value === '—').map(c => c.label)).toEqual(['CAGR'])
  })

  it('players: [] · market: {} 빈 입력 → 예외 없이 전 칩 —', () => {
    const chips = deriveTechKpis({ players: [], market: {} })
    expect(chips).toHaveLength(6)
    expect(chips.every(c => c.value === '—')).toBe(true)
  })

  it('report 자체가 null/undefined여도 예외 없이 전 칩 —', () => {
    expect(deriveTechKpis(null).every(c => c.value === '—')).toBe(true)
    expect(deriveTechKpis(undefined)).toHaveLength(6)
  })

  it('gap_years가 전부 null이면 선두 칩 —(0을 선두로 오인하는 falsy 버그 차단)', () => {
    const m = kpiMap({ ...SMR, players: SMR.players.map(p => ({ ...p, gap_years: null })) })
    expect(m['선두 업체']).toBe('—')
    expect(m['주요 업체']).toBe('9곳')   // 다른 칩은 그대로 파생된다
  })

  it('선두가 정확히 1곳이면 "+N" 없이 업체명만', () => {
    const players = [{ name: 'NuScale', tech_level: 5, gap_years: 0 }, { name: 'GEV', tech_level: 4, gap_years: 2 }]
    expect(kpiMap({ ...SMR, players })['선두 업체']).toBe('NuScale')
  })

  it('reusable-rocket 형태(cagr_pct 12.97) → CAGR 칩이 실값', () => {
    const m = kpiMap({ ...SMR, market: { ...SMR.market, cagr_pct: 12.97 } })
    expect(m['CAGR']).toBe('12.97%')
  })

  // ⚠️ 이 케이스의 기대값을 뒤집었다(F6). 종전 기대는 `'$5.8B'`(연도 없음)였는데, 백엔드 Market 모델은
  //    history·forecast 둘 다 기본값 []이라 **단측 발행이 유효**하고, 그때 연도 없는 금액 하나는
  //    "지금 시장 규모"로 읽힌다 — forecast-only 판에서는 2035년 전망치가 현재값으로 오독되고 같은
  //    페이지 아래 시장 규모 섹션의 `$15.2B (2035)`와 정면으로 모순된다.
  //    task#264 절차로 판별: plan.md S2는 「시장 규모 {현재}→{예상}」만 정하고 단측 표기를 결정한 바가
  //    없다(완료기준 ①②③에도 없다) → 기록된 결정이 아니라 부수적 단언이므로 뒤집는 것이 옳다.
  it('history만 있으면 연도를 붙여 "지금"임을 밝힌다(F6)', () => {
    const m = kpiMap({ ...SMR, market: { history: SMR.market.history, as_of: '2026-08-04' } })
    expect(m['시장 규모']).toBe('$5.8B (2024)')
  })

  it('forecast만 있으면 연도를 붙여 전망치임을 밝힌다 — 현재값으로 오독되지 않게(F6)', () => {
    const m = kpiMap({ ...SMR, market: { forecast: SMR.market.forecast, as_of: '2026-08-04' } })
    expect(m['시장 규모']).toBe('$15.2B (2035)')
  })

  it('단측인데 연도조차 없으면 금액만 — 연도를 만들어내지 않는다(wrong < missing)', () => {
    const m = kpiMap({ ...SMR, market: { history: [{ size: { value: 5.8, currency: 'USD', unit: 'bn' } }] } })
    expect(m['시장 규모']).toBe('$5.8B')
  })

  it('양측이면 종전대로 연도 없이 화살표 표기(단측 수정이 양측을 바꾸지 않는다)', () => {
    expect(kpiMap(SMR)['시장 규모']).toBe('$5.8B → $15.2B')
  })

  // F13 — ui/Stat은 값에 monospace + tabular-nums를 강제하는 수치 프리미티브다. 회사명 칩만
  // 소비처에서 일반 폰트로 덮을 수 있게 파생값이 성격을 표시한다(Stat 자체는 건드리지 않는다).
  it('선두 업체 칩만 text: true(값이 수치가 아니라 회사명)', () => {
    expect(deriveTechKpis(SMR).filter(c => c.text).map(c => c.label)).toEqual(['선두 업체'])
    // 결측(—)이어도 성격은 그대로다 — 데이터에 따라 폰트가 흔들리면 안 된다
    expect(deriveTechKpis({ players: [], market: {} }).filter(c => c.text).map(c => c.label)).toEqual(['선두 업체'])
  })

  it('reusable-rocket 실응답 형태: 선두 1곳 · cagr 실값 · players 8', () => {
    const m = kpiMap(RR)
    expect(m['기술난이도']).toBe('4/5')
    // 선두가 1곳이면 "+N"이 붙지 않는다. leader_name("SpaceX (Grasshopper 호핑 2013년)")은 판정
    // 근거도 표시값도 아니다 — 칩은 players[].name을 쓴다(이 둘을 섞으면 값이 통째로 달라진다).
    expect(m['선두 업체']).toBe('SpaceX')
    expect(m['시장 규모']).toBe('$8.4B → $32.1B')
    expect(m['CAGR']).toBe('12.97%')
    expect(m['주요 업체']).toBe('8곳')
    expect(m['양산상용']).toBe('1곳')
    expect(deriveTechKpis(RR).filter(c => c.value === '—')).toEqual([])
  })

  it('양산상용이 0곳이면 —가 아니라 "0곳"(결측이 아니라 실측값)', () => {
    const m = kpiMap({ ...SMR, players: [{ name: 'A', tech_level: 3, gap_years: 1 }] })
    expect(m['양산상용']).toBe('0곳')
  })
})

describe('sortPlayers — 기술수준 ↓ → 격차 ↑ → gap_years null 최후(비파괴)', () => {
  const isNull = (v) => v == null

  it('불변식: tech_level 비증가 · 동단계 구간에서 gap_years 비감소 · null이 구간 마지막', () => {
    const sorted = sortPlayers(SMR.players)
    expect(sorted).toHaveLength(SMR.players.length)
    for (let i = 1; i < sorted.length; i++) {
      expect(sorted[i].tech_level).toBeLessThanOrEqual(sorted[i - 1].tech_level)
    }
    // tech_level 구간별로 쪼개 격차 불변식을 본다
    const groups = {}
    sorted.forEach((p, i) => { (groups[p.tech_level] ||= []).push({ ...p, _i: i }) })
    Object.values(groups).forEach((g) => {
      // 같은 단계는 연속 구간이어야 한다(정렬이 단계를 섞지 않았음)
      expect(g[g.length - 1]._i - g[0]._i).toBe(g.length - 1)
      const firstNull = g.findIndex(p => isNull(p.gap_years))
      const nulls = g.filter(p => isNull(p.gap_years))
      if (nulls.length > 0) expect(g.slice(firstNull).every(p => isNull(p.gap_years))).toBe(true)
      const nums = g.filter(p => !isNull(p.gap_years)).map(p => p.gap_years)
      for (let i = 1; i < nums.length; i++) expect(nums[i]).toBeGreaterThanOrEqual(nums[i - 1])
    })
  })

  it('원본 배열을 변형하지 않는다(비파괴)', () => {
    const input = SMR.players
    const before = input.map(p => p.name)
    const sorted = sortPlayers(input)
    expect(input.map(p => p.name)).toEqual(before)
    expect(sorted).not.toBe(input)
  })

  it('gap_years null인 업체가 같은 단계 상단을 차지하지 않는다(두산에너빌리티 케이스)', () => {
    const lv4 = sortPlayers(SMR.players).filter(p => p.tech_level === 4)
    expect(lv4[lv4.length - 1].name).toBe('두산에너빌리티')
  })

  it('빈 배열·비배열 입력은 빈 배열', () => {
    expect(sortPlayers([])).toEqual([])
    expect(sortPlayers(null)).toEqual([])
    expect(sortPlayers(undefined)).toEqual([])
  })
})

describe('parseDescriptionSections — 대괄호 헤딩 분해(파싱 실패는 정상 입력, 정보 손실 0)', () => {
  it('대괄호 4개 → 4섹션, 각 body가 원문과 일치', () => {
    const text = [
      '[기술 개요]', 'SMR은 소형모듈원자로다.', '',
      '[어디까지 왔나]', '중국 링룽1호가 세계 최초로 병입됐다.',
      '[시장 규모]', '2024년 58억 달러.',
      '[투자 관점]', '2026~28년 현금은 주기기 공급망에서 나온다.',
    ].join('\n')
    const secs = parseDescriptionSections(text)
    expect(secs.map(s => s.title)).toEqual(['기술 개요', '어디까지 왔나', '시장 규모', '투자 관점'])
    expect(secs[0].body).toBe('SMR은 소형모듈원자로다.')
    expect(secs[1].body).toBe('중국 링룽1호가 세계 최초로 병입됐다.')
    expect(secs[2].body).toBe('2024년 58억 달러.')
    expect(secs[3].body).toBe('2026~28년 현금은 주기기 공급망에서 나온다.')
  })

  it('대괄호 없는 통짜 입력 → 1섹션이며 body === 입력 전문(손실 0)', () => {
    const text = '첫 문단입니다.\n\n둘째 문단입니다.\n셋째 줄.'
    const secs = parseDescriptionSections(text)
    expect(secs).toHaveLength(1)
    expect(secs[0].title).toBeNull()
    expect(secs[0].body).toBe(text)
  })

  it('빈 문자열 / null / undefined → 0섹션(렌더러가 섹션째 생략)', () => {
    expect(parseDescriptionSections('')).toEqual([])
    expect(parseDescriptionSections('   \n  ')).toEqual([])
    expect(parseDescriptionSections(null)).toEqual([])
    expect(parseDescriptionSections(undefined)).toEqual([])
  })

  it('중간부터 대괄호가 나오면 앞부분이 이름 없는 선행 섹션으로 보존된다', () => {
    const text = '머리말 문단.\n두 번째 줄.\n[기술 개요]\n본문.'
    const secs = parseDescriptionSections(text)
    expect(secs).toHaveLength(2)
    expect(secs[0].title).toBeNull()
    expect(secs[0].body).toBe('머리말 문단.\n두 번째 줄.')
    expect(secs[1]).toEqual({ title: '기술 개요', body: '본문.' })
  })

  it('전문이 손실 없이 보존된다(모든 body를 이으면 헤딩 제외 원문 전체)', () => {
    const text = '머리말.\n[A]\n가나다.\n[B]\n라마바.'
    const joined = parseDescriptionSections(text).map(s => s.body).join('\n')
    expect(joined).toBe('머리말.\n가나다.\n라마바.')
  })

  it('본문이 빈 헤딩도 섹션으로 남긴다(제목이 목차로 읽혀야 하므로)', () => {
    const secs = parseDescriptionSections('[A]\n[B]\n내용.')
    expect(secs).toEqual([{ title: 'A', body: '' }, { title: 'B', body: '내용.' }])
  })

  it('줄 중간의 대괄호는 헤딩이 아니다(각주·인용 표기가 산문을 쪼개지 않는다)', () => {
    const text = '설계 인증[1]을 받았다.\n다음 줄 [비고] 있음.'
    const secs = parseDescriptionSections(text)
    expect(secs).toHaveLength(1)
    expect(secs[0].body).toBe(text)
  })
})

describe('TECH_NAMES / TECH_LEVEL_LABELS — 표시명·척도 라벨 상수', () => {
  it('백엔드 TECH_TOPICS 4종과 슬러그가 일치', () => {
    expect(Object.keys(TECH_NAMES).sort()).toEqual(['reusable-rocket', 'robotics', 'smr', 'solid-state-battery'])
  })
  it('기술 성숙 단계 1~5 라벨(CONTEXT.md 공통 5단계)', () => {
    expect(TECH_LEVEL_LABELS[1]).toBe('기초연구')
    expect(TECH_LEVEL_LABELS[3]).toBe('실증')
    expect(TECH_LEVEL_LABELS[5]).toBe('양산상용')
  })
})

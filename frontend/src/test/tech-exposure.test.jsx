/**
 * 기술 노출 상한 카드 + 종목 상세 기술 칩 (ADR-0043, task#307 S3·S4).
 *
 * 계산은 순수 함수 `computeTechExposure`로 분리돼 있어 렌더 없이 직접 단언한다.
 * 렌더 축은 「기준 문구 2문장이 DOM에 실재하는가」·「실패와 0건이 구별되는가」처럼
 * 문자열/분기가 화면에 도달하는지를 본다.
 *
 * ⚠️ 이 지표의 정의상 **기술 간 합은 100%를 넘는다**(한 종목이 여러 기술에 계상된다).
 * 그래서 "합이 100이다"를 단언하는 축을 두면 안 된다 — 그것이 오히려 회귀다.
 *
 * ⚠️ `vi.resetModules()` + 동적 import를 쓰지 않는다 — 그러면 훅 모듈의 **두 번째 인스턴스**가
 * 생겨 이 파일이 top-level import한 `_resetTechIndexCache`가 그 인스턴스의 캐시에 닿지 못한다
 * (모듈 레벨 캐시를 쓰는 훅을 테스트할 때의 함정). 대신 `vi.mock`으로 api를 한 번만 갈아끼운다.
 */
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// jsdom엔 matchMedia가 없다(useIsMobile) — 기존 테스트와 동일한 스텁.
window.matchMedia = window.matchMedia || (() => ({ matches: false, addEventListener() {}, removeEventListener() {} }))

vi.mock('../api', () => ({ default: { get: vi.fn(), post: vi.fn() } }))

// StockModal(후보 칩의 목적지)이 `useAuth()`를 쓴다 — AuthProvider 밖이면 그 훅이 throw해
// 트리가 통째로 언마운트된다. 실앱의 ExposureTab은 항상 AuthProvider 안이므로 이것은
// 하니스 공백이고, 컴포넌트를 약화시키지 않고 컨텍스트만 좁게 모킹한다.
vi.mock('../contexts/AuthContext', () => ({
  useAuth: () => ({ role: 'user' }),
  AuthProvider: ({ children }) => children,
}))

import api from '../api'
import ExposureTab, { computeTechExposure, computeTechCandidates } from '../pages/ExposureTab'
import ReportDetailHeader from '../components/reports/ReportDetailHeader'
import { techsForTicker, _resetTechIndexCache } from '../hooks/useTechIndex'
import { ToastProvider } from '../components/Toast'

// 후보 칩(task#323)이 관심 추가에 `useToast`를 쓰므로 렌더 축은 Provider가 필요하다.
// 컴포넌트를 약화시키지 않고 하니스를 맞춘다(masthead.test.jsx와 같은 패턴).
const renderExposure = () => render(
  <ToastProvider><MemoryRouter><ExposureTab /></MemoryRouter></ToastProvider>
)

// 한 종목(005930)이 **두 기술**에 등장하는 픽스처 — Σ>100%를 만드는 유일한 구조다.
const INDEX = [
  { slug: 'ai-datacenter-equipment', name: 'AI 데이터센터 설비', tickers: ['000660', '005930'], players_total: 25 },
  { slug: 'robotics', name: '로봇', tickers: ['005930', 'TSLA'], players_total: 13 },
  { slug: 'smr', name: 'SMR', tickers: [], players_total: 11 },
]
const HOLDINGS = [
  { ticker: '005930', name: '삼성전자', weight: 60 },
  { ticker: '000660', name: 'SK하이닉스', weight: 25 },
  { ticker: 'AAPL', name: 'Apple', weight: 15 },   // 어느 기술에도 없음
]

describe('computeTechExposure — 상한 계산', () => {
  it('ⓐ 한 종목이 2개 기술에 등장하면 양쪽 모두에 계상되고 기술 간 합이 100%를 넘는다', () => {
    const rows = computeTechExposure(INDEX, HOLDINGS, [])
    const by = Object.fromEntries(rows.map(r => [r.slug, r]))
    expect(by['ai-datacenter-equipment'].weight).toBe(85)  // 60 + 25
    expect(by['robotics'].weight).toBe(60)                 // 60 (005930이 또 계상됨)
    const total = rows.reduce((s, r) => s + r.weight, 0)
    expect(total).toBe(145)
    expect(total).toBeGreaterThan(100)  // ← 이 지표의 정의. 100으로 정규화하면 거짓이 된다.
  })

  it('ⓑ 관심종목(보유 아님)은 막대 값에 0으로도 섞이지 않는다', () => {
    const rows = computeTechExposure(INDEX, HOLDINGS, ['TSLA'])
    const robotics = rows.find(r => r.slug === 'robotics')
    expect(robotics.weight).toBe(60)
    expect(robotics.holdingCount).toBe(1)
    expect(robotics.watchCount).toBe(1)   // 개수로만 알린다
    // 보유이면서 관심이기도 한 티커를 관심으로 이중계상하지 않는다
    const rows2 = computeTechExposure(INDEX, HOLDINGS, ['005930'])
    expect(rows2.find(r => r.slug === 'robotics').watchCount).toBe(0)
  })

  it('ⓓ 노출 0인 기술이 분리된다(막대가 아니라 "노출 없음"으로 집계)', () => {
    const rows = computeTechExposure(INDEX, HOLDINGS, [])
    expect(rows.filter(r => r.weight <= 0).map(r => r.slug)).toEqual(['smr'])
  })

  it('ⓔ 미매칭 수 == players_total - tickers.length', () => {
    const rows = computeTechExposure(INDEX, HOLDINGS, [])
    const by = Object.fromEntries(rows.map(r => [r.slug, r]))
    expect(by['ai-datacenter-equipment'].unmatched).toBe(25 - 2)
    expect(by['robotics'].unmatched).toBe(13 - 2)
  })

  it('노출 내림차순 정렬 — 큰 노출이 먼저 온다', () => {
    const rows = computeTechExposure(INDEX, HOLDINGS, [])
    const weights = rows.map(r => r.weight)
    expect(weights).toEqual([...weights].sort((a, b) => b - a))
  })

  it('ⓕ 매칭 0(빈 상태) — 보유가 어느 기술에도 없으면 전부 노출 0이다', () => {
    const rows = computeTechExposure(INDEX, [{ ticker: 'NFLX', weight: 100 }], [])
    expect(rows.every(r => r.weight === 0)).toBe(true)
  })

  it('입력이 비어도 죽지 않는다', () => {
    expect(computeTechExposure([], HOLDINGS, [])).toEqual([])
    expect(computeTechExposure(INDEX, [], [])).toHaveLength(3)
  })
})

describe('techsForTicker — 종목 상세 칩 소스', () => {
  it('ⓐ 2개 기술에 등장하는 티커는 기술 2개를 돌려준다', () => {
    expect(techsForTicker(INDEX, '005930').map(t => t.slug))
      .toEqual(['ai-datacenter-equipment', 'robotics'])
  })

  it('ⓑ 등장 0이면 빈 배열 — 칩 영역 자체가 없어야 한다', () => {
    expect(techsForTicker(INDEX, 'NFLX')).toEqual([])
    expect(techsForTicker(INDEX, undefined)).toEqual([])
  })

  it('부분일치로 매칭하지 않는다(정확일치만 — ADR-0043 결정 3)', () => {
    expect(techsForTicker(INDEX, '00593')).toEqual([])
    expect(techsForTicker(INDEX, '005930.KS')).toEqual([])
  })
})

// ── 렌더 축 ──────────────────────────────────────────────────────────────────
const EXPOSURE = {
  currency: { KR: { weight: 85 } },
  sector: { 반도체: { weight: 85 } },
  holdings: HOLDINGS,
  concentration: { top3_pct: 100, top5_pct: 100, max_single: { ticker: '005930', weight: 60 } },
  warnings: {}, no_fx: { count: 0, tickers: [] },
  portfolio_beta: 1.1, beta_coverage_pct: 90, beta_missing: [],
}

/** api.get을 URL별로 라우팅한다 — indexFn만 케이스마다 갈아끼운다. */
function wireApi({ indexFn, watchlist = [{ ticker: 'TSLA' }], exposure = EXPOSURE }) {
  api.get.mockImplementation((url) => {
    if (url.includes('/api/tech-reports/index')) return indexFn()
    if (url.includes('/api/watchlist')) return Promise.resolve({ data: watchlist })
    return Promise.resolve({ data: exposure })
  })
}

const okIndex = () => Promise.resolve({ data: { index: INDEX } })

beforeEach(() => { _resetTechIndexCache(); api.get.mockReset() })
afterEach(() => { vi.restoreAllMocks(); _resetTechIndexCache() })

describe('ReportDetailHeader 기술 칩 (렌더)', () => {
  const renderHeader = (ticker) => render(
    <MemoryRouter>
      <ReportDetailHeader
        detail={{ summary: { name: '테스트', market: 'KR', price: 1000 } }}
        selected={{ ticker, date: '2026-08-19' }}
        setSelected={() => {}} setView={() => {}} isAdmin={false}
        generating={null} genProgress={{}} generateOne={() => {}}
        guruMap={{}} reportList={{}}
      />
    </MemoryRouter>
  )

  it('ⓐ 2개 기술에 등장하는 티커에 칩 2개 + 각 링크가 /tech-report/<slug>', async () => {
    wireApi({ indexFn: okIndex })
    renderHeader('005930')
    await waitFor(() => expect(screen.getAllByTestId('header-tech-chip')).toHaveLength(2))
    const chips = screen.getAllByTestId('header-tech-chip')
    expect(chips.map(c => c.getAttribute('href'))).toEqual([
      '/tech-report/ai-datacenter-equipment',
      '/tech-report/robotics',
    ])
    expect(chips[0].textContent).toContain('AI 데이터센터 설비')
  })

  it('ⓑ 등장 0이면 칩이 하나도 없다 — 그래도 헤더 본문은 렌더된다', async () => {
    wireApi({ indexFn: okIndex })
    renderHeader('NFLX')
    await waitFor(() => expect(screen.getByText('← 목록으로')).toBeTruthy())
    expect(screen.queryAllByTestId('header-tech-chip')).toHaveLength(0)
  })

  it('ⓒ 인덱스 조회가 실패해도 본문 렌더를 막지 않는다(칩만 생략 + console.warn)', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    wireApi({ indexFn: () => Promise.reject(new Error('boom')) })
    renderHeader('005930')
    await waitFor(() => expect(screen.getByText('← 목록으로')).toBeTruthy())
    await waitFor(() => expect(warn).toHaveBeenCalled())
    expect(screen.queryAllByTestId('header-tech-chip')).toHaveLength(0)
    expect(warn.mock.calls[0][0]).toContain('[useTechIndex]')
  })
})

describe('ExposureTab 기술 노출 카드 (렌더)', () => {
  it('ⓒ 기준 문구 2문장이 DOM에 실재한다 — 빠지면 지표가 거짓이 된다', async () => {
    wireApi({ indexFn: okIndex })
    renderExposure()
    const basis = await screen.findByTestId('tech-exposure-basis')
    expect(basis.textContent).toContain('상한')
    expect(basis.textContent).toContain('100%를 넘을 수 있습니다')
  })

  it('막대는 노출>0인 기술만 그리고 부기 2종이 실재한다', async () => {
    wireApi({ indexFn: okIndex })
    renderExposure()
    const card = await screen.findByTestId('tech-exposure-card')
    expect(card.textContent).toContain('AI 데이터센터 설비')
    expect(card.textContent).toContain('로봇')
    // smr은 노출 0이라 막대가 아니라 "나머지 N개" 줄로 간다
    expect(screen.getByTestId('tech-exposure-zero').textContent).toContain('나머지 1개')
    expect(screen.getByTestId('tech-exposure-watch').textContent).toContain('관심 1종목')
    // 미매칭은 **노출>0인 기술만** 합산: (25-2) + (13-2) = 34
    expect(screen.getByTestId('tech-exposure-unmatched').textContent).toContain('34개')
  })

  it('ⓕ 매칭 0이면 안내 문구만 — 막대 없이 빈 상태를 그린다', async () => {
    wireApi({
      indexFn: okIndex,
      watchlist: [],
      exposure: { ...EXPOSURE, holdings: [{ ticker: 'NFLX', name: 'Netflix', weight: 100 }] },
    })
    renderExposure()
    const empty = await screen.findByTestId('tech-exposure-empty')
    expect(empty.textContent).toContain('겹치는 기술이 없습니다')
  })

  it('⚠️ 인덱스 조회 실패면 카드를 아예 그리지 않는다 — "노출 없음"이라는 거짓 진술 금지', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    wireApi({ indexFn: () => Promise.reject(new Error('boom')) })
    renderExposure()
    await waitFor(() => expect(screen.getByText('통화 노출')).toBeTruthy())  // 본문은 정상
    expect(screen.queryByTestId('tech-exposure-card')).toBeNull()
    expect(screen.queryByTestId('tech-exposure-empty')).toBeNull()   // 빈 상태로도 붕괴하지 않는다
  })
})


// ── task#323 — 「내가 안 가진 업체」 후보 (computeTechCandidates) ──────────────────
// 노출>0 기술만 후보를 낸다. LISTED 픽스처는 `listed[]`를 실은 **새** 응답이고,
// 위 INDEX는 `listed`가 없는 **옛** 응답이라 배포 창 케이스를 그대로 겸한다.
const LISTED = [
  {
    slug: 'ai-datacenter-equipment', name: 'AI 데이터센터 설비',
    tickers: ['000660', '005930', '010120', 'AMD', 'ARM', 'INTC'], players_total: 25,
    listed: [
      { ticker: '000660', name: 'SK하이닉스', tech_level: 5, gap_years: 0, category: 'HBM' },
      { ticker: '005930', name: '삼성전자', tech_level: 5, gap_years: 0, category: 'HBM' },
      // 후보 4명 — tech_level 내림차순, 동급이면 gap_years 오름차순, 결측은 맨 뒤
      { ticker: 'AMD', name: 'AMD', tech_level: 4, gap_years: 2, category: 'GPU' },
      { ticker: 'ARM', name: 'Arm', tech_level: 4, gap_years: 1, category: 'IP' },
      { ticker: 'INTC', name: 'Intel', tech_level: 4, gap_years: null, category: 'IDM' },
      { ticker: '010120', name: 'LS일렉트릭', tech_level: 5, gap_years: 3, category: null },
    ],
  },
  // 노출 0(보유 티커 없음)인데 listed는 가득 — 후보를 내면 안 된다.
  { slug: 'smr', name: 'SMR', tickers: ['034020'], players_total: 11,
    listed: [{ ticker: '034020', name: '두산에너빌리티', tech_level: 4, gap_years: 2, category: 'SMR' }] },
]

describe('computeTechCandidates — 후보 산출', () => {
  it('보유와 관심을 **둘 다** 제외한다', () => {
    // ARM을 관심에 넣으면 후보에서 빠져야 한다(보유 제외만으로는 통과하지 못한다).
    const withWatch = computeTechCandidates(LISTED, HOLDINGS, ['ARM'])
    const tickers = withWatch.get('ai-datacenter-equipment').chips.map(c => c.ticker)
    expect(tickers).not.toContain('ARM')       // 관심 → 제외
    expect(tickers).not.toContain('000660')    // 보유 → 제외
    expect(tickers).not.toContain('005930')    // 보유 → 제외
  })

  it('tech_level↓ → gap_years↑ → name↑ 로 정렬하고 gap_years 결측은 맨 뒤다', () => {
    const m = computeTechCandidates(LISTED, HOLDINGS, [])
    const e = m.get('ai-datacenter-equipment')
    // 010120(Lv5) 먼저 → 그다음 Lv4 중 gap 1(ARM) → gap 2(AMD) → 결측(INTC)
    expect([...e.chips.map(c => c.ticker), ...(e.more ? ['+' + e.more] : [])])
      .toEqual(['010120', 'ARM', 'AMD', '+1'])
  })

  it('4명 이상이면 3칩 + 나머지 수를 돌려준다', () => {
    const e = computeTechCandidates(LISTED, HOLDINGS, []).get('ai-datacenter-equipment')
    expect(e.chips).toHaveLength(3)
    expect(e.more).toBe(1)
  })

  it('노출 0인 기술은 후보를 내지 않는다', () => {
    const m = computeTechCandidates(LISTED, HOLDINGS, [])
    // smr은 listed가 가득하지만 보유 교집합이 없어 노출 0 → 키 자체가 없다.
    expect(m.has('smr')).toBe(false)
  })

  it('`listed`가 없는 옛 응답(배포 창)에도 죽지 않고 후보 0을 돌려준다', () => {
    // INDEX는 listed가 없는 옛 형태. 노출>0 기술이 있어도 후보는 비어야 한다.
    const m = computeTechCandidates(INDEX, HOLDINGS, [])
    expect(computeTechExposure(INDEX, HOLDINGS, []).some(r => r.weight > 0)).toBe(true) // 대조군
    expect(m.size).toBe(0)
  })

  it('name tiebreaker — tech_level·gap_years가 **동일**할 때 이름 오름차순으로 갈린다', () => {
    // ⚠️ 이 픽스처가 없으면 name 키는 **한 번도 실행되지 않는다**(위 축들은 tech_level·gap_years로
    //    이미 갈리므로 name을 0으로 무력화해도 전부 통과한다 — 실제로 그것을 fault injection으로
    //    확인했다). 결정적 tiebreaker는 「선언」이 아니라 이 케이스가 증거다.
    const tied = [{
      slug: 'ai-datacenter-equipment', name: 'AI 데이터센터 설비',
      tickers: ['000660', 'ZZZ', 'AAA', 'MMM'], players_total: 4,
      listed: [
        { ticker: '000660', name: 'SK하이닉스', tech_level: 5, gap_years: 0 },
        // 셋 다 Lv4·gap 2로 **완전 동급** — 이름만이 순서를 정한다.
        { ticker: 'ZZZ', name: 'Zeta Semi', tech_level: 4, gap_years: 2 },
        { ticker: 'AAA', name: 'Alpha Semi', tech_level: 4, gap_years: 2 },
        { ticker: 'MMM', name: 'Mid Semi', tech_level: 4, gap_years: 2 },
      ],
    }]
    const chips = computeTechCandidates(tied, HOLDINGS, []).get('ai-datacenter-equipment').chips
    expect(chips.map(c => c.name)).toEqual(['Alpha Semi', 'Mid Semi', 'Zeta Semi'])
  })

  it('gap_years가 **둘 다 결측**이면 name 순서로 갈린다', () => {
    // ⚠️ 이 축은 sentinel 선택(MAX_SAFE_INTEGER vs Infinity)을 **구별하지 못한다** —
    //    Infinity로 바꿔 주입해도 0 fail이다(NaN이 falsy라 `||`가 name으로 폴스루한다).
    //    그래서 이것은 「NaN 회피」의 증거가 아니라 **「둘 다 결측이면 이름 순」이라는
    //    사용자 가시 동작**의 핀이다. 그 구별을 주석에 남기지 않으면 다음 사람이
    //    이 테스트를 sentinel의 알리바이로 잘못 읽는다(task#305 계열).
    const both = [{
      slug: 'ai-datacenter-equipment', name: 'AI 데이터센터 설비',
      tickers: ['000660', 'BBB', 'AAA'], players_total: 3,
      listed: [
        { ticker: '000660', name: 'SK하이닉스', tech_level: 5, gap_years: 0 },
        { ticker: 'BBB', name: 'Bravo', tech_level: 4, gap_years: null },
        { ticker: 'AAA', name: 'Alpha', tech_level: 4, gap_years: null },
      ],
    }]
    const chips = computeTechCandidates(both, HOLDINGS, []).get('ai-datacenter-equipment').chips
    expect(chips.map(c => c.name)).toEqual(['Alpha', 'Bravo'])
  })

  it('시장은 티커 형태로 추론한다 — 6자리는 KR, 그 외는 US', () => {
    const chips = computeTechCandidates(LISTED, HOLDINGS, []).get('ai-datacenter-equipment').chips
    const byTicker = Object.fromEntries(chips.map(c => [c.ticker, c.market]))
    expect(byTicker['010120']).toBe('KR')
    expect(byTicker['ARM']).toBe('US')
  })

  it('category 결측이면 null로 내려온다 — 칩 메타줄이 Lv만 쓰게 한다', () => {
    const chips = computeTechCandidates(LISTED, HOLDINGS, []).get('ai-datacenter-equipment').chips
    expect(chips.find(c => c.ticker === '010120').category).toBeNull()
    expect(chips.find(c => c.ticker === 'ARM').category).toBe('IP')
  })
})

describe('ExposureTab 후보 칩 (렌더 · task#323)', () => {
  // `listed`를 실은 인덱스 — 위 INDEX(옛 형태)와 나란히 둬서 배포 창 대조군이 된다.
  const LISTED_INDEX = [
    {
      slug: 'ai-datacenter-equipment', name: 'AI 데이터센터 설비',
      tickers: ['000660', '005930', '010120', 'AMD', 'ARM', 'INTC'], players_total: 25,
      listed: [
        { ticker: '000660', name: 'SK하이닉스', tech_level: 5, gap_years: 0, category: 'HBM' },
        { ticker: '005930', name: '삼성전자', tech_level: 5, gap_years: 0, category: 'HBM' },
        { ticker: '010120', name: 'LS일렉트릭', tech_level: 5, gap_years: 3, category: null },
        { ticker: 'ARM', name: 'Arm', tech_level: 4, gap_years: 1, category: 'IP' },
        { ticker: 'AMD', name: 'AMD', tech_level: 4, gap_years: 2, category: 'GPU' },
        { ticker: 'INTC', name: 'Intel', tech_level: 4, gap_years: null, category: 'IDM' },
      ],
    },
    // ⚠️ **두 번째 노출 기술이 필수다** — 노출 기술이 하나뿐이면 「칩이 자기 기술에
    //    귀속된다」가 「모든 막대가 같은 칩을 보인다」와 구별되지 않는다(fault injection으로
    //    확인: 전 막대에 첫 entry를 꽂아도 0 fail이었다). AAPL이 보유라 이 기술도 노출>0.
    {
      slug: 'robotics', name: '로봇', tickers: ['AAPL', 'TSLA', 'ABB'], players_total: 13,
      listed: [
        { ticker: 'AAPL', name: 'Apple', tech_level: 3, gap_years: 4, category: '액추에이터' },
        { ticker: 'TSLA', name: 'Tesla', tech_level: 5, gap_years: 0, category: '휴머노이드' },
        { ticker: 'ABB', name: 'ABB', tech_level: 4, gap_years: 2, category: '산업로봇' },
      ],
    },
    // 노출 0(보유 교집합 없음)인데 listed는 가득 — 칩 구역이 생기면 안 된다.
    { slug: 'smr', name: 'SMR', tickers: ['034020'], players_total: 11,
      listed: [{ ticker: '034020', name: '두산에너빌리티', tech_level: 4, gap_years: 2, category: 'SMR' }] },
  ]
  const listedIndex = () => Promise.resolve({ data: { index: LISTED_INDEX } })

  it('ⓐ 노출>0 기술에 칩 3개 + 「+N」이 렌더된다', async () => {
    wireApi({ indexFn: listedIndex, watchlist: [] })
    renderExposure()
    await screen.findByTestId('tech-exposure-card')
    // 설비(노출 57%+)가 먼저, 로봇이 다음 — 카드가 노출% 내림차순이라 순서가 그렇다.
    const row = screen.getAllByTestId('tech-cand-row')
      .find(r => r.getAttribute('data-slug') === 'ai-datacenter-equipment')
    const chips = [...row.querySelectorAll('[data-testid="tech-cand-chip"]')]
    expect(chips).toHaveLength(3)
    // 정렬이 화면까지 도달했는지 — Lv5(010120) → Lv4 gap1(ARM) → Lv4 gap2(AMD)
    expect(chips.map(c => c.getAttribute('data-ticker'))).toEqual(['010120', 'ARM', 'AMD'])
    expect(row.querySelector('[data-testid="tech-cand-more"]').textContent).toBe('+1')
    // 메타줄에 **섹터**가 실재해야 한다 — 빠지면 tech_level 비교가 조용히 거짓이 된다.
    expect(chips[1].textContent).toContain('IP')
    expect(chips[1].textContent).toContain('Lv4')
    // category 결측이면 Lv만 — 빈 `—` 구멍을 만들지 않는다.
    expect(chips[0].textContent).toContain('Lv5')
    expect(chips[0].textContent).not.toContain('—')
  })

  it('ⓑ 노출 0인 기술엔 칩 구역이 없다', async () => {
    wireApi({ indexFn: listedIndex, watchlist: [] })
    renderExposure()
    await screen.findByTestId('tech-exposure-card')
    const rows = screen.getAllByTestId('tech-cand-row')
    // 노출>0 기술 2개만 칩 구역을 갖는다 — smr(노출 0)은 listed가 가득해도 없다.
    expect(rows.map(r => r.getAttribute('data-slug'))).toEqual(['ai-datacenter-equipment', 'robotics'])
    // ⚠️ 그리고 칩이 **자기 기술에 귀속**돼야 한다(막대마다 같은 집합이면 안 된다).
    const byRow = Object.fromEntries(rows.map(r => [
      r.getAttribute('data-slug'),
      [...r.querySelectorAll('[data-testid="tech-cand-chip"]')].map(c => c.getAttribute('data-ticker')),
    ]))
    expect(byRow['ai-datacenter-equipment']).toEqual(['010120', 'ARM', 'AMD'])
    expect(byRow['robotics']).toEqual(['TSLA', 'ABB'])
  })

  it('ⓒ 조회 실패면 후보 구역이 없다 — 카드 자체가 안 그려지므로(task#307 결정 유지)', async () => {
    // ⚠️ 계획서 S3ⓒ는 「카드 본문은 남는다」로 적었지만 그 전제는 **거짓**이다:
    //    `useTechIndex` docstring이 「소비처는 failed면 카드를 아예 그리지 않아야 한다」를
    //    기록된 결정으로 못박고 있고 기존 축이 그것을 단언한다. 그래서 축을 완화하거나
    //    뒤집지 않고 **등가로 좁혔다** — 「실패면 후보 칩이 0이며 그 이유는 카드 부재」.
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    wireApi({ indexFn: () => Promise.reject(new Error('boom')), watchlist: [] })
    renderExposure()
    await waitFor(() => expect(screen.getByText('통화 노출')).toBeTruthy())
    expect(screen.queryByTestId('tech-exposure-card')).toBeNull()
    expect(screen.queryAllByTestId('tech-cand-chip')).toHaveLength(0)
    expect(screen.queryAllByTestId('tech-cand-row')).toHaveLength(0)
    // 「후보 없음」류 거짓 진술로도 붕괴하지 않는다.
    expect(screen.queryByTestId('tech-cand-label')).toBeNull()
  })

  it('ⓓ 칩 클릭이 StockModal을 프리필로 열고 KR 6자리는 market=KR이다', async () => {
    wireApi({ indexFn: listedIndex, watchlist: [] })
    renderExposure()
    await screen.findByTestId('tech-exposure-card')
    const row = screen.getAllByTestId('tech-cand-row')
      .find(r => r.getAttribute('data-slug') === 'ai-datacenter-equipment')
    const chips = [...row.querySelectorAll('[data-testid="tech-cand-chip"]')]
    const kr = chips[0]
    expect(kr.getAttribute('data-market')).toBe('KR')        // 010120 → 6자리
    expect(chips[1].getAttribute('data-market')).toBe('US')  // ARM

    kr.click()
    // 관심종목 추가 모달이 열리고 티커·이름이 프리필된다.
    await waitFor(() => expect(screen.getByText('관심종목 추가')).toBeTruthy())
    expect(screen.getByDisplayValue('010120')).toBeTruthy()
    expect(screen.getByDisplayValue('LS일렉트릭')).toBeTruthy()
  })

  it('ⓔ 칩에 가격 방향 토큰(--up/--down)을 쓰지 않는다 — KR 색 관례', async () => {
    wireApi({ indexFn: listedIndex, watchlist: [] })
    renderExposure()
    await screen.findByTestId('tech-exposure-card')
    for (const c of screen.getAllByTestId('tech-cand-chip')) {
      const html = c.outerHTML
      expect(html).not.toContain('--up')
      expect(html).not.toContain('--down')
    }
  })

  it('ⓕ 관심에 담긴 업체는 후보에서 사라진다 — 저장 후 관심목록을 재조회한다', async () => {
    // ARM이 관심에 있으면 칩에서 빠지고 그 자리에 INTC가 올라온다(+N도 1 줄어든다).
    wireApi({ indexFn: listedIndex, watchlist: [{ ticker: 'ARM' }] })
    renderExposure()
    await screen.findByTestId('tech-exposure-card')
    const row = screen.getAllByTestId('tech-cand-row')
      .find(r => r.getAttribute('data-slug') === 'ai-datacenter-equipment')
    const tickers = [...row.querySelectorAll('[data-testid="tech-cand-chip"]')]
      .map(c => c.getAttribute('data-ticker'))
    expect(tickers).toEqual(['010120', 'AMD', 'INTC'])
    expect(row.querySelector('[data-testid="tech-cand-more"]')).toBeNull()   // 후보 3명 → +N 없음
  })
})

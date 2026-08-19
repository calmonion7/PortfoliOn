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

vi.mock('../api', () => ({ default: { get: vi.fn() } }))

import api from '../api'
import ExposureTab, { computeTechExposure } from '../pages/ExposureTab'
import ReportDetailHeader from '../components/reports/ReportDetailHeader'
import { techsForTicker, _resetTechIndexCache } from '../hooks/useTechIndex'

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
    render(<MemoryRouter><ExposureTab /></MemoryRouter>)
    const basis = await screen.findByTestId('tech-exposure-basis')
    expect(basis.textContent).toContain('상한')
    expect(basis.textContent).toContain('100%를 넘을 수 있습니다')
  })

  it('막대는 노출>0인 기술만 그리고 부기 2종이 실재한다', async () => {
    wireApi({ indexFn: okIndex })
    render(<MemoryRouter><ExposureTab /></MemoryRouter>)
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
    render(<MemoryRouter><ExposureTab /></MemoryRouter>)
    const empty = await screen.findByTestId('tech-exposure-empty')
    expect(empty.textContent).toContain('겹치는 기술이 없습니다')
  })

  it('⚠️ 인덱스 조회 실패면 카드를 아예 그리지 않는다 — "노출 없음"이라는 거짓 진술 금지', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    wireApi({ indexFn: () => Promise.reject(new Error('boom')) })
    render(<MemoryRouter><ExposureTab /></MemoryRouter>)
    await waitFor(() => expect(screen.getByText('통화 노출')).toBeTruthy())  // 본문은 정상
    expect(screen.queryByTestId('tech-exposure-card')).toBeNull()
    expect(screen.queryByTestId('tech-exposure-empty')).toBeNull()   // 빈 상태로도 붕괴하지 않는다
  })
})

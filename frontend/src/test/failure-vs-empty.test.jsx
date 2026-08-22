/**
 * B76 — 조회 **실패**를 「빈 결과」로 붕괴시키면 화면이 사실이 아닌 것을 근거로 **행동을 권한다**.
 *
 * 대상: `pages/ExposureTab.jsx`의 관심목록(`GET /api/watchlist`).
 * 그 목록은 두 곳에 쓰이는데 성격이 정반대다 —
 *   ① 「관심 N종목」 부기 → `>0`일 때만 렌더되므로 실패는 *생략*으로 끝난다(거짓 진술 없음).
 *   ② **후보 칩의 제외집합**(`computeTechCandidates`의 `mine`) → 실패를 `[]`로 붕괴시키면
 *      **이미 관심에 있는 종목이 「내가 안 가진 업체」로 승격**해 「관심 추가」 버튼이 뜬다.
 *      누르면 중복 추가다. 이것이 `wrong < missing`의 어포던스 판 위반이다.
 *
 * 상태는 셋이다 — **모름**(미조회·실패) · **0건**(조회 성공) · 비어있지 않음.
 * 그래서 이 파일의 축은 항상 **쌍**으로 온다: 「실패면 후보 0」 + 「성공 0건이면 후보 있음」.
 * 대조군이 없으면 「그냥 후보를 안 내는 구현」과 구별되지 않는다(그건 기능 삭제다).
 *
 * ⚠️ 판정은 `length`가 아니라 `Array.isArray`다 — `[]`는 모름이 아니라 **사실**이다.
 */
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// jsdom엔 matchMedia가 없다(useIsMobile) — 기존 테스트와 동일한 스텁.
window.matchMedia = window.matchMedia || (() => ({ matches: false, addEventListener() {}, removeEventListener() {} }))

vi.mock('../api', () => ({ default: { get: vi.fn(), post: vi.fn() } }))

// StockModal(후보 칩의 목적지)이 `useAuth()`를 쓴다 — Provider 밖이면 throw해 트리가 언마운트된다.
vi.mock('../contexts/AuthContext', () => ({
  useAuth: () => ({ role: 'user' }),
  AuthProvider: ({ children }) => children,
}))

import api from '../api'
import ExposureTab, { computeTechCandidates, computeTechExposure } from '../pages/ExposureTab'
import { _resetTechIndexCache } from '../hooks/useTechIndex'
import { ToastProvider } from '../components/Toast'

const HOLDINGS = [
  { ticker: '005930', name: '삼성전자', weight: 60 },
  { ticker: '000660', name: 'SK하이닉스', weight: 25 },
  { ticker: 'AAPL', name: 'Apple', weight: 15 },
]

// 노출>0 기술 하나 + 후보 4명(ARM·AMD·INTC·010120) — 3칩 + 「+1」이 나오는 최소 픽스처.
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
]

const EXPOSURE = {
  currency: { KR: { weight: 85 } },
  sector: { 반도체: { weight: 85 } },
  holdings: HOLDINGS,
  concentration: { top3_pct: 100, top5_pct: 100, max_single: { ticker: '005930', weight: 60 } },
  warnings: {}, no_fx: { count: 0, tickers: [] },
  portfolio_beta: 1.1, beta_coverage_pct: 90, beta_missing: [],
}

/** api.get을 URL별로 라우팅한다 — `watch`만 케이스마다 갈아끼운다(성공 배열 | 거절). */
function wireApi(watch) {
  api.get.mockImplementation((url) => {
    if (url.includes('/api/tech-reports/index')) return Promise.resolve({ data: { index: LISTED_INDEX } })
    if (url.includes('/api/watchlist')) return watch()
    return Promise.resolve({ data: EXPOSURE })
  })
}

const renderExposure = () => render(
  <ToastProvider><MemoryRouter><ExposureTab /></MemoryRouter></ToastProvider>
)

beforeEach(() => { _resetTechIndexCache(); api.get.mockReset() })
afterEach(() => { vi.restoreAllMocks(); _resetTechIndexCache() })

// ── 순수 함수 축 ─────────────────────────────────────────────────────────────
describe('computeTechCandidates — 관심목록 「모름」과 「0건」이 갈린다', () => {
  it('⚠️ 모름(null)이면 후보를 하나도 내지 않는다 — 제외집합이 불완전하므로 액션을 제시할 수 없다', () => {
    expect(computeTechCandidates(LISTED_INDEX, HOLDINGS, null).size).toBe(0)
    // 인자를 아예 생략한 경우도 「모름」이다(fail-closed). 예전 기본값 `[]`은
    // 「아직 물어보지 않았다」를 「관심 0건이라는 사실」로 승격시키던 함정이었다.
    expect(computeTechCandidates(LISTED_INDEX, HOLDINGS).size).toBe(0)
  })

  it('✅ 대조군 — 조회 성공 + 0건이면 후보를 낸다(빈 결과는 *사실*이다)', () => {
    const m = computeTechCandidates(LISTED_INDEX, HOLDINGS, [])
    expect(m.size).toBe(1)
    const e = m.get('ai-datacenter-equipment')
    expect(e.chips.map(c => c.ticker)).toEqual(['010120', 'ARM', 'AMD'])
    expect(e.more).toBe(1)
  })

  it('🦷 이빨 — 제외집합은 실제로 load-bearing이다(관심 티커가 후보에서 빠진다)', () => {
    // 이 축이 없으면 「모름이면 0」이 「제외집합을 아예 안 쓰는 구현」에서도 통과한다.
    const e = computeTechCandidates(LISTED_INDEX, HOLDINGS, ['ARM', 'AMD']).get('ai-datacenter-equipment')
    expect(e.chips.map(c => c.ticker)).toEqual(['010120', 'INTC'])
    expect(e.more).toBe(0)
  })

  it('막대 계산은 모름에도 그대로다 — 노출 값은 애초에 보유만 쓴다', () => {
    // 후보(액션)와 막대(진단)는 다른 축이다. 관심목록을 못 받았다고 진단을 지우지 않는다.
    const withNull = computeTechExposure(LISTED_INDEX, HOLDINGS, null)
    const withEmpty = computeTechExposure(LISTED_INDEX, HOLDINGS, [])
    expect(withNull.map(r => r.weight)).toEqual(withEmpty.map(r => r.weight))
    expect(withNull[0].weight).toBe(85)   // 60 + 25
    // 모름이면 watchCount는 0 → 부기가 *생략*된다(「관심 0종목」이라 말하지 않는다).
    expect(withNull[0].watchCount).toBe(0)
  })
})

// ── 렌더 축 ─────────────────────────────────────────────────────────────────
describe('ExposureTab — 관심목록 조회 실패가 후보 칩으로 새지 않는다', () => {
  it('⚠️ 실패하면 후보 칩·라벨이 하나도 없다 — 그래도 카드 본문(막대·기준 문구)은 그대로', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    wireApi(() => Promise.reject(new Error('boom')))
    renderExposure()

    // 카드와 막대는 살아 있어야 한다 — 실패한 것은 부가 정보뿐이다.
    const card = await screen.findByTestId('tech-exposure-card')
    expect(card.textContent).toContain('AI 데이터센터 설비')
    expect(screen.getByTestId('tech-exposure-basis')).toBeTruthy()
    expect(screen.getAllByTestId('tech-exposure-bar')).toHaveLength(1)

    // 후보 구역은 통째로 없다 — 「후보 없음」류 문구로도 붕괴하지 않는다.
    await waitFor(() => expect(console.warn).toHaveBeenCalled())
    expect(screen.queryAllByTestId('tech-cand-chip')).toHaveLength(0)
    expect(screen.queryAllByTestId('tech-cand-row')).toHaveLength(0)
    expect(screen.queryByTestId('tech-cand-label')).toBeNull()
    expect(screen.queryByTestId('tech-cand-more')).toBeNull()
  })

  it('✅ 대조군 — 관심목록이 성공 + 0건이면 후보 칩 3개 + 「+1」이 렌더된다', async () => {
    wireApi(() => Promise.resolve({ data: [] }))
    renderExposure()
    await screen.findByTestId('tech-exposure-card')
    await waitFor(() => expect(screen.getAllByTestId('tech-cand-chip')).toHaveLength(3))
    expect(screen.getAllByTestId('tech-cand-chip').map(c => c.getAttribute('data-ticker')))
      .toEqual(['010120', 'ARM', 'AMD'])
    expect(screen.getByTestId('tech-cand-more').textContent).toBe('+1')
  })

  it('🦷 이빨(렌더) — 관심에 담긴 업체는 칩에서 빠지고 다음 후보가 올라온다', async () => {
    wireApi(() => Promise.resolve({ data: [{ ticker: 'ARM' }] }))
    renderExposure()
    await screen.findByTestId('tech-exposure-card')
    await waitFor(() => expect(screen.getAllByTestId('tech-cand-chip')).toHaveLength(3))
    expect(screen.getAllByTestId('tech-cand-chip').map(c => c.getAttribute('data-ticker')))
      .toEqual(['010120', 'AMD', 'INTC'])
    expect(screen.queryByTestId('tech-cand-more')).toBeNull()
  })

  it('⚠️ 성공 뒤의 실패도 모름으로 되돌린다 — 낡은 목록을 그대로 두면 방금 담은 업체를 또 권한다', async () => {
    // ⚠️ 이 축이 없으면 `catch`의 `setWatchTickers(null)`이 **load-bearing이 아니다**
    //    (초기값이 이미 null이라 첫 실패만으로는 구별되지 않는다 — 주입 실측 0 fail).
    //    실제 위험은 *두 번째* 조회다: 후보를 관심에 담은 뒤 재조회가 실패하면, 낡은 목록을
    //    유지하는 구현은 **방금 담은 그 업체를 다시 「안 가진 업체」로 권한다.**
    // ⚠️ 여기서 `useTrackedStocks`의 `trusted`(성공 후엔 unknown으로 안 돌아간다)와 **반대로**
    //    판단한다 — 그쪽은 상태가 화면의 *본문*이고, 이쪽은 **제외집합**이라 낡으면 곧
    //    틀린 액션이 된다. 그래서 이쪽은 잃는 쪽(missing)을 고른다.
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    let watchCalls = 0
    api.get.mockImplementation((url) => {
      if (url.includes('/api/tech-reports/index')) return Promise.resolve({ data: { index: LISTED_INDEX } })
      if (url.includes('/api/watchlist')) {
        watchCalls += 1
        return watchCalls === 1 ? Promise.resolve({ data: [] }) : Promise.reject(new Error('boom'))
      }
      return Promise.resolve({ data: EXPOSURE })
    })
    api.post.mockResolvedValue({ data: { ok: true } })

    renderExposure()
    await screen.findByTestId('tech-exposure-card')
    await waitFor(() => expect(screen.getAllByTestId('tech-cand-chip')).toHaveLength(3))

    // ARM(US 티커라 거래소 선택이 없다) 칩 → 관심 추가 모달 → 저장
    screen.getAllByTestId('tech-cand-chip')
      .find(c => c.getAttribute('data-ticker') === 'ARM').click()
    await waitFor(() => expect(screen.getByText('관심종목 추가')).toBeTruthy())
    screen.getByText('저장').click()

    // POST는 성공했고 재조회가 실패했다 → 목록은 **모름**이므로 후보 구역이 사라진다.
    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/api/watchlist', expect.objectContaining({ ticker: 'ARM' })))
    await waitFor(() => expect(screen.queryAllByTestId('tech-cand-chip')).toHaveLength(0))
    expect(screen.queryAllByTestId('tech-cand-row')).toHaveLength(0)
    // 막대(진단)는 살아 있다 — 잃은 것은 액션뿐이다.
    expect(screen.getAllByTestId('tech-exposure-bar')).toHaveLength(1)
  })

  it('실패는 조용히 삼키지 않는다 — `[ExposureTab]` 마커로 warn(§4.5 graceful)', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    wireApi(() => Promise.reject(new Error('boom')))
    renderExposure()
    await screen.findByTestId('tech-exposure-card')
    await waitFor(() => expect(warn).toHaveBeenCalled())
    const msg = warn.mock.calls.map(c => String(c[0])).find(m => m.includes('[ExposureTab]'))
    expect(msg).toBeTruthy()
    expect(msg).toContain('관심목록 조회 실패')
  })
})

// ── 「아직 안 옴」 절반 — `useState(null)` 초기값 전용 축 ──────────────────────
// 위 축들이 전부 **실패**(`.catch`) 경로를 재므로, 초기값 `null` 자체는 **무커버리지**였다:
// `useState([])`로 주입해도 41축이 전부 초록이다(`catch`가 `null`을 세팅하므로 실패 축은 그대로
// 통과한다). 그런데 미커버 상태가 B76의 **가장 흔한 실제 발현면**이다 — 실패가 아니라
// 「아직 안 옴」이고, 3요청 병렬이라 **매 마운트마다** 그 창이 생긴다. 그 창 동안 이미 관심에
// 담은 종목이 「안 가진 업체」로 권해지고 누르면 중복 추가다.
// 「초기값을 []로 두면 코드가 단순하다」류 리팩터 한 번에 조용히 되살아난다.
describe('ExposureTab — 관심목록이 아직 도착하지 않은 창에서도 후보를 권하지 않는다', () => {
  it('⚠️ watchlist가 in-flight인 동안 후보 칩이 0개다(초기값 `[]`이면 2개가 렌더된다)', async () => {
    let resolveWatch
    wireApi(() => new Promise((res) => { resolveWatch = res }))
    renderExposure()
    await screen.findByTestId('tech-exposure-card')
    // 막대(진단)는 보유만 쓰므로 이미 렌더된다 — 정의역이 비지 않았다는 증거.
    await waitFor(() => expect(screen.getAllByTestId('tech-exposure-bar')).toHaveLength(1))
    expect(screen.queryAllByTestId('tech-cand-chip')).toHaveLength(0)

    // ✅ 대조군 — 도착하면(성공 + ARM·AMD 보유) 남은 후보가 정상적으로 올라온다.
    resolveWatch({ data: [{ ticker: 'ARM' }, { ticker: 'AMD' }] })
    await waitFor(() => expect(screen.getAllByTestId('tech-cand-chip')).toHaveLength(2))
    expect(screen.getAllByTestId('tech-cand-chip').map(c => c.getAttribute('data-ticker')))
      .toEqual(['010120', 'INTC'])
  })
})

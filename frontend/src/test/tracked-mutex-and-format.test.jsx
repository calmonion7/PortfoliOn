import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'

// B58(무음 삼킴) + B34(음수 축약)의 교차관심사 축 — task#331 그룹 γ.
//
// B58: `useTrackedStocks`의 뮤텍스는 **티커 단위**다. 같은 티커가 한 화면에 두 번 이상
// 렌더되면(구루 매니저별 top10에 같은 종목이 동시 등장) 첫 배지가 in-flight인 동안 형제
// 배지는 열린 채로 남고, 그 클릭은 뮤텍스에 걸려 **아무 흔적도 남기지 않았다** — 스피너도
// 토스트도 없어 사용자는 클릭이 먹혔는지 알 수 없었다.
// 뮤텍스 자체는 유지한다(task#273 S1(b) 결정 — 같은 티커 중복 POST/DELETE를 막는 유일한
// 장치이고, 큐로 바꾸면 같은 액션이 두 번 적용돼 원상복귀한다). 고치는 것은 **관측 가능성**이며
// 처방은 「pending으로 그 티커의 *모든* 진입점을 함께 잠근다」다.
//
// ⚠️ 이 파일이 재는 것은 **상태 전이와 속성**이다. 스피너의 시각적 크기·색·배지 대비는
// jsdom이 원리적으로 못 본다(§9.7 ⑤) → 라이브 몫.

const navigateMock = vi.fn()
vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal()
  return { ...actual, useNavigate: () => navigateMock }
})
vi.mock('../api', () => ({ default: { get: vi.fn(), post: vi.fn(), delete: vi.fn() } }))
vi.mock('../components/Toast', () => ({ useToast: () => ({ showToast: vi.fn() }) }))
vi.mock('../hooks/useIsMobile', () => ({ default: () => false }))

import api from '../api'
import GuruManagers from '../pages/GuruManagers'
import { WatchlistBtn } from '../pages/GuruStats'
import { fmtSharesUs } from '../utils'

// 같은 티커(AAPL)가 두 매니저의 top10에 동시 등장하는 실제 형태.
// MSFT는 **대조군 티커**다 — 잠금이 티커 단위인지 전역인지 가른다.
const DUP = {
  last_updated: '2026-08-01T00:00:00',
  managers: [
    {
      id: 'brk', name: 'Warren Buffett', firm: 'Berkshire Hathaway',
      portfolio_value: 350000000000, num_stocks: 45,
      top10: [
        { rank: 1, ticker: 'AAPL', name: 'Apple', name_kr: '', weight_pct: 40 },
        { rank: 2, ticker: 'MSFT', name: 'Microsoft', name_kr: '', weight_pct: 10 },
      ],
    },
    {
      id: 'ako', name: 'AKO Capital', firm: 'AKO Capital',
      portfolio_value: 9000000000, num_stocks: 30,
      top10: [{ rank: 1, ticker: 'AAPL', name: 'Apple', name_kr: '', weight_pct: 20 }],
    },
  ],
}

let stocks = []

function mockApi() {
  stocks = []
  api.get.mockImplementation((url) =>
    url === '/api/guru/managers' ? Promise.resolve({ data: DUP }) : Promise.resolve({ data: stocks })
  )
}

// aria-busy는 이 축의 앵커다 — 지우면 「삼킴이 관측 가능하다」를 재는 수단이 없어진다.
const badges = (ticker) => screen.getAllByText(ticker)
const busyOf = (ticker) => badges(ticker).map(b => b.getAttribute('aria-busy'))

beforeEach(() => { vi.clearAllMocks(); mockApi() })
afterEach(() => { vi.restoreAllMocks() })

describe('B58 — 같은 티커가 여러 곳에 렌더될 때 두 번째 클릭이 무음으로 삼켜지지 않는다', () => {
  it('한 배지가 in-flight면 다른 매니저 카드의 같은 티커 배지도 함께 잠긴다(aria-busy)', async () => {
    let resolvePost
    api.post.mockImplementation(() => new Promise(res => { resolvePost = res }))
    render(<GuruManagers />)
    await screen.findByText('Warren Buffett')

    expect(badges('AAPL')).toHaveLength(2)   // 정의역 sentinel — 중복이 실제로 렌더됐다
    expect(busyOf('AAPL')).toEqual([null, null])

    fireEvent.click(badges('AAPL')[0])

    // 수정 전: 두 번째 배지에 어떤 표시도 없어 클릭이 훅 뮤텍스에 조용히 삼켜졌다.
    await waitFor(() => expect(busyOf('AAPL')).toEqual(['true', 'true']))

    await act(async () => { resolvePost({}) })
    await waitFor(() => expect(busyOf('AAPL')).toEqual([null, null]))
  })

  it('대조군 — 잠금은 티커 단위다. AAPL이 in-flight여도 MSFT 배지는 열려 있다', async () => {
    let resolvePost
    api.post.mockImplementation(() => new Promise(res => { resolvePost = res }))
    render(<GuruManagers />)
    await screen.findByText('Warren Buffett')

    fireEvent.click(badges('AAPL')[0])
    await waitFor(() => expect(busyOf('AAPL')).toEqual(['true', 'true']))
    // 전역 busy 플래그로 구현하면 이 단언이 깨진다.
    expect(busyOf('MSFT')).toEqual([null])

    await act(async () => { resolvePost({}) })
  })

  it('대조군 — 정상 단일 클릭은 이전과 같게 동작한다(payload 5필드 보존 + navigate 미발생)', async () => {
    api.post.mockResolvedValue({})
    render(<GuruManagers />)
    await screen.findByText('Warren Buffett')

    await act(async () => { fireEvent.click(badges('MSFT')[0]) })
    expect(api.post).toHaveBeenCalledTimes(1)
    expect(api.post).toHaveBeenCalledWith('/api/watchlist', {
      ticker: 'MSFT', name: 'Microsoft', market: 'US', exchange: '', security_type: 'EQUITY',
    })
    expect(navigateMock).not.toHaveBeenCalled()
  })

  // aria-busy는 AT에만 들린다 — 눈에 보이는 잠금은 인라인 style이고, **인라인이라 CSS 규칙
  // 없이 적용되므로** jsdom이 유일하게 볼 수 있는 시각 축이다(클래스 기반이면 §9.7 ⑤로 밀린다).
  it('잠긴 배지는 눈에도 잠겨 보인다(opacity·cursor) + 대조군은 그대로', async () => {
    let resolvePost
    api.post.mockImplementation(() => new Promise(res => { resolvePost = res }))
    render(<GuruManagers />)
    await screen.findByText('Warren Buffett')
    expect(badges('AAPL')[1].style.cursor).toBe('pointer')

    fireEvent.click(badges('AAPL')[0])
    await waitFor(() => expect(busyOf('AAPL')).toEqual(['true', 'true']))

    for (const b of badges('AAPL')) {
      expect(b.style.cursor).toBe('progress')
      expect(b.style.opacity).toBe('0.6')
    }
    expect(badges('MSFT')[0].style.cursor).toBe('pointer')
    expect(badges('MSFT')[0].style.opacity).toBe('')

    await act(async () => { resolvePost({}) })
  })

  it('잠긴 배지의 클릭은 요청을 늘리지 않는다(뮤텍스 계약 보존)', async () => {
    let resolvePost
    api.post.mockImplementation(() => new Promise(res => { resolvePost = res }))
    render(<GuruManagers />)
    await screen.findByText('Warren Buffett')

    fireEvent.click(badges('AAPL')[0])
    await waitFor(() => expect(busyOf('AAPL')).toEqual(['true', 'true']))
    fireEvent.click(badges('AAPL')[1])
    expect(api.post).toHaveBeenCalledTimes(1)

    await act(async () => { resolvePost({}) })
  })
})

describe('B58 — WatchlistBtn(구루 3화면 공용)도 훅의 pending을 본다', () => {
  const base = { ticker: 'AAPL', name: 'Apple', stockMap: {}, onToggle: vi.fn() }

  it('그 티커가 pending이면 버튼이 잠기고 진행 표시로 바뀐다', () => {
    render(<WatchlistBtn {...base} pending={new Set(['AAPL'])} />)
    const btn = screen.getByRole('button')
    expect(btn).toBeDisabled()
    expect(btn.getAttribute('aria-busy')).toBe('true')
    expect(btn.textContent).not.toContain('추가')   // 스피너로 교체됐다
  })

  it('대조군 — 다른 티커가 pending이면 그대로 눌릴 수 있다', () => {
    render(<WatchlistBtn {...base} pending={new Set(['MSFT'])} />)
    const btn = screen.getByRole('button')
    expect(btn).not.toBeDisabled()
    expect(btn.textContent).toContain('☆ 추가')
  })

  it('대조군 — pending 미전달도 렌더된다(옛 호출부 계약 보존)', () => {
    render(<WatchlistBtn {...base} />)
    expect(screen.getByRole('button')).not.toBeDisabled()
  })
})

describe('B34 — fmtSharesUs 소비처 조립: 이중 부호가 생기지 않는다', () => {
  // `components/reports/UsInsiderSection.jsx`가 net_shares에 **양수만** '+'를 직접 붙인다.
  // 포매터가 부호를 넣기 시작하면 그 조립이 `+-1.20B`가 될 수 있으므로, 포매터는 '-'만
  // 넣는다는 계약을 여기서 못박는다(그 파일은 이 그룹 소유가 아니라 재현으로 검증한다).
  const asConsumerRenders = (v) => `${v > 0 ? '+' : ''}${fmtSharesUs(v)}`

  it('음수는 부호 하나로 축약된다', () => {
    expect(asConsumerRenders(-1.2e9)).toBe('-1.20B')
    expect(asConsumerRenders(-3.4e6)).toBe('-3.40M')
  })

  it('양수는 소비처가 붙인 + 하나만 갖는다', () => {
    expect(asConsumerRenders(1.2e9)).toBe('+1.20B')
  })

  it('어떤 부호 조합에도 연속 부호가 없다', () => {
    for (const v of [-2e9, -2e6, -2e3, -999, 0, 999, 2e3, 2e6, 2e9]) {
      expect(asConsumerRenders(v)).not.toMatch(/[+-]{2}/)
    }
  })
})

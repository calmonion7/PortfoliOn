/**
 * B49 — 세대 가드(스테일 응답 차단)의 형제 집합.
 *
 * **레이스 성립 조건 한 문장**: 같은 상태를 쓰는 비동기 호출이 2개 이상 겹칠 수 있고,
 * 먼저 보낸 것이 늦게 도착하면 낡은 응답이 최신 화면을 소유한다(§9.4).
 *
 * ⚠️ **착수 시 census를 다시 셌고 배정 목록이 stale했다.** 배정된 5곳 중 4곳
 * (`UsInsiderSection`·`InsiderTradesSection`·`UsSupplySection`·`LatestDisclosuresSection`)은
 * **이미 `cancelled` 관용구로 가드돼 있었다**(형제 `ShortSell`·`Supply`·`InvestorTrend`·
 * `GuruHolders`까지 8종이 같은 형태다). 실제 미가드는 아래 셋이었다:
 *   ⓐ `HistoryTab` — 비교 날짜 이펙트 2개 + 히스토리 이펙트(`.finally` 미게이트)
 *   ⓑ `ConsensusChart::fetchData` — `clearTimeout`만 있고 in-flight 응답은 무조건 착지
 *   ⓒ `DetailTab::BacklogSection` — 형제 8종 중 유일한 누락
 *
 * ⚠️ ⓑ·ⓒ는 지금 부모의 `key={ticker}` 재마운트가 **우연히** 덮고 있다(`Reports.jsx`·
 * `Ranking.jsx`). 그 `key`는 어디에도 스테일 전략으로 선언된 바 없으므로, 탭 상태를
 * 티커 전환 간에 보존하려는 리팩터 한 번에 전부 되살아난다(task#283 렌즈 — 무거운
 * 리셋이 덮고 있던 결함). 그래서 이 테스트는 `key` 없이 prop만 갈아 **그 보호를 벗긴 상태**로
 * 컴포넌트를 직접 렌더한다. ⓐ는 `key`와 무관한 **같은 마운트 내** 레이스라 지금도 활성이다.
 *
 * 각 축은 **대조군과 쌍**이다 — 「스테일이 안 보인다」만 재면 「아무것도 렌더하지 않는
 * 구현」에서도 통과한다(그건 기능 삭제다).
 */
import { render, screen, waitFor, act } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'

window.matchMedia = window.matchMedia || (() => ({ matches: false, addEventListener() {}, removeEventListener() {} }))

vi.mock('../api', () => ({ default: { get: vi.fn(), post: vi.fn() } }))
vi.mock('../components/Toast', () => ({ useToast: () => ({ showToast: vi.fn() }) }))

import api from '../api'
import HistoryTab from '../components/reports/HistoryTab'
import ConsensusChart from '../components/reports/ConsensusChart'
import { BacklogSection } from '../components/reports/DetailTab'

/** 해소 시점을 테스트가 소유하는 promise — 도착 **순서**를 뒤집기 위한 도구. */
function deferred() {
  let resolve, reject
  const promise = new Promise((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}

/**
 * ⚠️ 스테일 응답은 **실제로 착지시킨 뒤** 판정해야 한다.
 * 해소 직후 `waitFor(() => expect(옛값이 없다))`로 재면 **React가 아직 그 갱신을
 * 처리하지 않은 상태에서 첫 폴이 성공**해 그대로 통과한다 — 가드를 지워도 초록인
 * 「이빨 없는 축」이 된다. 주입 실측으로 확인했다: 이 flush가 없던 판에서 4개 축 중
 * **2개가 가드 제거에도 초록**이었다(HistoryTab 로딩플래그·ConsensusChart 스테일).
 * 그래서 여기서는 `act`로 마이크로태스크 + 매크로태스크를 모두 배수한 뒤 **plain
 * expect**로 판정한다(`waitFor` 금지 — 재시도가 타이밍을 세탁한다).
 */
const settle = async (fn) => {
  await act(async () => {
    fn()
    await Promise.resolve()
    await new Promise(r => setTimeout(r, 25))
  })
}

beforeEach(() => { api.get.mockReset() })

// ── ⓐ HistoryTab — 같은 마운트 내 레이스(비교 날짜 전환) ─────────────────────
describe('HistoryTab — 비교 날짜를 바꿀 때 옛 날짜 응답이 늦게 도착한다', () => {
  const HISTORY = [
    { date: '2026-08-01', has_snapshot: true },
    { date: '2026-08-02', has_snapshot: true },
    { date: '2026-08-03', has_snapshot: true },
  ]
  // 마운트 시 compareA = 마지막(08-03), compareB = 그 앞(08-02).
  const snap = (price) => ({ data: { summary: { price } } })

  it('⚠️ 늦게 온 옛 날짜 수치가 현재 선택 칼럼에 렌더되지 않는다', async () => {
    const d03 = deferred()   // 마운트가 고른 08-03 — 일부러 **늦게** 해소한다
    api.get.mockImplementation((url) => {
      if (url.endsWith('/history')) return Promise.resolve({ data: HISTORY })
      if (url.endsWith('/2026-08-03')) return d03.promise
      if (url.endsWith('/2026-08-02')) return Promise.resolve(snap(222))
      if (url.endsWith('/2026-08-01')) return Promise.resolve(snap(111))
      return Promise.resolve({ data: {} })
    })

    render(<HistoryTab ticker="AAPL" market="US" />)
    // 히스토리가 도착해 표가 생기고 08-03 요청은 아직 in-flight다.
    const selects = await waitFor(() => {
      const s = document.querySelectorAll('select')
      expect(s).toHaveLength(2)
      return s
    })
    expect(selects[0].value).toBe('2026-08-03')

    // 사용자가 A를 08-01로 바꾼다 → 새 요청이 즉시 해소된다.
    selects[0].value = '2026-08-01'
    selects[0].dispatchEvent(new Event('change', { bubbles: true }))
    await waitFor(() => expect(document.body.textContent).toContain('$111.00'))

    // 이제 낡은 08-03이 도착한다. 세대 가드가 없으면 이 값이 A 칼럼을 덮는다.
    await settle(() => d03.resolve(snap(333)))
    expect(selects[0].value).toBe('2026-08-01')
    expect(document.body.textContent).toContain('$111.00')
    expect(document.body.textContent).not.toContain('$333.00')
  })

  it('✅ 대조군 — 경합이 없으면 마운트가 고른 날짜의 수치가 정상 렌더된다', async () => {
    api.get.mockImplementation((url) => {
      if (url.endsWith('/history')) return Promise.resolve({ data: HISTORY })
      if (url.endsWith('/2026-08-03')) return Promise.resolve(snap(333))
      if (url.endsWith('/2026-08-02')) return Promise.resolve(snap(222))
      return Promise.resolve({ data: {} })
    })
    render(<HistoryTab ticker="AAPL" market="US" />)
    await waitFor(() => expect(document.body.textContent).toContain('$333.00'))
    expect(document.body.textContent).toContain('$222.00')
  })

  // ⚠️ 이 축의 이름은 원래 「낡은 응답이 로딩 플래그를 열지 않는다」였는데 **재는 것이 달랐다** —
  //    픽스처가 새 요청(MSFT)을 *먼저* 해소하므로 두 `.finally`가 모두 `setHistLoading(false)`로
  //    같은 값을 써서 `.finally` 게이트의 관측 차이가 **원리적으로 생기지 않는다**. 단독 주입 실측:
  //    `.finally` 게이트만 제거 → 8축 전부 초록 / `.then` 게이트만 제거 → 이 축이 FAIL.
  //    즉 이것은 `.then` 게이트의 축이므로 이름을 그대로 고쳤고, `.finally`는 아래 축이 맡는다.
  it('낡은 응답이 `history`를 덮지 않는다 — 옛 티커의 스냅샷 날짜가 UI로 새지 않는다', async () => {
    const first = deferred()
    api.get.mockImplementation((url) => {
      if (url.includes('/AAPL/history')) return first.promise
      if (url.includes('/MSFT/history')) return Promise.resolve({ data: [] })
      return Promise.resolve({ data: {} })
    })
    const { rerender } = render(<HistoryTab ticker="AAPL" market="US" />)
    expect(screen.getByText('로딩 중...')).toBeTruthy()

    // 티커 전환(부모 key가 없다고 가정) → MSFT는 즉시 빈 히스토리로 해소된다.
    rerender(<HistoryTab ticker="MSFT" market="US" />)
    await waitFor(() => expect(screen.getByText('히스토리 데이터가 없습니다.')).toBeTruthy())

    // 낡은 AAPL 응답이 도착해도 `history`/`histLoading`을 건드리지 않는다.
    await settle(() => first.resolve({ data: [{ date: '2026-08-03', has_snapshot: true }] }))
    expect(screen.getByText('히스토리 데이터가 없습니다.')).toBeTruthy()
    expect(screen.queryByText('로딩 중...')).toBeNull()
    expect(document.querySelectorAll('select')).toHaveLength(0)   // 옛 스냅샷 날짜가 UI로 새지 않았다
  })

  // ── `.finally` 게이트 전용 축 ────────────────────────────────────────────────
  // 위 축이 못 재는 절반이다. 여기서는 **새 요청을 in-flight로 붙잡은 채** 낡은 응답을 착지시킨다 —
  // 그래야 두 `.finally`가 같은 값을 쓰는 상황이 사라지고 게이트의 유무가 화면으로 갈린다.
  // 게이트가 없으면 `histLoading=false` + `history=[]` → 화면이 「히스토리 데이터가 없습니다.」로
  // 바뀐다. 요청이 아직 날아가는 중인데 「없다」고 **단정**하는 `wrong < missing` 위반이다.
  it('낡은 응답의 `.finally`가 로딩을 끄지 않는다 — 새 요청 in-flight 중에 「없다」고 단정하지 않는다', async () => {
    const oldReq = deferred()
    const newReq = deferred()
    api.get.mockImplementation((url) => {
      if (url.includes('/AAPL/history')) return oldReq.promise
      if (url.includes('/MSFT/history')) return newReq.promise
      return Promise.resolve({ data: {} })
    })
    const { rerender } = render(<HistoryTab ticker="AAPL" market="US" />)
    expect(screen.getByText('로딩 중...')).toBeTruthy()

    rerender(<HistoryTab ticker="MSFT" market="US" />)   // 새 요청은 해소하지 않는다
    expect(screen.getByText('로딩 중...')).toBeTruthy()

    await settle(() => oldReq.resolve({ data: [{ date: '2026-08-03', has_snapshot: true }] }))
    expect(screen.getByText('로딩 중...')).toBeTruthy()
    expect(screen.queryByText('히스토리 데이터가 없습니다.')).toBeNull()

    // ✅ 대조군 — 가드가 **새** 응답까지 막아 영영 로딩에 머무는 구현이 아님을 못박는다.
    await settle(() => newReq.resolve({ data: [] }))
    expect(screen.getByText('히스토리 데이터가 없습니다.')).toBeTruthy()
  })

  it('낡은 실패의 `.catch`가 새 티커 화면에 에러를 남기지 않는다', async () => {
    const oldReq = deferred()
    const newReq = deferred()
    api.get.mockImplementation((url) => {
      if (url.includes('/AAPL/history')) return oldReq.promise
      if (url.includes('/MSFT/history')) return newReq.promise
      return Promise.resolve({ data: {} })
    })
    const { rerender } = render(<HistoryTab ticker="AAPL" market="US" />)
    rerender(<HistoryTab ticker="MSFT" market="US" />)
    await settle(() => oldReq.reject(new Error('boom')))
    expect(screen.queryByText('히스토리 데이터를 불러올 수 없습니다.')).toBeNull()
    expect(screen.getByText('로딩 중...')).toBeTruthy()

    // ✅ 대조군 — 새 요청이 실패하면 그때는 에러가 실제로 뜬다(가드가 에러 표시를 죽이지 않았다).
    await settle(() => newReq.reject(new Error('boom2')))
    expect(screen.getByText('히스토리 데이터를 불러올 수 없습니다.')).toBeTruthy()
  })
})

// ── ⓑ ConsensusChart — 티커 전환(부모 key 없이) ──────────────────────────────
describe('ConsensusChart — 옛 티커의 컨센서스가 새 티커 화면에 착지하지 않는다', () => {
  const EMPTY_MSG = '아직 수집된 데이터가 없습니다. 수집 버튼을 눌러주세요.'
  const POINT = { date: '2026-08-03', target_mean: 100000, buy: 5, hold: 1, sell: 0 }

  it('⚠️ `clearTimeout`은 in-flight 응답을 막지 못한다 — 세대 가드가 필요하다', async () => {
    const old = deferred()
    api.get.mockImplementation((url) => {
      if (url.includes('/api/consensus/005930')) return old.promise
      return Promise.resolve({ data: [] })          // 새 티커는 데이터 없음
    })
    const { rerender } = render(<ConsensusChart ticker="005930" market="KR" />)
    rerender(<ConsensusChart ticker="AAPL" market="US" />)
    await waitFor(() => expect(screen.getByText(EMPTY_MSG)).toBeTruthy())

    // 옛 종목(원화 스케일)의 응답이 늦게 도착한다 — 새면 「데이터 없음」이 사라지고
    // 원화 수치가 `$`로 렌더된다(B27과 동종의 통화 오표시).
    await settle(() => old.resolve({ data: [POINT] }))
    expect(screen.getByText(EMPTY_MSG)).toBeTruthy()
    expect(screen.queryByText('목표가')).toBeNull()   // 뷰 스위처가 안 떴다 = 데이터가 안 새어들어왔다
  })

  it('✅ 대조군 — 경합이 없으면 데이터가 도착해 「데이터 없음」이 사라진다', async () => {
    api.get.mockResolvedValue({ data: [POINT] })
    render(<ConsensusChart ticker="005930" market="KR" />)
    await waitFor(() => expect(screen.queryByText(EMPTY_MSG)).toBeNull())
    expect(screen.getByText('목표가')).toBeTruthy()   // 뷰 스위처가 떴다 = 데이터 있음
  })

  it('낡은 실패는 auto-retry를 예약하지 않는다 — 그 재시도는 **옛 종목을 다시 부른다**', async () => {
    // ⚠️ 이 축은 **가짜 타이머 없이는 이빨이 없다** — 재시도는 1.5초 뒤에 발사되므로
    //    60ms만 기다려 「추가 호출 0」을 재면 가드를 지워도 초록이다(주입 실측 확인).
    //    그리고 `clearTimeout`도 못 막는다: cleanup은 티커 전환 시점에 이미 지나갔고,
    //    그 뒤에 예약된 타이머는 아무도 취소하지 않는다.
    const old = deferred()
    api.get.mockImplementation((url) => {
      if (url.includes('/api/consensus/005930')) return old.promise
      return Promise.resolve({ data: [] })
    })
    const { rerender } = render(<ConsensusChart ticker="005930" market="KR" />)
    rerender(<ConsensusChart ticker="AAPL" market="US" />)
    await waitFor(() => expect(screen.getByText(EMPTY_MSG)).toBeTruthy())
    const oldCalls = () => api.get.mock.calls.filter(c => String(c[0]).includes('005930')).length
    expect(oldCalls()).toBe(1)   // 대조군 — 마운트가 실제로 옛 종목을 부른 적이 있다

    vi.useFakeTimers()
    try {
      await act(async () => {
        old.reject(new Error('boom'))
        await Promise.resolve()
        await vi.advanceTimersByTimeAsync(2000)   // 재시도 창(1.5s)을 통과시킨다
      })
    } finally {
      vi.useRealTimers()
    }
    expect(oldCalls()).toBe(1)                        // 옛 종목을 다시 부르지 않았다
    expect(screen.queryByText(/일시적 연결 오류/)).toBeNull()   // 실패 표시도 새 화면에 안 샌다
  })
})

// ── ⓒ BacklogSection — 형제 8종 중 유일한 미가드였던 곳 ──────────────────────
describe('BacklogSection — 옛 종목의 수주잔고가 새 종목 차트로 렌더되지 않는다', () => {
  const TITLE = '📦 수주잔고 추이'
  const ROWS = [
    { period: '2025Q1', amount: 1000, qoq: null, source: 'dart' },
    { period: '2025Q2', amount: 1200, qoq: 20, source: 'dart' },
  ]

  it('⚠️ 늦게 온 옛 종목 응답이 차트를 되살리지 않는다', async () => {
    const old = deferred()
    api.get.mockImplementation((url) => {
      if (url.includes('/005930/backlog')) return old.promise
      return Promise.resolve({ data: [] })           // 새 종목은 잔고 없음 → 차트 null
    })
    const { rerender } = render(<BacklogSection ticker="005930" market="KR" />)
    rerender(<BacklogSection ticker="000660" market="KR" />)
    await waitFor(() => expect(screen.queryByText(TITLE)).toBeNull())

    await settle(() => old.resolve({ data: ROWS }))
    expect(screen.queryByText(TITLE)).toBeNull()
  })

  it('✅ 대조군 — 경합이 없으면 수주잔고 차트가 렌더된다', async () => {
    api.get.mockResolvedValue({ data: ROWS })
    render(<BacklogSection ticker="005930" market="KR" />)
    await waitFor(() => expect(screen.getByText(TITLE)).toBeTruthy())
  })

  // ── 「보존」 절반 ────────────────────────────────────────────────────────────
  // 세대 가드/취소 플래그는 **늦은 착지**만 막고 **보존**을 막지 않는다. 옛 종목 데이터가 *이미*
  // 착지한 뒤 prop만 갈면 경합조차 없이 **결정적으로** 옛 데이터가 새 종목 화면을 소유한다.
  // 위 축 3개는 전부 「새 티커가 먼저 해소, 옛 티커가 늦게 도착」 순서만 구성해 이 절반을
  // 정의역에서 통째로 놓쳤다.
  it('⚠️ 옛 종목 데이터가 착지한 *뒤* prop만 갈리면 옛 차트가 새 종목 화면에 남지 않는다', async () => {
    const pending = deferred()
    api.get.mockImplementation((url) => {
      if (url.includes('/005930/backlog')) return Promise.resolve({ data: ROWS })
      return pending.promise                                  // 새 종목은 in-flight로 붙잡는다
    })
    const { rerender } = render(<BacklogSection ticker="005930" market="KR" />)
    await waitFor(() => expect(screen.getByText(TITLE)).toBeTruthy())   // 옛 데이터 착지 확인

    await settle(() => rerender(<BacklogSection ticker="000660" market="KR" />))
    expect(screen.queryByText(TITLE)).toBeNull()
  })
})

describe('ConsensusChart — 착지한 옛 티커 데이터가 새 티커 화면에 보존되지 않는다', () => {
  const POINT = { date: '2026-08-03', target_mean: 100000, buy: 5, hold: 1, sell: 0 }

  it('⚠️ 옛 데이터가 착지한 뒤 prop만 갈면 옛 수치가 **새 market으로 포맷돼** 남지 않는다', async () => {
    const pending = deferred()
    api.get.mockImplementation((url) => {
      if (url.includes('/api/consensus/005930')) return Promise.resolve({ data: [POINT] })
      return pending.promise
    })
    const { rerender } = render(<ConsensusChart ticker="005930" market="KR" />)
    await waitFor(() => expect(screen.getByText('목표가')).toBeTruthy())   // 뷰 스위처 = 데이터 있음

    await settle(() => rerender(<ConsensusChart ticker="AAPL" market="US" />))
    expect(screen.queryByText('목표가')).toBeNull()          // 옛 KR 데이터가 US 화면에 안 남았다
  })

  it('미조회는 「수집된 데이터가 없다」고 단정하지 않는다 — 3상태(null/[]/실패)', async () => {
    const pending = deferred()
    api.get.mockReturnValue(pending.promise)
    render(<ConsensusChart ticker="005930" market="KR" />)
    // in-flight 동안 「없다 + 수집 버튼을 눌러주세요」(행동 지시)가 뜨면 거짓 진술이다.
    expect(screen.queryByText('아직 수집된 데이터가 없습니다. 수집 버튼을 눌러주세요.')).toBeNull()
    expect(screen.getByText('컨센서스 불러오는 중…')).toBeTruthy()

    // ✅ 대조군 — 조회 성공 0건은 **사실**이므로 그때는 「없다」가 떠야 한다.
    await settle(() => pending.resolve({ data: [] }))
    expect(screen.getByText('아직 수집된 데이터가 없습니다. 수집 버튼을 눌러주세요.')).toBeTruthy()
    expect(screen.queryByText('컨센서스 불러오는 중…')).toBeNull()
  })
})

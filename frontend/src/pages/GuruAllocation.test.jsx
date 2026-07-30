import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

vi.mock('../api', () => ({ default: { get: vi.fn(), post: vi.fn(), delete: vi.fn() } }))
// jsdom엔 matchMedia가 없다 — 탭 라벨 검증에 반응형은 무관하므로 PC로 고정한다.
vi.mock('../hooks/useIsMobile', () => ({ default: () => false }))
// 액션 실패는 토스트로 알린다(task#244 G5) — GlobalSearch와 같은 형태.
const showToastSpy = vi.fn()
vi.mock('../components/Toast', () => ({ useToast: () => ({ showToast: showToastSpy }) }))

import api from '../api'
import GuruAllocation from './GuruAllocation'
import Guru from './Guru'

// 60종목: 스코프 필의 "10/20/50"이 곧 행수라는 옛 가정을 실증적으로 반증하기 위해,
// 각 코호트 페이로드의 rows 길이를 스코프 숫자보다 *일부러 크게* 둔다(task#247 S2) —
// 남아있는 잘림 로직이 있다면 그대로 드러난다. TCK55는 ALL에만 있고 TOP10엔 없어
// "코호트 밖 검색" 시나리오의 대상 티커로 쓴다.
const ROWS = Array.from({ length: 60 }, (_, i) => ({
  ticker: `TCK${i + 1}`,
  name: `Company ${i + 1}`,
  name_kr: i < 3 ? `종목${i + 1}` : '',      // 앞 3개만 한글명(top10층 조인 재현)
  value: (60 - i) * 1e9,
  ratio: (60 - i) / 60 * 100,
  holder_count: 60 - i,
}))

const ALL_ROWS = ROWS
const TOP10_ROWS = ROWS.slice(0, 15)
const TOP20_ROWS = ROWS.slice(0, 25)
const TOP50_ROWS = ROWS.slice(0, 55)

const ALL_PAYLOAD = {
  total_value: 1_077_000_000_000,
  manager_count: 83,
  all_manager_count: 83,
  all_total_value: 1_077_000_000_000,
  ticker_count: ALL_ROWS.length,
  periods: { 'Q1 2026': 83 },
  estimated_count: 0,
  last_updated: '2026-07-29T11:40:00',
  rows: ALL_ROWS,
}
const TOP10_PAYLOAD = {
  total_value: 765_900_000_000,
  manager_count: 10,
  all_manager_count: 83,
  all_total_value: 1_077_000_000_000,
  ticker_count: TOP10_ROWS.length,
  periods: { 'Q1 2026': 10 },
  estimated_count: 0,
  last_updated: '2026-07-29T11:40:00',
  rows: TOP10_ROWS,
}
const TOP20_PAYLOAD = { ...TOP10_PAYLOAD, manager_count: 20, ticker_count: TOP20_ROWS.length, periods: { 'Q1 2026': 20 }, rows: TOP20_ROWS }
const TOP50_PAYLOAD = { ...TOP10_PAYLOAD, manager_count: 50, ticker_count: TOP50_ROWS.length, periods: { 'Q1 2026': 50 }, rows: TOP50_ROWS }

function mockApi(overrideAllPayload) {
  const all = overrideAllPayload || ALL_PAYLOAD
  api.get.mockImplementation((url) => {
    if (url === '/api/guru/stats/allocation') return Promise.resolve({ data: all })
    if (url === '/api/guru/stats/allocation?top=10') return Promise.resolve({ data: TOP10_PAYLOAD })
    if (url === '/api/guru/stats/allocation?top=20') return Promise.resolve({ data: TOP20_PAYLOAD })
    if (url === '/api/guru/stats/allocation?top=50') return Promise.resolve({ data: TOP50_PAYLOAD })
    if (url === '/api/guru/managers') return Promise.resolve({ data: { last_updated: null, managers: [] } })
    return Promise.resolve({ data: [] })
  })
}

const rowCount = (c) => c.querySelectorAll('.guru-stat-row').length
const allocCalls = () => api.get.mock.calls.filter(c => c[0].startsWith('/api/guru/stats/allocation')).length

beforeEach(() => vi.clearAllMocks())

describe('구루 자산 배분 탭 (task#241)', () => {
  it('구루 허브 탭이 4개이고 마지막이 투자금', async () => {
    mockApi()
    const { container } = render(<MemoryRouter><Guru /></MemoryRouter>)
    const labels = [...container.querySelectorAll('.tabs button, .seg button')].map(b => b.textContent)
    expect(labels).toEqual(['매니저 목록', '인기순', '가중치', '투자금'])
  })

  it('한글명 없는 행은 영문명으로 폴백한다', async () => {
    mockApi()
    const { container } = render(<GuruAllocation />)
    await screen.findByText('TCK1')
    const names = [...container.querySelectorAll('.guru-stat-name')].map(e => e.textContent)
    expect(names[0]).toContain('종목1')        // name_kr 있음
    expect(names[5]).toContain('Company 6')    // name_kr 없음 → 영문명
  })

  it('행에 투자금·비율·보유 구루 수가 모두 실린다', async () => {
    mockApi()
    const { container } = render(<GuruAllocation />)
    await screen.findByText('TCK1')
    const row = container.querySelector('.guru-stat-row')
    expect(row.querySelector('.guru-stat-value').textContent).toBe('$60.0B')
    expect(row.querySelector('.guru-stat-name').textContent).toContain('100.00%')
    expect(row.querySelector('.guru-stat-name').textContent).toContain('60명')
  })

  it('데이터 없으면 빈 상태를 보여준다', async () => {
    mockApi({ total_value: 0, manager_count: 0, ticker_count: 0, rows: [] })
    render(<GuruAllocation />)
    expect(await screen.findByText(/크롤링을 먼저 실행/)).toBeTruthy()
  })
})

// ── task#247 S2: 필의 의미가 "표시 줄 수"에서 "집계 코호트"로 바뀌었다 ─────────────
describe('구루 자산 배분 — 스코프=집계 코호트 (task#247)', () => {
  it('기본 진입은 top 파라미터 없이 전체를 fetch하고 응답 전량을 렌더한다', async () => {
    mockApi()
    const { container } = render(<GuruAllocation />)
    await screen.findByText('TCK1')
    expect(api.get).toHaveBeenCalledWith('/api/guru/stats/allocation')
    expect(rowCount(container)).toBe(ALL_ROWS.length)
  })

  it('스코프 필 클릭이 ?top=N으로 fetch하고, 행 수는 스코프 숫자가 아니라 응답을 그대로 따른다', async () => {
    mockApi()
    const { container } = render(<GuruAllocation />)
    await screen.findByText('TCK1')

    fireEvent.click(screen.getByText('10명'))
    await waitFor(() => expect(rowCount(container)).toBe(TOP10_ROWS.length))
    expect(api.get).toHaveBeenCalledWith('/api/guru/stats/allocation?top=10')

    fireEvent.click(screen.getByText('50명'))
    await waitFor(() => expect(rowCount(container)).toBe(TOP50_ROWS.length))
    expect(api.get).toHaveBeenCalledWith('/api/guru/stats/allocation?top=50')

    fireEvent.click(screen.getByText('전체'))
    await waitFor(() => expect(rowCount(container)).toBe(ALL_ROWS.length))
  })

  it('같은 스코프를 재방문해도 재요청하지 않는다(스코프→응답 캐시)', async () => {
    mockApi()
    render(<GuruAllocation />)
    await screen.findByText('TCK1')
    expect(allocCalls()).toBe(1)

    fireEvent.click(screen.getByText('10명'))
    await waitFor(() => expect(allocCalls()).toBe(2))

    fireEvent.click(screen.getByText('전체'))   // 마운트 시 이미 캐시된 스코프로 복귀
    await screen.findByText('TCK1')
    expect(allocCalls()).toBe(2)   // 새 요청 없음 — 캐시 히트
  })

  it('캡션이 스코프별 코호트 라벨·수치를 응답 그대로 반영한다', async () => {
    mockApi()
    const { container } = render(<GuruAllocation />)
    await screen.findByText('TCK1')
    let caption = container.querySelector('.guru-alloc-caption').textContent
    expect(caption).toContain('구루 전체')
    expect(caption).toContain(`${ALL_PAYLOAD.manager_count}명`)
    expect(caption).toContain(`${ALL_PAYLOAD.ticker_count}종목`)

    fireEvent.click(screen.getByText('10명'))
    await waitFor(() => {
      caption = container.querySelector('.guru-alloc-caption').textContent
      expect(caption).toContain('포트폴리오 규모 상위')
    })
    expect(caption).toContain(`${TOP10_PAYLOAD.manager_count}명`)
    expect(caption).toContain(`${TOP10_PAYLOAD.ticker_count}종목`)
  })

  it('코호트 밖 티커 검색은 안내와 [전체에서 검색] 버튼을 보이고, 클릭하면 스코프만 전체로 바뀌며 검색어를 유지한다', async () => {
    mockApi()
    const { container } = render(<GuruAllocation />)
    await screen.findByText('TCK1')

    fireEvent.click(screen.getByText('10명'))
    await waitFor(() => expect(rowCount(container)).toBe(TOP10_ROWS.length))
    expect(screen.queryByText('TCK55')).toBeNull()   // TOP10 코호트엔 없음

    fireEvent.change(container.querySelector('input'), { target: { value: 'TCK55' } })
    expect(await screen.findByText('선택한 코호트에 없습니다')).toBeTruthy()

    fireEvent.click(screen.getByText('전체에서 검색'))
    expect(await screen.findByText('TCK55')).toBeTruthy()
    expect(container.querySelector('input').value).toBe('TCK55')   // 검색어 유지
    expect(rowCount(container)).toBe(1)
    expect(screen.getByText('전체')).toHaveClass('is-active')
  })

  it('스코프=전체에서 검색 결과가 0이면 안내 대신 기존 0개만 보인다', async () => {
    mockApi()
    const { container } = render(<GuruAllocation />)
    await screen.findByText('TCK1')
    fireEvent.change(container.querySelector('input'), { target: { value: '존재하지않는티커' } })
    expect(await screen.findByText('0개')).toBeTruthy()
    expect(screen.queryByText('선택한 코호트에 없습니다')).toBeNull()
  })
})

// ── G5 (task#244): 실패를 빈 상태로 위장하지 않는다 ────────────────────────────
// `.then().finally()`는 rejection을 잡지 않아 loading=false·data=null이 되고,
// 그 결과 "크롤링을 먼저 실행하세요"라는 *잘못된 행동 지시*가 떴다.
describe('구루 자산 배분 — 에러 정직성 (task#244)', () => {
  it('fetch 실패는 에러로 보이고 빈 상태 문구는 뜨지 않는다', async () => {
    api.get.mockImplementation((url) => {
      if (url === '/api/guru/stats/allocation') return Promise.reject(new Error('boom'))
      return Promise.resolve({ data: [] })
    })
    render(<GuruAllocation />)
    expect(await screen.findByText(/불러오지 못했습니다/)).toBeTruthy()
    expect(screen.queryByText(/크롤링을 먼저 실행/)).toBeNull()
  })

  it('정상 응답에는 에러 문구가 없다', async () => {
    mockApi()
    render(<GuruAllocation />)
    await screen.findByText('TCK1')
    expect(screen.queryByText(/불러오지 못했습니다/)).toBeNull()
  })

  it('관심 토글 실패는 토스트로 알린다', async () => {
    mockApi()
    api.post.mockRejectedValue(new Error('nope'))
    const { container } = render(<GuruAllocation />)
    await screen.findByText('TCK1')
    fireEvent.click(container.querySelector('.guru-stat-row button'))
    await vi.waitFor(() => expect(showToastSpy).toHaveBeenCalledWith(expect.any(String), 'error'))
  })
})

// ── task#247 적대적 리뷰 발견 수정 — 스코프 전환 fetch의 경합·실패 처리 ──────────────
describe('구루 자산 배분 — 스코프 전환 fetch의 경합·실패 (task#247 리뷰)', () => {
  it('스코프를 빠르게 연속 클릭하면 늦게 도착한 이전 요청 응답이 최신 선택을 덮지 않는다', async () => {
    let resolve10, resolve50
    const p10 = new Promise(r => { resolve10 = r })
    const p50 = new Promise(r => { resolve50 = r })
    api.get.mockImplementation((url) => {
      if (url === '/api/guru/stats/allocation') return Promise.resolve({ data: ALL_PAYLOAD })
      if (url === '/api/guru/stats/allocation?top=10') return p10
      if (url === '/api/guru/stats/allocation?top=50') return p50
      if (url === '/api/guru/managers') return Promise.resolve({ data: { last_updated: null, managers: [] } })
      return Promise.resolve({ data: [] })
    })
    const { container } = render(<GuruAllocation />)
    await screen.findByText('TCK1')

    fireEvent.click(screen.getByText('10명'))   // top=10 요청 발사(아직 미해결)
    fireEvent.click(screen.getByText('50명'))   // top=50 요청 발사(아직 미해결) — 10 effect는 cleanup으로 ignore 처리돼야 함

    resolve50({ data: TOP50_PAYLOAD })   // 나중에 보낸 50이 먼저 도착
    await waitFor(() => expect(rowCount(container)).toBe(TOP50_ROWS.length))
    expect(screen.getByText('50명')).toHaveClass('is-active')

    resolve10({ data: TOP10_PAYLOAD })   // 먼저 보낸 10이 늦게 도착 — 화면을 되돌리면 안 된다
    await new Promise(r => setTimeout(r, 0))

    expect(rowCount(container)).toBe(TOP50_ROWS.length)
    expect(screen.getByText('50명')).toHaveClass('is-active')
  })

  it('스코프 전환 fetch가 실패해도 이미 표시 중인 데이터·필을 지우지 않고 토스트로만 알린다', async () => {
    api.get.mockImplementation((url) => {
      if (url === '/api/guru/stats/allocation') return Promise.resolve({ data: ALL_PAYLOAD })
      if (url === '/api/guru/stats/allocation?top=10') return Promise.reject(new Error('boom'))
      if (url === '/api/guru/managers') return Promise.resolve({ data: { last_updated: null, managers: [] } })
      return Promise.resolve({ data: [] })
    })
    const { container } = render(<GuruAllocation />)
    await screen.findByText('TCK1')

    fireEvent.click(screen.getByText('10명'))
    await vi.waitFor(() => expect(showToastSpy).toHaveBeenCalledWith(expect.any(String), 'error'))

    // 전면 에러 화면으로 갈아치우지 않고 기존 필·데이터를 유지한다
    expect(container.querySelector('.guru-alloc-scopes')).toBeTruthy()
    expect(rowCount(container)).toBe(ALL_ROWS.length)
    expect(screen.queryByText(/불러오지 못했습니다/)).toBeNull()
    // 실패한 스코프 선택은 마지막 성공 스코프로 되돌린다
    await waitFor(() => expect(screen.getByText('전체')).toHaveClass('is-active'))
  })
})

// ── task#247 S3: 「데이터 기준」 펼침 설명란 — 기본 접힘, 응답값 그대로 문장화 ──────
// 패널 안 문구는 캡션(.guru-alloc-caption)과 어휘가 겹칠 수 있어(둘 다 "비율" 언급 등)
// screen.getByText 전역 검색은 다중매치로 깨진다 — .guru-alloc-info-panel로 스코프 좁혀 조회.
describe('구루 자산 배분 — 데이터 기준 설명란 (task#247 S3)', () => {
  it('기본 접힘 — 내용이 노출되지 않는다', async () => {
    mockApi()
    const { container } = render(<GuruAllocation />)
    await screen.findByText('TCK1')
    expect(screen.getByText('데이터 기준')).toBeTruthy()
    expect(container.querySelector('.guru-alloc-info-panel')).toBeNull()
  })

  it('펼치면 8항목 라벨이 전부 보인다', async () => {
    mockApi()
    const { container } = render(<GuruAllocation />)
    await screen.findByText('TCK1')
    fireEvent.click(screen.getByText('데이터 기준'))
    const panel = within(container.querySelector('.guru-alloc-info-panel'))
    for (const label of ['탑N', '비율', '보유 구루 수', '신고 분기', '갱신', '13F 성질', '투자금', '집계 단위']) {
      expect(panel.getByText(new RegExp(label))).toBeTruthy()
    }
  })

  it('동적 수치는 응답 값을 그대로 반영한다 — 하드코딩이면 값을 바꿔도 문구가 안 바뀐다', async () => {
    // all_manager_count·total_value·periods·last_updated·estimated_count를 실제값과
    // 다르게 눌러, 하드코딩 문구였다면 드러나지 않을 값들로 커스터마이즈한다.
    const custom = {
      ...ALL_PAYLOAD,
      all_manager_count: 99,
      manager_count: 99,
      total_value: 500_000_000_000,
      all_total_value: 500_000_000_000,
      periods: { 'Q4 2025': 99 },
      estimated_count: 7,
      last_updated: '2026-01-02T03:04:00',
    }
    mockApi(custom)
    const { container } = render(<GuruAllocation />)
    await screen.findByText('TCK1')
    fireEvent.click(screen.getByText('데이터 기준'))
    const panel = within(container.querySelector('.guru-alloc-info-panel'))
    expect(panel.getByText(/전체 99명 중 99명이지만 구루 자산의 100\.0%를 덮는다/)).toBeTruthy()
    expect(panel.getByText(/분모는 코호트 총액 \$500\.0B/)).toBeTruthy()
    expect(panel.getByText(/Q4 2025 99명/)).toBeTruthy()
    expect(panel.getByText(/마지막 2026-01-02 03:04/)).toBeTruthy()
    expect(panel.getByText(/추정 7행/)).toBeTruthy()
  })

  it('스코프 전환 시 설명란 수치도 함께 갱신된다', async () => {
    mockApi()
    const { container } = render(<GuruAllocation />)
    await screen.findByText('TCK1')
    fireEvent.click(screen.getByText('데이터 기준'))
    expect(within(container.querySelector('.guru-alloc-info-panel'))
      .getByText(/전체 83명 중 83명이지만 구루 자산의 100\.0%를 덮는다/)).toBeTruthy()

    fireEvent.click(screen.getByText('10명'))
    await waitFor(() => {
      expect(within(container.querySelector('.guru-alloc-info-panel'))
        .getByText(/전체 83명 중 10명이지만 구루 자산의 71\.1%를 덮는다/)).toBeTruthy()
    })
    expect(within(container.querySelector('.guru-alloc-info-panel')).getByText(/Q1 2026 10명/)).toBeTruthy()
  })

  it('estimated_count=0이면 추정 문장이 없다', async () => {
    mockApi()   // ALL_PAYLOAD.estimated_count === 0
    const { container } = render(<GuruAllocation />)
    await screen.findByText('TCK1')
    fireEvent.click(screen.getByText('데이터 기준'))
    expect(within(container.querySelector('.guru-alloc-info-panel')).queryByText(/추정/)).toBeNull()
  })

  it('estimated_count>0이면 추정 문장이 보인다', async () => {
    mockApi({ ...ALL_PAYLOAD, estimated_count: 3 })
    const { container } = render(<GuruAllocation />)
    await screen.findByText('TCK1')
    fireEvent.click(screen.getByText('데이터 기준'))
    expect(within(container.querySelector('.guru-alloc-info-panel')).getByText(/추정 3행/)).toBeTruthy()
  })

  it('접기를 누르면 다시 숨긴다', async () => {
    mockApi()
    const { container } = render(<GuruAllocation />)
    await screen.findByText('TCK1')
    fireEvent.click(screen.getByText('데이터 기준'))
    expect(container.querySelector('.guru-alloc-info-panel')).toBeTruthy()

    fireEvent.click(screen.getByText('접기'))
    expect(container.querySelector('.guru-alloc-info-panel')).toBeNull()
    expect(screen.getByText('데이터 기준')).toBeTruthy()
  })
})

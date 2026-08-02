import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

const navigateMock = vi.fn()
vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal()
  return { ...actual, useNavigate: () => navigateMock }
})

vi.mock('../api', () => ({ default: { get: vi.fn(), post: vi.fn(), delete: vi.fn() } }))
// useToast()는 useContext라 provider 없이 렌더하면 null이다 — 훅이 토스트를 쓰므로 목킹 필수.
vi.mock('../components/Toast', () => ({ useToast: () => ({ showToast: vi.fn() }) }))
vi.mock('../hooks/useIsMobile', () => ({ default: () => false }))

import api from '../api'
import GuruManagers from './GuruManagers'

const MANAGERS = {
  last_updated: '2026-07-01T00:00:00',
  managers: [
    {
      id: 'brk', name: 'Warren Buffett', firm: 'Berkshire Hathaway',
      portfolio_value: 350000000000, num_stocks: 45,
      top10: [{ rank: 1, ticker: 'AAPL', name: 'Apple', name_kr: '', weight_pct: 40 }],
    },
  ],
}

function mockApi({ stocks = [] } = {}) {
  api.get.mockImplementation((url) =>
    url === '/api/guru/managers' ? Promise.resolve({ data: MANAGERS }) : Promise.resolve({ data: stocks })
  )
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('GuruManagers 카드 클릭 (task#226 S5)', () => {
  it('카드 본문 클릭 시 /guru/:id 로 navigate', async () => {
    mockApi()
    render(<GuruManagers />)
    const name = await screen.findByText('Warren Buffett')
    fireEvent.click(name)
    expect(navigateMock).toHaveBeenCalledWith('/guru/brk')
  })

  it('배지 클릭 시 navigate 미발생 + watchlist API 호출', async () => {
    mockApi()
    api.post.mockResolvedValue({})
    render(<GuruManagers />)
    const badge = await screen.findByText('AAPL')
    fireEvent.click(badge)
    expect(navigateMock).not.toHaveBeenCalled()
    expect(api.post).toHaveBeenCalledWith('/api/watchlist', { ticker: 'AAPL', name: 'Apple', market: 'US', exchange: '', security_type: 'EQUITY' })
  })
})

describe('GuruManagers 탑3 배지 흡수 (task#227 S1)', () => {
  it('상위 3위 배지에 비중%·보유 구루 수가 title이 아니라 텍스트 노드로 노출', async () => {
    mockApi()
    render(<GuruManagers />)
    await screen.findByText('Warren Buffett')
    const meta = await screen.findByText('40% · 1명')
    expect(meta.tagName).toBe('SPAN')
    expect(meta.getAttribute('title')).toBeNull()
  })
})

describe('GuruManagers 기본 정렬 (task#228 S1)', () => {
  // 종목수 순서(mid 10 < small 50 < big 90)를 규모 순서와 어긋나게 둬서, 구 기본값(종목수 오름차순)이면
  // ['Mid','Small','Big']이 나오도록 만든다 — 기본값이 되돌아가면 이 단언이 깨진다.
  const MANY = {
    last_updated: null,
    managers: [
      { id: 'small', name: 'Small Fund', firm: 'S', portfolio_value: 1_000_000_000,   num_stocks: 50, top10: [] },
      { id: 'big',   name: 'Big Fund',   firm: 'B', portfolio_value: 300_000_000_000, num_stocks: 90, top10: [] },
      { id: 'mid',   name: 'Mid Fund',   firm: 'M', portfolio_value: 50_000_000_000,  num_stocks: 10, top10: [] },
    ],
  }

  it('정렬 칩 클릭 없이 렌더 직후 카드 순서가 포트폴리오 규모 내림차순', async () => {
    api.get.mockImplementation((url) =>
      url === '/api/guru/managers' ? Promise.resolve({ data: MANY }) : Promise.resolve({ data: [] })
    )
    const { container } = render(<GuruManagers />)
    await screen.findByText('Big Fund')
    const names = [...container.querySelectorAll('.guru-name')].map(n => n.textContent)
    expect(names).toEqual(['Big Fund', 'Mid Fund', 'Small Fund'])
  })
})

describe('GuruManagers 칩 초기 정렬 방향 (task#229 S4)', () => {
  // 세 정렬의 기대 순서가 서로 다르도록 구성 — 규모↓: Zeta,Mid,Alpha / 종목수↓: Zeta,Alpha,Mid / 이름 A→Z: Alpha,Mid,Zeta
  const MIXED = {
    last_updated: null,
    managers: [
      { id: 'z', name: 'Zeta Fund',  firm: 'Z', portfolio_value: 300_000_000_000, num_stocks: 90, top10: [] },
      { id: 'a', name: 'Alpha Fund', firm: 'A', portfolio_value: 1_000_000_000,   num_stocks: 50, top10: [] },
      { id: 'm', name: 'Mid Fund',   firm: 'M', portfolio_value: 50_000_000_000,  num_stocks: 10, top10: [] },
    ],
  }
  const order = (container) => [...container.querySelectorAll('.guru-name')].map(n => n.textContent)

  const renderMixed = async () => {
    api.get.mockImplementation((url) =>
      url === '/api/guru/managers' ? Promise.resolve({ data: MIXED }) : Promise.resolve({ data: [] })
    )
    const r = render(<GuruManagers />)
    await screen.findByText('Zeta Fund')
    return r
  }

  // '종목수'는 카드 통계 라벨에도 있으므로 칩(button)으로 좁혀 조회한다
  it('종목수 칩 첫 클릭 = 내림차순(많은 것부터) + 화살표 ↓', async () => {
    const { container } = await renderMixed()
    fireEvent.click(screen.getByRole('button', { name: '종목수' }))
    expect(order(container)).toEqual(['Zeta Fund', 'Alpha Fund', 'Mid Fund'])
    expect(screen.getByRole('button', { name: '종목수 ↓' })).toBeTruthy()
  })

  it('이름순 칩 첫 클릭 = A→Z + 화살표 ↑', async () => {
    const { container } = await renderMixed()
    fireEvent.click(screen.getByRole('button', { name: '이름순' }))
    expect(order(container)).toEqual(['Alpha Fund', 'Mid Fund', 'Zeta Fund'])
    expect(screen.getByRole('button', { name: '이름순 ↑' })).toBeTruthy()
  })

  it('기본 정렬(규모 내림차순)은 task#228 그대로 유지', async () => {
    const { container } = await renderMixed()
    expect(order(container)).toEqual(['Zeta Fund', 'Mid Fund', 'Alpha Fund'])
  })

  // 라이브에서 'AKO Capital'이 'Abrams Bison Investments' 앞에 오던 회귀 — 코드유닛 비교는
  // 대문자(0x4B 'K')를 소문자(0x62 'b')보다 앞세운다. 로케일 비교로만 잡힌다.
  it('이름순은 대소문자 혼재에도 사람이 읽는 알파벳 순서', async () => {
    api.get.mockImplementation((url) =>
      url === '/api/guru/managers'
        ? Promise.resolve({ data: { last_updated: null, managers: [
            { id: '1', name: 'AKO Capital',              firm: 'x', portfolio_value: 3, num_stocks: 1, top10: [] },
            { id: '2', name: 'Abrams Bison Investments', firm: 'x', portfolio_value: 2, num_stocks: 1, top10: [] },
            { id: '3', name: 'AltaRock Partners',        firm: 'x', portfolio_value: 1, num_stocks: 1, top10: [] },
          ] } })
        : Promise.resolve({ data: [] })
    )
    const { container } = render(<GuruManagers />)
    await screen.findByText('AKO Capital')
    fireEvent.click(screen.getByRole('button', { name: '이름순' }))
    expect(order(container)).toEqual(['Abrams Bison Investments', 'AKO Capital', 'AltaRock Partners'])
  })
})

describe('GuruManagers 운용역·펀드 표기 (task#236 S2)', () => {
  // 라이브 83명의 실제 형태 3종. `firm`은 71명이 name과 같고 12명은 소개글 전문이 붙어 온다.
  const BLURB = 'Investment Objective: The Fund seeks long-term capital appreciation by investing...'
  function renderShapes() {
    api.get.mockImplementation((url) =>
      url === '/api/guru/managers'
        ? Promise.resolve({ data: { last_updated: null, managers: [
            // ① 운용역 + 펀드
            { id: 'p', name: 'Alex Roepers - Atlantic Investment Management', firm: 'Alex Roepers - Atlantic Investment Management', portfolio_value: 3, num_stocks: 1, top10: [] },
            // ② 펀드만(26명형) — 기존엔 제목·부제가 완전히 같은 문자열 2줄
            { id: 'f', name: 'AKO Capital', firm: 'AKO Capital', portfolio_value: 2, num_stocks: 1, top10: [] },
            // ③ 소개글 혼입(12명형)
            { id: 'b', name: 'Bruce Berkowitz - Fairholme Capital', firm: `Bruce Berkowitz - Fairholme Capital ${BLURB}`, portfolio_value: 1, num_stocks: 1, top10: [] },
          ] } })
        : Promise.resolve({ data: [] })
    )
    return render(<GuruManagers />)
  }

  it('운용역이 있으면 제목=운용역·부제=펀드', async () => {
    const { container } = renderShapes()
    await screen.findByText('Alex Roepers')
    const card = container.querySelectorAll('.guru-card')[0]
    expect(card.querySelector('.guru-name').textContent.trim()).toBe('Alex Roepers')
    expect(card.querySelector('.guru-fund').textContent.trim()).toBe('Atlantic Investment Management')
  })

  it('펀드만인 매니저는 부제 노드 자체가 없다 — 같은 문자열 2줄 반복 소멸', async () => {
    const { container } = renderShapes()
    await screen.findByText('AKO Capital')
    const card = [...container.querySelectorAll('.guru-card')]
      .find(c => c.querySelector('.guru-name').textContent.trim() === 'AKO Capital')
    expect(card.querySelector('.guru-fund')).toBeNull()
  })

  it('어떤 카드에도 소개글 본문이 표시되지 않는다', async () => {
    const { container } = renderShapes()
    await screen.findByText('Bruce Berkowitz')
    expect(container.textContent).not.toContain('Investment Objective')
  })

  it('소개글 본문으로는 검색되지 않는다 — firm 조건 제거', async () => {
    renderShapes()
    await screen.findByText('Bruce Berkowitz')
    fireEvent.change(screen.getByPlaceholderText(/티커 검색/), { target: { value: 'Investment Objective' } })
    expect(screen.queryByText('Bruce Berkowitz')).toBeNull()
  })

  it('펀드명 검색은 계속 동작한다 — name에 펀드가 들어있다', async () => {
    renderShapes()
    await screen.findByText('Alex Roepers')
    fireEvent.change(screen.getByPlaceholderText(/티커 검색/), { target: { value: 'atlantic' } })
    expect(screen.getByText('Alex Roepers')).toBeTruthy()
    expect(screen.queryByText('AKO Capital')).toBeNull()
  })
})

describe('GuruManagers 빈 상태 안내 문구 (task#227 S5)', () => {
  it('실제 경로("설정 > 구루")를 안내하고 존재하지 않는 "크롤링 설정" 탭을 언급하지 않음', async () => {
    mockApi({ stocks: [] })
    api.get.mockImplementation((url) =>
      url === '/api/guru/managers' ? Promise.resolve({ data: { last_updated: null, managers: [] } }) : Promise.resolve({ data: [] })
    )
    render(<GuruManagers />)
    const empty = await screen.findByText(/데이터 없음/)
    expect(empty.textContent).not.toMatch(/크롤링 설정/)
    expect(empty.textContent).toMatch(/설정.*구루/)
  })
})

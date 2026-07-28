import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import GuruDetail, { fitsSliceLabel } from './GuruDetail'
import api from '../api'

vi.mock('../api', () => ({ default: { get: vi.fn(), post: vi.fn(), delete: vi.fn() } }))
// 모바일 분기 테스트를 위해 토글 가능한 mock (PermissionPanel.test.jsx의 vi.hoisted 관용구). 기본은 PC.
const { viewport } = vi.hoisted(() => ({ viewport: { mobile: false } }))
vi.mock('../hooks/useIsMobile', () => ({ default: () => viewport.mobile }))

function renderPage(id = 'brk') {
  return render(
    <MemoryRouter initialEntries={[`/guru/${id}`]}>
      <Routes>
        <Route path="/guru/:id" element={<GuruDetail />} />
      </Routes>
    </MemoryRouter>
  )
}

const TOP10 = Array.from({ length: 10 }, (_, i) => ({
  rank: i + 1, ticker: `T${i + 1}`, name: `Name ${i + 1}`, name_kr: '', weight_pct: 10 - i * 0.5,
}))

const MANAGER_NO_HOLDINGS = {
  id: 'brk', name: 'Warren Buffett', firm: 'Berkshire Hathaway',
  portfolio_value: 350000000000, num_stocks: 45, top10: TOP10,
}

const MANAGER_WITH_HOLDINGS = {
  ...MANAGER_NO_HOLDINGS,
  holdings: [
    ...TOP10,
    ...Array.from({ length: 35 }, (_, i) => ({ rank: 11 + i, ticker: `H${11 + i}`, name: `Holding ${11 + i}`, weight_pct: 1 })),
  ],
}

function mockManager(data) {
  api.get.mockImplementation((url) =>
    url === '/api/guru/managers/brk' ? Promise.resolve({ data }) : Promise.resolve({ data: [] })
  )
}

beforeEach(() => { vi.clearAllMocks(); viewport.mobile = false })

describe('GuruDetail (task#226 S4)', () => {
  // 목록 하단 폴백 전용 캡션("기타 N종목 · x%")을 exact textContent 매처로 고정한다.
  // (범례표가 있던 시절엔 그 표의 "기타 N종목" 행과 텍스트가 겹쳐서 exact 매처가 필수였고,
  //  task#235에서 범례표를 없앤 뒤로는 충돌이 사라졌지만 캡션을 정확히 겨냥하는 값은 그대로다)
  const fallbackCaption = (content) => content === '기타 35종목 · 22.5%'

  it('holdings 없는 응답 — top10 행 렌더 + 기타 캡션(폴백)', async () => {
    mockManager(MANAGER_NO_HOLDINGS)
    renderPage()
    expect(await screen.findByText('Warren Buffett')).toBeTruthy()
    expect(screen.getAllByText('T1').length).toBeGreaterThan(0)
    expect(screen.getAllByText('T10').length).toBeGreaterThan(0)
    expect(screen.getAllByTestId('holding-row').length).toBe(10)
    expect(screen.getByText(fallbackCaption)).toBeTruthy()
  })

  it('holdings 있는 응답 — 기본 20행, 펼치기 후 전량 렌더', async () => {
    mockManager(MANAGER_WITH_HOLDINGS)
    renderPage()
    await screen.findByText('Warren Buffett')
    expect(screen.getAllByTestId('holding-row').length).toBe(20)
    expect(screen.queryByText(fallbackCaption)).toBeNull()  // holdings 있으면 폴백 캡션 미노출
    fireEvent.click(screen.getByText('전체 45종목 보기'))
    expect(screen.getAllByTestId('holding-row').length).toBe(45)
  })

  it('404 응답 — 빈 상태 렌더', async () => {
    api.get.mockImplementation((url) =>
      url === '/api/guru/managers/brk'
        ? Promise.reject({ response: { status: 404 } })
        : Promise.resolve({ data: [] })
    )
    renderPage()
    expect(await screen.findByText('매니저를 찾을 수 없습니다.')).toBeTruthy()
  })
})

describe('GuruDetail 모바일 appbar 제목 축약 (task#229 S2)', () => {
  // appbar 제목이 2줄로 접히면 스크롤 시 헤더 아래 잔여가 남는다 — 접힘의 원인이던 firm 중복을 제거.
  // (2줄→1줄 여부 자체는 jsdom이 레이아웃을 계산하지 않아 단언 불가 → 라이브 실측이 게이트)
  // 라이브 데이터의 실제 형태 — 이름 자체에 firm이 " - "로 붙어 있어 2줄로 접혔다
  const DASHED = { ...MANAGER_NO_HOLDINGS, name: 'Warren Buffett - Berkshire Hathaway' }

  it('appbar h1은 " - " 앞부분만 쓰고 firm 줄은 그대로 남는다', async () => {
    viewport.mobile = true
    mockManager(DASHED)
    const { container } = renderPage()
    await screen.findByText('Berkshire Hathaway')          // firm 문단은 유지
    const h1 = container.querySelector('.appbar h1')
    expect(h1.textContent).toBe('Warren Buffett')
    expect(h1.textContent).not.toContain(' - ')
  })
})

describe('GuruDetail 운용역·펀드 표기 (task#236 S2)', () => {
  const BLURB = 'Investment Objective: The Fund seeks long-term capital appreciation...'
  const PERSON_FUND = { ...MANAGER_NO_HOLDINGS, name: 'Alex Roepers - Atlantic Investment Management', firm: 'Alex Roepers - Atlantic Investment Management' }
  const FUND_ONLY  = { ...MANAGER_NO_HOLDINGS, name: 'AKO Capital', firm: 'AKO Capital' }
  const BLURBED    = { ...MANAGER_NO_HOLDINGS, name: 'Bruce Berkowitz - Fairholme Capital', firm: `Bruce Berkowitz - Fairholme Capital ${BLURB}` }

  it('PC 제목은 전체 이름이 아니라 운용역 — 부제의 펀드명이 제목 안에서 반복되지 않는다', async () => {
    mockManager(PERSON_FUND)
    const { container } = renderPage()
    await screen.findByText('Alex Roepers')
    const h1 = container.querySelector('.page-title')
    expect(h1.textContent).toBe('Alex Roepers')
    expect(h1.textContent).not.toContain(' - ')
    expect(screen.getByText('Atlantic Investment Management')).toBeTruthy()
  })

  it('펀드만인 매니저는 부제 문단이 없다 (PC)', async () => {
    mockManager(FUND_ONLY)
    const { container } = renderPage()
    await screen.findByText('AKO Capital')
    expect(container.querySelector('.page-title').textContent).toBe('AKO Capital')
    expect(container.querySelector('.page-head p.muted')).toBeNull()
    expect(screen.getAllByText('AKO Capital').length).toBe(1)
  })

  it('펀드만인 매니저는 부제 문단이 없다 (모바일)', async () => {
    viewport.mobile = true
    mockManager(FUND_ONLY)
    const { container } = renderPage()
    await screen.findByText('AKO Capital')
    expect(container.querySelector('.appbar h1').textContent).toBe('AKO Capital')
    // p.muted 셀렉터로는 못 좁힌다 — `{body}`가 프래그먼트라 "기타 N종목" 캡션도 .m-page 직계 자식이다.
    // 완료기준 자체(제목과 같은 문자열이 2줄로 반복되지 않음)를 단언한다.
    expect(screen.getAllByText('AKO Capital').length).toBe(1)
  })

  it('소개글 본문은 어느 뷰포트에도 표시되지 않는다', async () => {
    mockManager(BLURBED)
    const { container } = renderPage()
    await screen.findByText('Bruce Berkowitz')
    expect(container.textContent).not.toContain('Investment Objective')
  })
})

describe('fitsSliceLabel — 조각 위 라벨 기하 판정 (task#235 S2)', () => {
  // 현 도넛 기하(컨테이너 350~360px → inner 86 / outer 134). 고정 임계값이 아니라 호 길이 판정이므로
  // 도넛 크기가 바뀌어도 규칙이 따라온다 — 그 규칙 자체를 못박는다.
  const G = { innerRadius: 86, outerRadius: 134 }

  it('작은 조각은 라벨을 담지 못한다', () => {
    expect(fitsSliceLabel({ ...G, percent: 0.03, ticker: 'AAPL' })).toBe(false)
  })

  it('큰 조각은 라벨을 담는다', () => {
    expect(fitsSliceLabel({ ...G, percent: 0.22, ticker: 'AAPL' })).toBe(true)
  })

  it('같은 조각이라도 긴 이름은 더 큰 조각을 요구한다', () => {
    expect(fitsSliceLabel({ ...G, percent: 0.07, ticker: 'KO' })).toBe(true)
    expect(fitsSliceLabel({ ...G, percent: 0.07, ticker: '기타 35종목' })).toBe(false)
  })

  it('한글은 전각이라 라틴 기준으로 재면 안 된다 — 같은 글자수라도 더 넓다', () => {
    // 라틴 6자는 들어가지만 한글 6자는 밴드를 뚫는다(라이브에서 '기타 19종목' 라벨이 minR 80·maxR 135로
    // 밴드 84~130을 양쪽 다 넘긴 실측 사례 — 폭 추정이 6.2px/자였던 탓)
    expect(fitsSliceLabel({ ...G, percent: 0.3, ticker: 'ABCDEF' })).toBe(true)
    expect(fitsSliceLabel({ ...G, percent: 0.3, ticker: '가나다라마바' })).toBe(false)
  })

  it('조각이 아무리 커도 가로로 긴 라벨은 밴드를 뚫으므로 그리지 않는다', () => {
    // 호 길이(접선)만 보면 통과하지만 라벨 박스 모서리가 밴드 밖으로 나간다
    expect(fitsSliceLabel({ ...G, percent: 1, ticker: '기타 146종목' })).toBe(false)
    expect(fitsSliceLabel({ ...G, percent: 1, ticker: '기타' })).toBe(true)
  })

  it('밴드가 얇으면(2줄 불가) 조각이 커도 그리지 않는다', () => {
    expect(fitsSliceLabel({ innerRadius: 100, outerRadius: 120, percent: 0.5, ticker: 'KO' })).toBe(false)
  })
})

describe('GuruDetail 도넛 인라인 범례 + KPI 2장 (task#235 S2·S3)', () => {
  // 조각 라벨·조각 자체는 recharts라 jsdom에서 렌더되지 않는다(겹침·위치는 라이브 프로브가 게이트).
  // 여기서 관측 가능한 것은 범례표 부재·HTML 중앙 오버레이·KPI 개수뿐이다.
  it('별도 범례표가 없다', async () => {
    mockManager(MANAGER_NO_HOLDINGS)
    const { container } = renderPage()
    await screen.findByText('Warren Buffett')
    expect(container.querySelector('table')).toBeNull()
  })

  it('중앙 요약이 상위 종목 개수와 합계 비중을 표시한다', async () => {
    mockManager(MANAGER_NO_HOLDINGS)
    renderPage()
    await screen.findByText('Warren Buffett')
    expect(screen.getByText('상위 10종목')).toBeTruthy()
    expect(screen.getByText('77.5%')).toBeTruthy()   // TOP10 fixture 합계
  })

  it('KPI는 2장 — 「상위 N종목 비중」 카드는 중앙으로 이관돼 사라졌다', async () => {
    mockManager(MANAGER_NO_HOLDINGS)
    const { container } = renderPage()
    await screen.findByText('Warren Buffett')
    expect(container.querySelectorAll('.kpi').length).toBe(2)
    expect(screen.queryByText('상위 10종목 비중')).toBeNull()
  })

  it('top10이 비면(기타 100%) 중앙 요약을 생략한다', async () => {
    mockManager({ ...MANAGER_NO_HOLDINGS, top10: [] })
    renderPage()
    await screen.findByText('Warren Buffett')
    expect(screen.queryByText(/^상위 \d+종목$/)).toBeNull()
  })
})

describe('GuruDetail 좌하단 목록복귀 pill (task#228 S2)', () => {
  // fixed 좌표는 jsdom이 블라인드 — 여기선 렌더·링크 대상만 단언하고 위치는 라이브 실측으로 검증한다.
  it('.list-pill--left 가 렌더되고 /guru 로 링크', async () => {
    mockManager(MANAGER_NO_HOLDINGS)
    const { container } = renderPage()
    await screen.findByText('Warren Buffett')
    const pill = container.querySelector('.list-pill--left')
    expect(pill).toBeTruthy()
    expect(pill.getAttribute('href')).toBe('/guru')
    expect(pill.classList.contains('list-pill')).toBe(true)
  })
})

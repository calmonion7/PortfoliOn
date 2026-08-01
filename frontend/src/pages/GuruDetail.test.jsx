import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import GuruDetail, { fitsSliceLabel, shortDate, activityText, ppText } from './GuruDetail'
import GuruActivityBadge from '../components/ui/GuruActivityBadge'
import api from '../api'

vi.mock('../api', () => ({ default: { get: vi.fn(), post: vi.fn(), delete: vi.fn() } }))
// useToast()는 useContext라 provider 없이 렌더하면 null이다 — 훅이 토스트를 쓰므로 목킹 필수.
vi.mock('../components/Toast', () => ({ useToast: () => ({ showToast: vi.fn() }) }))
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

describe('fitsSliceLabel — 실측 폭 주입 (task#237 S3)', () => {
  const G = { innerRadius: 86, outerRadius: 134 }

  it('주입된 실측 폭이 문자별 추정을 대체한다 — 크게 주면 안 들어간다', () => {
    // 추정으로는 통과하는 조각(라틴 2자)이라도 실측이 넓게 나오면 라벨을 그리지 않는다
    expect(fitsSliceLabel({ ...G, percent: 0.07, ticker: 'KO' })).toBe(true)
    expect(fitsSliceLabel({ ...G, percent: 0.07, ticker: 'KO', labelWidth: 120 })).toBe(false)
  })

  it('작게 주면 추정으로 막혔던 라벨이 들어간다', () => {
    expect(fitsSliceLabel({ ...G, percent: 0.07, ticker: '기타 35종목' })).toBe(false)
    expect(fitsSliceLabel({ ...G, percent: 0.07, ticker: '기타 35종목', labelWidth: 20 })).toBe(true)
  })

  it('주입이 없으면 기존 추정 경로 — labelWidth undefined는 추정과 동일', () => {
    const est = fitsSliceLabel({ ...G, percent: 0.3, ticker: '가나다라마바' })
    expect(fitsSliceLabel({ ...G, percent: 0.3, ticker: '가나다라마바', labelWidth: undefined })).toBe(est)
    expect(est).toBe(false)
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

describe('GuruDetail 목록 색 점 = 도넛 범례 (task#237 S2)', () => {
  // 색 점이 도넛 조각 색과 실제로 같은지는 라이브 프로브가 대조한다(jsdom은 recharts를 렌더하지 않는다).
  // 여기서 관측 가능한 것은 "어느 행에 점이 붙는가"뿐 — 상위 10행만.
  it('상위 10행에만 색 점이 붙고 11위 이하는 색이 없다', async () => {
    mockManager(MANAGER_WITH_HOLDINGS)   // 45종목 → 기본 20행 표시
    const { container } = renderPage()
    await screen.findByText('Warren Buffett')
    expect(container.querySelectorAll('[data-testid="holding-row"]').length).toBe(20)
    expect(container.querySelectorAll('.guru-dot[data-donut]').length).toBe(10)
    // 노드 자체는 전 행에 남긴다 — 좌측 정렬이 어긋나지 않게
    expect(container.querySelectorAll('.guru-dot').length).toBe(20)
  })

  it('색 점 인덱스는 0..9 — 도넛 조각 인덱스와 1:1', async () => {
    mockManager(MANAGER_WITH_HOLDINGS)
    const { container } = renderPage()
    await screen.findByText('Warren Buffett')
    const idx = [...container.querySelectorAll('.guru-dot[data-donut]')].map(e => e.getAttribute('data-donut'))
    expect(idx).toEqual(['0', '1', '2', '3', '4', '5', '6', '7', '8', '9'])
  })

  it('holdings 없는 폴백(top10 10행)에서도 전 행에 색 점', async () => {
    mockManager(MANAGER_NO_HOLDINGS)
    const { container } = renderPage()
    await screen.findByText('Warren Buffett')
    expect(container.querySelectorAll('.guru-dot[data-donut]').length).toBe(10)
  })
})

describe('GuruDetail PC 2열 배치 (task#237 S1)', () => {
  // 실제 좌우 배치·폭은 CSS 미디어쿼리라 jsdom이 블라인드 — 여기선 wrapper 유무만 단언하고
  // 나란히 놓였는지·잘림은 라이브 프로브가 bbox로 검증한다.
  it('도넛이 있으면 2열 wrapper를 건다', async () => {
    mockManager(MANAGER_NO_HOLDINGS)
    const { container } = renderPage()
    await screen.findByText('Warren Buffett')
    expect(container.querySelector('.guru-detail-split')).toBeTruthy()
  })

  it('도넛이 없는 매니저(num_stocks 0)는 2열을 걸지 않는다 — 좌측 빈 칸 방지', async () => {
    mockManager({ ...MANAGER_NO_HOLDINGS, top10: [], num_stocks: 0 })
    const { container } = renderPage()
    await screen.findByText('Warren Buffett')
    expect(container.querySelector('.guru-detail-split')).toBeNull()
  })
})

describe('GuruDetail 우하단 목록복귀 pill = 유일한 복귀 경로 (task#238 S2)', () => {
  // fixed 좌표는 jsdom이 블라인드 — 여기선 렌더·링크 대상만 단언하고 위치는 라이브 실측으로 검증한다.
  const expectRightPill = (container) => {
    const pill = container.querySelector('.list-pill')
    expect(pill).toBeTruthy()
    expect(pill.getAttribute('href')).toBe('/guru')
    expect(pill.textContent).toBe('☰ 목록')
    // 좌측 변형은 폐기 — 우하단 기저 클래스만 쓴다(AnalystReport와 동일 레이어)
    expect(pill.classList.contains('list-pill--left')).toBe(false)
  }

  it.each([['PC', false], ['모바일', true]])('%s: 우하단 pill 1개만 렌더되고 상단 이동 링크는 없다', async (_label, mobile) => {
    viewport.mobile = mobile
    mockManager(MANAGER_NO_HOLDINGS)
    const { container } = renderPage()
    await screen.findByText('Warren Buffett')
    expectRightPill(container)
    expect(container.querySelectorAll('.list-pill')).toHaveLength(1)
    // 상단 텍스트 링크는 삭제됨 — /guru 로 가는 링크는 pill 하나뿐
    expect(screen.queryByText(/← 구루 매니저/)).toBeNull()
    const guruLinks = [...container.querySelectorAll('a[href="/guru"]')]
    expect(guruLinks).toHaveLength(1)
    expect(guruLinks[0].classList.contains('list-pill')).toBe(true)
  })

  it('에러 상태에도 pill이 붙는다 — 상단 링크를 지웠으므로 유일한 탈출구', async () => {
    api.get.mockImplementation((url) =>
      url === '/api/guru/managers/brk'
        ? Promise.reject({ response: { status: 404 } })
        : Promise.resolve({ data: [] })
    )
    const { container } = renderPage()
    await screen.findByText('매니저를 찾을 수 없습니다.')
    expectRightPill(container)
    expect(screen.queryByText(/← 구루 매니저/)).toBeNull()
  })
})

// ─────────────────────────────────────────────────────────────────────
// 분기 활동 표시 (task#240)
// ─────────────────────────────────────────────────────────────────────

const MANAGER_WITH_ACTIVITY = {
  ...MANAGER_NO_HOLDINGS,
  period: 'Q1 2026',
  portfolio_date: '2026-03-31',
  num_stocks: 12,
  holdings: [
    { rank: 1, ticker: 'AMZN', name: 'Amazon.com Inc.', weight_pct: 17.4,
      activity: { kind: 'add', share_pct: 19.19, port_pct: 2.8 } },
    { rank: 2, ticker: 'MSFT', name: 'Microsoft Corp.', weight_pct: 15.3,
      activity: { kind: 'buy', share_pct: null, port_pct: 15.26 } },
    { rank: 3, ticker: 'UBER', name: 'Uber Technologies', weight_pct: 11.2,
      activity: { kind: 'reduce', share_pct: 0.82, port_pct: 0.13 } },
    { rank: 4, ticker: 'QSR', name: 'Restaurant Brands', weight_pct: 9.1 },   // 변동없음
    { rank: 5, ticker: 'PART', name: 'Partial Co.', weight_pct: 5.0,
      activity: { kind: 'add', share_pct: 4.5, port_pct: null } },            // 활동 페이지 미보강
  ],
  sold_out: [
    { ticker: 'HLT', name: 'Hilton Worldwide', port_pct: 5.6 },
    { ticker: 'CMG', name: 'Chipotle', port_pct: 3.1 },
  ],
}

describe('GuruActivityBadge — kind 표시 매핑 (task#240 S2)', () => {
  it.each([
    ['buy', '★ 신규', 'buy'],
    ['add', '▲ 추가', 'buy'],
    ['reduce', '▼ 축소', 'sell'],
    ['sold_out', '✕ 매도', 'sell'],
  ])('%s → %s (전용 %s 토큰)', (kind, label, side) => {
    const { container } = render(<GuruActivityBadge kind={kind} />)
    const el = container.querySelector('[data-activity]')
    expect(el.textContent.replace(/\s+/g, ' ').trim()).toBe(label)
    // 매매 방향엔 전용 색 토큰을 쓴다 — KR 가격 토큰(up/down)은 의미가 충돌해 금지(CLAUDE.md 규약)
    expect(el.getAttribute('style')).toContain(`var(--semantic-${side})`)
    expect(el.getAttribute('style')).not.toMatch(/var\(--(up|down)\)/)
  })

  it('미지의 kind·부재는 아무것도 렌더하지 않는다', () => {
    expect(render(<GuruActivityBadge kind="weird" />).container.firstChild).toBeNull()
    expect(render(<GuruActivityBadge />).container.firstChild).toBeNull()
  })
})

describe('activityText / shortDate (task#240 S3·S4)', () => {
  it('주식수 증감률과 비중 임팩트를 부호와 함께 잇는다', () => {
    expect(activityText({ kind: 'add', share_pct: 19.19, port_pct: 2.8 })).toBe('19.2% · +2.80%p')
    expect(activityText({ kind: 'reduce', share_pct: 0.82, port_pct: 0.13 })).toBe('0.8% · -0.13%p')
    // 축소·매도는 감소이므로 무부호 port_pct에 음수 부호를 붙인다
    expect(activityText({ kind: 'sold_out', share_pct: 100, port_pct: 5.6 })).toBe('100.0% · -5.60%p')
  })

  it('반올림해서 0이 되는 미미한 거래는 -0.00%p로 쓰지 않는다', () => {
    // 라이브 실측: 잔량만 남은 ETF를 전량매도하면 port_pct가 0.004 같은 값이라 -0.00%p로 찍혀
    // 버그처럼 보였다. 방향은 배지가 이미 갖고 있으니 부호 없이 ≈0%p로 둔다.
    expect(activityText({ kind: 'add', share_pct: 0.2, port_pct: 0.004 })).toBe('0.2% · ≈0%p')
    expect(activityText({ kind: 'sold_out', share_pct: 100, port_pct: 0 })).toBe('100.0% · ≈0%p')
    expect(ppText(0.004, true)).toBe('≈0%p')
    expect(ppText(0.005, true)).toBe('-0.01%p')   // 경계는 표기한다
    expect(ppText(1.98, true)).toBe('-1.98%p')
    expect(ppText(null, true)).toBe('')
  })

  it('신규매수는 증감률이 없고, 보강 실패는 %p가 없다', () => {
    expect(activityText({ kind: 'buy', share_pct: null, port_pct: 15.26 })).toBe('+15.26%p')
    expect(activityText({ kind: 'add', share_pct: 4.5, port_pct: null })).toBe('4.5%')
    expect(activityText({ kind: 'add', share_pct: null, port_pct: null })).toBe('')
    expect(activityText(null)).toBe('')
  })

  it('shortDate는 ISO만 축약하고 나머지는 빈 문자열', () => {
    expect(shortDate('2026-03-31')).toBe('3/31')
    expect(shortDate('2026-06-30')).toBe('6/30')
    expect(shortDate(undefined)).toBe('')
    expect(shortDate('31 Mar 2026')).toBe('')
  })
})

describe('GuruDetail 활동 줄 · 전량매도 · 분기 표기 (task#240 S3·S4)', () => {
  it('활동이 있는 행만 2번째 줄을 만든다', async () => {
    mockManager(MANAGER_WITH_ACTIVITY)
    const { container } = renderPage()
    await screen.findByText('AMZN')
    // holdings 5행 중 activity 보유 4행
    expect(container.querySelectorAll('[data-testid="holding-row"]').length).toBe(5)
    expect(container.querySelectorAll('[data-testid="activity-line"]').length).toBe(4)
  })

  it('행마다 올바른 배지와 수치를 붙인다', async () => {
    mockManager(MANAGER_WITH_ACTIVITY)
    const { container } = renderPage()
    await screen.findByText('AMZN')
    const rows = [...container.querySelectorAll('[data-testid="holding-row"]')]
    // 인접 span은 CSS gap으로 띄우므로 textContent엔 공백이 없다 → 자식 단위로 읽는다
    const lineOf = (t) => {
      const line = rows.find(r => r.textContent.includes(t))?.querySelector('[data-testid="activity-line"]')
      if (!line) return null
      const kids = [...line.children].map(c => c.textContent.trim())
      return kids.join(' | ')
    }
    expect(lineOf('AMZN')).toBe('▲ 추가 | 19.2% · +2.80%p')
    expect(lineOf('MSFT')).toBe('★ 신규 | +15.26%p')
    expect(lineOf('UBER')).toBe('▼ 축소 | 0.8% · -0.13%p')
    expect(lineOf('PART')).toBe('▲ 추가 | 4.5%')     // port_pct 없으면 %p 생략
    expect(lineOf('QSR')).toBeNull()                 // 변동없음은 줄 자체가 없다
  })

  it('분기 표기와 %p 정의 캡션을 보여준다', async () => {
    mockManager(MANAGER_WITH_ACTIVITY)
    renderPage()
    expect((await screen.findByTestId('period-note')).textContent).toBe('Q1 2026 기준 · 3/31')
    expect(screen.getByTestId('activity-caption').textContent).toContain('이번 분기 거래분이 포트폴리오에서 차지하는 비중')
  })

  it('전량매도 섹션에 전 종목을 칩으로 렌더한다', async () => {
    mockManager(MANAGER_WITH_ACTIVITY)
    const { container } = renderPage()
    await screen.findByTestId('sold-out')
    const chips = [...container.querySelectorAll('[data-testid="sold-out-chip"]')]
    expect(chips.length).toBe(2)
    expect([...chips[0].children].map(c => c.textContent.trim()))
      .toEqual(['HLT', 'Hilton Worldwide', '-5.60%p'])
    expect(chips.map(c => c.children[0].textContent)).toEqual(['HLT', 'CMG'])
    expect(screen.getByTestId('sold-out').textContent).toContain('2종목')
  })

  it('활동이 전혀 없는 매니저는 줄·캡션·전량매도 섹션을 모두 만들지 않는다', async () => {
    // 라이브 실측 `aq` 표본 — dataroma가 그 분기 활동을 안 채웠거나 분기 불일치로 보강이 생략된 경우
    mockManager({ ...MANAGER_WITH_ACTIVITY, holdings: undefined, sold_out: [], top10: TOP10 })
    const { container } = renderPage()
    await screen.findByText('T1')
    expect(container.querySelectorAll('[data-testid="activity-line"]').length).toBe(0)
    expect(screen.queryByTestId('activity-caption')).toBeNull()
    expect(screen.queryByTestId('sold-out')).toBeNull()
    expect(screen.getByTestId('period-note')).toBeTruthy()   // 분기 표기는 남는다
  })

  it('크롤 이전 데이터(분기·활동·전량매도 전부 부재)에도 깨지지 않는다', async () => {
    mockManager(MANAGER_WITH_HOLDINGS)     // period/activity/sold_out 없음
    const { container } = renderPage()
    await screen.findByText('T1')
    expect(screen.queryByTestId('period-note')).toBeNull()
    expect(screen.queryByTestId('activity-caption')).toBeNull()
    expect(screen.queryByTestId('sold-out')).toBeNull()
    expect(container.querySelectorAll('[data-testid="holding-row"]').length).toBe(20)
  })
})

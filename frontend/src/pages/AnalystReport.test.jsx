import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import AnalystReport, { PerBandChart, PeerMultiplesChart, assignLabelRows } from './AnalystReport'
import { isLensReport } from '../components/reports/LensReport'
import api from '../api'

vi.mock('../api', () => ({ default: { get: vi.fn() } }))

// ── v2: 구조 축·9렌즈 (ADR 261006-232406, task#369) ─────────────────────
const judg = (id, signal, extra = {}) => ({ id, summary: `요약${id}`, body: `본문${id}`, metrics: [], signal,
  flip: signal === 'na' ? null : `바뀜${id}`, na_reason: signal === 'na' ? `사유${id}` : null, ...extra })
const raw = (value, unit, source = 'disclosure', rationale = null) => ({ value, unit, source, ref: '10-Q 2026Q2', rationale })

export const V2_REPORT = {
  ticker: 'CRCL', published_date: '2026-10-07', title: '금리 의존 구조 그대로',
  name: 'Circle', market: 'US', format: 2,
  tally: { go: 2, wait: 4, stop: 2, na: 1 },
  structure: {
    revenue_engine: { value: 'balance_rate', rationale: '준비금 잔고×금리가 매출의 95%' },
    cost_nature: { value: 'revenue_linked', rationale: '분배비용이 준비금 수익에 연동' },
    funding_source: { value: 'deposit', rationale: 'USDC 예치금' },
  },
  lenses: [
    judg(1, 'wait'),
    judg(2, 'go', { gauge: { variable: '분기 매출', unit: '억달러', current: 7.6, current_ref: '10-Q 2026Q2', boundaries: [7.0, 7.5], zones: ['stop', 'wait', 'go'], origin: 'routine' } }),
    { ...judg(3, 'stop'), flip: '기여몫 증가율이 18.1% 이상이면 노랑', inputs: { contribution_prev: raw(251, 'USD M') }, sensitivity: null,
      computed: { variant: 'revenue_linked', values: { ratio: 0.6693, numerator_growth_pct: 15.14, cost_growth_pct: 22.63 }, signal: 'stop', flip: '기여몫 증가율이 18.1% 이상이면 노랑', flip_value: 18.1, estimate_based: false } },
    { ...judg(4, 'go'), flip: '한계 분배율이 53.8% 이상이면 노랑', inputs: {}, sensitivity: null,
      computed: { variant: 'revenue_linked', values: { marginal_pct: 12.79, average_pct: 58.81 }, signal: 'go', flip: '한계 분배율이 53.8% 이상이면 노랑', flip_value: 53.8, estimate_based: false } },
    { ...judg(5, 'wait'), flip: '준비금 수익률 3.15% 아래면 빨강',
      inputs: { balance: raw(74200, 'USD M'), avg_share_pct: raw(38.2, '%', 'estimate', 'RLDC ÷ 준비금 수익') }, sensitivity: null,
      computed: { variant: 'deposit', values: { breakeven_pct: 2.1484, margin_pp: 1.3416, marginal_share_pct: 51.15 }, signal: 'wait', flip: '준비금 수익률 3.15% 아래면 빨강', flip_value: 3.1484, estimate_based: true,
        gauge: { variable: '준비금 수익률', unit: '%', current: 3.49, boundaries: [3.1484, 4.1484], zones: ['stop', 'wait', 'go'], origin: 'server' } } },
    judg(6, 'stop', { conditions: [
      { color: 'go', when: ['분배처 다변화 완료'], match: 'all' },
      { color: 'wait', when: ['코인베이스 외 분배처 비중 상승', '협약 조건 불변'], match: 'all' },
      { color: 'stop', when: ['코인베이스가 경쟁 코인 공동 창립'], match: 'any' },
    ] }), judg(7, 'wait'),
    { ...judg(8, 'wait'), flip: 'forward 이익 515.75 아래면 빨강', inputs: { forward_earnings: raw(620, 'USD M', 'estimate', '가이던스') },
      sensitivity: { exogenous: { label: '준비금 수익률', values: [3.0, 3.6, 4.2], unit: '%' }, endogenous: { label: 'USDC 유통량', values: [70000, 74000, 80000], unit: 'USD M' } },
      computed: { variant: 'balance_rate', values: { multiple: 33.27, earnings_yield_pct: 3.005, risk_free_pct: 4.0,
        sensitivity: { exogenous: [3.0, 3.6, 4.2], endogenous: [70000, 74000, 80000], multiples: [[60.1, 55.2, 49.3], [40.2, 37.6, 34.1], [30.0, 28.1, 25.9]] } },
        signal: 'wait', flip: 'forward 이익 515.75 아래면 빨강', flip_value: 515.75, estimate_based: true, risk_free_source: 'server_cache' } },
    { ...judg(9, 'na'), inputs: null, sensitivity: null, computed: null },
  ],
  data: { snapshot_date: '2026-10-06', price: 83.3, market: 'US', name: 'Circle', consensus: { target_mean: 120 },
          financials_annual: [], competitors: [], per_band: null },
}

// 발행 계약은 v2뿐이다(task#370 — v1 투자의견·적정주가 밴드·포인트·리스크 렌더러 제거).
// 페이지 공통 섹션(헤더·사업부문·발행 시점 숫자·피어·실적 추정·이력) 테스트는 이 KR 픽스처로 돈다.
const REPORT = {
  ...V2_REPORT,
  ticker: '005930', published_date: '2026-07-25', title: '한줄 논지 테스트', name: '삼성전자', market: 'KR',
  data: {
    snapshot_date: '2026-07-25', price: 249500.0, market: 'KR', name: '삼성전자',
    consensus: { target_mean: 455000.0, buy: 25, hold: 0, sell: 0 },
    financials_annual: [
      { period: '2024', revenue: 300e12, operating_income: 32e12, eps: 4950, per: 10.8, is_consensus: false },
      { period: '2026', revenue: 360e12, operating_income: 60e12, eps: 9000, per: null, is_consensus: true },
    ],
    competitors: [
      { ticker: '005930', name: '삼성전자', is_self: true, per: 20.2, pbr: 3.47, psr: 3.76, ev_ebitda: 11.9, rd_intensity: 11.3 },
      { ticker: '000660', name: 'SK하이닉스', is_self: false, per: 7.8, pbr: 3.48, psr: 9.49, ev_ebitda: 14.5, rd_intensity: 6.9 },
    ],
    per_band: { min: 10.8, max: 36.8, avg: 22.0, current: 20.2, forward: 5.9 },
  },
}

// 옛 형식(v1) 판 — lens_report가 없어 format 1로 온다. 렌더러가 없으니 안내만 해야 한다.
const LEGACY = {
  ticker: '005930', published_date: '2026-07-25', title: '옛 형식 논지', name: '삼성전자', market: 'KR',
  format: 1, tally: null, data: REPORT.data,
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/analyst-report/005930/2026-07-25']}>
      <Routes>
        <Route path="/analyst-report/:ticker/:date" element={<AnalystReport />} />
      </Routes>
    </MemoryRouter>
  )
}

beforeEach(() => vi.clearAllMocks())

describe('AnalystReport 문서 페이지 (task#212)', () => {
  it('전 섹션 렌더 — 헤더·렌즈 본문·발행 시점 숫자·피어·추정, v1 섹션 없음(task#370)', async () => {
    api.get.mockResolvedValue({ data: REPORT })
    renderPage()
    expect(await screen.findByText('한줄 논지 테스트')).toBeTruthy()
    expect(screen.getByText('삼성전자')).toBeTruthy()
    expect(screen.getByText('렌즈 신호')).toBeTruthy()
    expect(screen.getByText('발행 시점 숫자')).toBeTruthy()
    expect(screen.getAllByText('SK하이닉스').length).toBe(5)  // 피어 차트 — 지표당 1행 (task#220)
    expect(screen.getByText('실적 추정')).toBeTruthy()
    // 차트 틱은 jsdom(0크기 컨테이너)에서 미렌더 — 범례·캡션으로 차트화 검증(task#217)
    expect(screen.getByText('매출(원)')).toBeTruthy()
    expect(screen.getByText(/\(E\) = 컨센서스 추정/)).toBeTruthy()
    // v1 섹션·투자의견 배지는 계약과 함께 제거됐다(「밸류에이션」은 렌즈 8 이름이라 여기서 세지 않는다)
    for (const gone of ['투자 포인트', '적정주가 밴드', '리스크 요인', '매수', '중립', '매도']) {
      expect(screen.queryByText(gone)).toBeNull()
    }
  })

  it('옛 형식(v1) 판은 렌즈 본문 대신 안내만 — 없는 투자의견·밴드를 그리지 않는다(task#370)', async () => {
    api.get.mockResolvedValue({ data: LEGACY })
    renderPage()
    expect(await screen.findByTestId('legacy-format-notice')).toBeTruthy()
    expect(screen.queryByText('렌즈 신호')).toBeNull()
    expect(screen.queryByText('옛 형식 논지')).toBeNull()   // 논지는 LensReport가 그린다 — 안내 판은 그리지 않음
    expect(screen.getByText('발행 시점 숫자')).toBeTruthy()  // 서버 숫자 블록은 형식과 무관하게 남는다
  })

  it('문서 하단 복귀 링크 제거 + 플로팅 복귀 pill(task#225 → 목적지 task#324)', async () => {
    api.get.mockResolvedValue({ data: REPORT })
    const { container } = renderPage()
    await screen.findByText('한줄 논지 테스트')
    expect([...container.querySelectorAll('a')].some(a => a.textContent.trim() === '← 심층 리포트')).toBe(false)
    const pill = container.querySelector('.list-pill')
    // task#225의 결정(하단 링크 제거·플로팅 pill 유지)은 그대로다. 바뀐 것은 *목적지*뿐 —
    // nav에서 「심층 리포트」가 빠지고 /analyst-reports가 admin 발행 관리 화면이 되었으므로
    // 일반 사용자의 복귀 지점은 그 종목의 리포트 상세다(task#324, ADR-0047).
    expect(pill?.getAttribute('href')).toBe('/reports')
    expect(pill?.textContent.trim()).toBe('← 종목 리포트')
  })

  // ── task#324 S1 — 같은 본문을 탭 안에서도 렌더한다 ────────────────────────────
  it('props로 렌더하면 라우트 없이도 같은 본문이 나온다(task#324)', async () => {
    api.get.mockResolvedValue({ data: REPORT })
    render(
      <MemoryRouter>
        <AnalystReport ticker="005930" date="2026-07-25" />
      </MemoryRouter>
    )
    expect(await screen.findByText('한줄 논지 테스트')).toBeTruthy()
    expect(screen.getByText('렌즈 신호')).toBeTruthy()
    expect(screen.getByText('발행 시점 숫자')).toBeTruthy()
    // props가 URL params를 대신했다는 증거 — 그 ticker/date로 조회했다
    expect(api.get).toHaveBeenCalledWith('/api/analyst-reports/005930/2026-07-25')
  })

  it('embedded면 페이지 전용 크롬(복귀 pill)이 없다(task#324)', async () => {
    api.get.mockResolvedValue({ data: REPORT })
    const { container } = render(
      <MemoryRouter>
        <AnalystReport ticker="005930" date="2026-07-25" embedded />
      </MemoryRouter>
    )
    await screen.findByText('한줄 논지 테스트')
    expect(container.querySelector('.list-pill')).toBeNull()
    // 대조군 — 크롬만 사라지고 본문은 그대로다(크롬을 지우려다 본문을 지우면 이 축이 잡는다)
    expect(screen.getByText('렌즈 신호')).toBeTruthy()
  })

  it('용어집 배선 — 지표 라벨·본문에 glossary-term 버튼(task#220)', async () => {
    api.get.mockResolvedValue({ data: REPORT })
    const { container } = renderPage()
    await screen.findByText('한줄 논지 테스트')
    // 피어 차트 지표명(R&D집약도 신규 용어) + 발행 시점 숫자 Stat 라벨(컨센서스 목표가)
    expect(screen.getByRole('button', { name: 'R&D집약도' })).toBeTruthy()
    expect(container.querySelectorAll('.glossary-term').length).toBeGreaterThanOrEqual(2)
    // 한줄 논지(제목)는 용어집 제외
    expect(screen.getByText('한줄 논지 테스트').querySelector('.glossary-term')).toBeNull()
  })

  it('US 영업이익 전무면 열 생략(null graceful)', async () => {
    const us = {
      ...REPORT, market: 'US',
      data: {
        ...REPORT.data, market: 'US',
        financials_annual: [
          { period: '2024', revenue: 3e11, operating_income: null, eps: 6.1, per: 30.0, is_consensus: false },
          { period: '2026', revenue: 4e11, operating_income: null, eps: 8.0, per: null, is_consensus: true },
        ],
      },
    }
    api.get.mockResolvedValue({ data: us })
    renderPage()
    await screen.findByText('실적 추정')
    expect(screen.queryByText('영업이익')).toBeNull()
  })

  it('구발행물(data.market_outlook 부재)은 사업부문 시장 분석 섹션이 나타나지 않는다(task#275)', async () => {
    api.get.mockResolvedValue({ data: REPORT })
    renderPage()
    await screen.findByText('한줄 논지 테스트')
    expect(screen.queryByText('🧩 사업부문 시장 분석')).toBeNull()
  })

  it('data.market_outlook.segments 있으면 사업부문 시장 분석 섹션이 렌즈 본문 뒤·발행 시점 숫자 앞에 렌더된다(task#275)', async () => {
    const withSegments = {
      ...REPORT,
      data: {
        ...REPORT.data,
        market_outlook: {
          segments: [
            { name: '반도체', period: '2024', revenue_share_pct: 60 },
            { name: '가전', period: '2024', revenue_share_pct: 40 },
          ],
        },
      },
    }
    api.get.mockResolvedValue({ data: withSegments })
    const { container } = renderPage()
    await screen.findByText('한줄 논지 테스트')
    expect(screen.getByText('🧩 사업부문 시장 분석')).toBeTruthy()
    // 렌즈 본문(렌즈 상세) 다음 · 발행 시점 숫자 앞 위치 확인
    const titles = [...container.querySelectorAll('.rpt-title__text')].map(el => el.textContent)
    const pointsIdx = titles.findIndex(t => t.includes('렌즈 상세'))
    const segIdx = titles.findIndex(t => t.includes('사업부문 시장 분석'))
    const valIdx = titles.findIndex(t => t.includes('발행 시점 숫자'))
    expect(pointsIdx).toBeGreaterThanOrEqual(0)
    expect(segIdx).toBeGreaterThan(pointsIdx)
    expect(valIdx).toBeGreaterThan(segIdx)
  })

  it('404면 에러 상태 표시(silent catch 금지)', async () => {
    api.get.mockRejectedValue({ response: { status: 404 } })
    renderPage()
    expect(await screen.findByText('발행물을 찾을 수 없습니다.')).toBeTruthy()
  })
})

describe('발행물 이력 네비게이션 (task#222)', () => {
  // 목록은 종목당 최신 1건이므로 과거 판 이동은 이 문서에서만 가능
  const mockHistory = (dates) => api.get.mockImplementation((url) =>
    url === '/api/analyst-reports/005930'
      ? Promise.resolve({ data: { ticker: '005930', reports: dates.map(d => ({ ticker: '005930', published_date: d })) } })
      : Promise.resolve({ data: REPORT }))

  it('이전 판이 있으면 링크로 노출(현재 판 제외·최근 5개)', async () => {
    mockHistory(['2026-07-25', '2026-07-18', '2026-07-11', '2026-07-04', '2026-06-27', '2026-06-20', '2026-06-13'])
    renderPage()
    expect(await screen.findByText('이전 판')).toBeTruthy()
    expect(screen.queryByRole('link', { name: '2026-07-25' })).toBeNull()   // 현재 보고 있는 판 제외
    expect(screen.getByRole('link', { name: '2026-07-18' }).getAttribute('href'))
      .toBe('/analyst-report/005930/2026-07-18')
    expect(screen.getByRole('link', { name: '2026-06-20' })).toBeTruthy()   // 5번째
    expect(screen.queryByRole('link', { name: '2026-06-13' })).toBeNull()   // 6번째부터 생략
  })

  it('판이 하나면 이력 섹션 미노출', async () => {
    mockHistory(['2026-07-25'])
    renderPage()
    await screen.findByText('한줄 논지 테스트')
    expect(screen.queryByText('이전 판')).toBeNull()
  })

  it('이력 조회 실패는 graceful — 본문은 그대로 렌더', async () => {
    api.get.mockImplementation((url) =>
      url === '/api/analyst-reports/005930'
        ? Promise.reject(new Error('boom'))
        : Promise.resolve({ data: REPORT }))
    renderPage()
    expect(await screen.findByText('한줄 논지 테스트')).toBeTruthy()
    expect(screen.queryByText('이전 판')).toBeNull()
  })
})

describe('PeerMultiplesChart (task#220 — 피어 멀티플 표→지표별 미니 가로막대)', () => {
  const PEERS = REPORT.data.competitors

  it('지표 5종 라벨 + 자사 강조(●) + 포맷 값 렌더', () => {
    render(<PeerMultiplesChart peers={PEERS} />)
    for (const label of ['PER', 'PBR', 'PSR', 'EV/EBITDA', 'R&D집약도']) {
      expect(screen.getByText(label)).toBeTruthy()
    }
    expect(screen.getAllByText('삼성전자 ●').length).toBe(5)  // 자사 마커, 지표당 1행
    expect(screen.getByText('20.2')).toBeTruthy()   // per .toFixed(1)
    expect(screen.getByText('3.47')).toBeTruthy()   // pbr .toFixed(2)
    expect(screen.getByText('11.3%')).toBeTruthy()  // rd_intensity %
  })

  it('전 피어 null인 지표는 차트 생략, null 피어는 행 생략', () => {
    const peers = [
      { ticker: 'A', name: 'A사', is_self: true, per: 10.0, pbr: null, psr: null, ev_ebitda: 5.0, rd_intensity: null },
      { ticker: 'B', name: 'B사', is_self: false, per: null, pbr: null, psr: null, ev_ebitda: 6.0, rd_intensity: null },
    ]
    render(<PeerMultiplesChart peers={peers} />)
    expect(screen.queryByText('PBR')).toBeNull()
    expect(screen.queryByText('PSR')).toBeNull()
    expect(screen.queryByText('R&D집약도')).toBeNull()
    expect(screen.getAllByText('A사 ●').length).toBe(2)  // PER·EV/EBITDA만
    expect(screen.getAllByText('B사').length).toBe(1)    // EV/EBITDA만
  })

  it('피어 없으면 미렌더', () => {
    const { container } = render(<PeerMultiplesChart peers={[]} />)
    expect(container.innerHTML).toBe('')
  })
})

describe('PerBandChart', () => {
  it('밴드 재료 없으면 미렌더', () => {
    const { container } = render(<PerBandChart band={null} />)
    expect(container.innerHTML).toBe('')
  })
})

describe('assignLabelRows (task#219 — 마커 라벨 근접 시 2단 스태거)', () => {
  it('멀리 떨어진 마커는 전부 아랫줄(0)', () => {
    expect(assignLabelRows([5.9, 20.2, 36.0], 40)).toEqual([0, 0, 0])
  })

  it('근접 2마커는 0/1 분리 (삼성전자 실사례: 현재 20.2 vs 평균 22.2)', () => {
    // 도메인 폭 ~43 (2.2~40.5+pad), 간격 2 < 43*0.14 → 스태거
    expect(assignLabelRows([22.2, 20.2, 5.9], 43)).toEqual([1, 0, 0])
  })

  it('3마커 밀집은 0/1 교차 배정', () => {
    const rows = assignLabelRows([10, 10.5, 11], 40)
    expect(rows[0]).toBe(0)
    expect(rows[1]).toBe(1)
  })

  it('입력 순서와 무관하게 값 오름차순 기준으로 배정', () => {
    // marks 배열 순서(평균·현재·Fwd)가 값 순서와 달라도 동일 결과
    expect(assignLabelRows([20.2, 22.2], 43)).toEqual([0, 1])
    expect(assignLabelRows([22.2, 20.2], 43)).toEqual([1, 0])
  })

  it('빈 배열·단일 마커 graceful', () => {
    expect(assignLabelRows([], 40)).toEqual([])
    expect(assignLabelRows([20.2], 40)).toEqual([0])
  })
})

describe('v2 렌즈 판 렌더 (task#369)', () => {
  it('분기 게이트 — 픽스처가 실제로 v2 분기를 탄다(옛 형식 픽스처는 안 탄다)', () => {
    expect(isLensReport(V2_REPORT)).toBe(true)
    expect(isLensReport(REPORT)).toBe(true)
    expect(isLensReport(LEGACY)).toBe(false)
    expect(isLensReport({ ...V2_REPORT, lenses: [] })).toBe(false)
  })

  it('논지 → 렌즈 신호(집계 + 렌즈별 신호·바뀜 조건 한 행) → 구조 축 → 렌즈 상세 순서, 투자의견·포인트 없음', async () => {
    api.get.mockImplementation((url) => Promise.resolve({ data: url.endsWith('/2026-10-07') ? V2_REPORT : { reports: [] } }))
    const { container } = render(
      <MemoryRouter initialEntries={['/analyst-report/CRCL/2026-10-07']}>
        <Routes><Route path="/analyst-report/:ticker/:date" element={<AnalystReport />} /></Routes>
      </MemoryRouter>
    )
    expect(await screen.findByText('금리 의존 구조 그대로')).toBeTruthy()
    expect(screen.queryByText('중립')).toBeNull()             // rating=null이 「중립」으로 오표시되지 않는다
    expect(screen.queryByText('투자 포인트')).toBeNull()
    const text = container.textContent
    const order = ['금리 의존 구조 그대로', '렌즈 신호', '구조 축', '렌즈 상세']
    expect(screen.queryByText('바뀜 조건', { selector: 'h2,h3' })).toBeNull()   // 별도 절 없음(렌즈 신호에 합침)
    const idx = order.map(s => text.indexOf(s))
    expect(idx.every(i => i >= 0)).toBe(true)
    expect([...idx].sort((a, b) => a - b)).toEqual(idx)
    // 신호판 9칸, 번호 순
    const cells = container.querySelectorAll('[data-lens-cell]')
    expect([...cells].map(c => c.getAttribute('data-lens-cell'))).toEqual(['1', '2', '3', '4', '5', '6', '7', '8', '9'])
    // 색만으로 말하지 않는다 — 텍스트 라벨 병기
    expect(cells[0].textContent).toContain('노랑')
    expect(cells[8].textContent).toContain('미산출')
    // 집계
    expect(screen.getByTestId('lens-tally').textContent).toMatch(/초록\s*2.*노랑\s*4.*빨강\s*2.*미산출\s*1/)
  })

  it('계산 렌즈는 서버 계산값·원자료 출처·「추정 기반」을, na 렌즈는 사유를 보인다', async () => {
    api.get.mockImplementation((url) => Promise.resolve({ data: url.endsWith('/2026-10-07') ? V2_REPORT : { reports: [] } }))
    render(
      <MemoryRouter initialEntries={['/analyst-report/CRCL/2026-10-07']}>
        <Routes><Route path="/analyst-report/:ticker/:date" element={<AnalystReport />} /></Routes>
      </MemoryRouter>
    )
    await screen.findByText('금리 의존 구조 그대로')
    expect(screen.getByText('2.15%')).toBeTruthy()            // 손익분기 금리(서버 계산)
    expect(screen.getAllByText('준비금 수익률 3.15% 아래면 빨강').length).toBe(1)  // 바뀜 조건은 신호 행에 한 번만
    expect(screen.getAllByText('추정 기반').length).toBe(2)   // 렌즈 5·8 (렌즈 3·4는 공시만)
    expect(screen.getByText('RLDC ÷ 준비금 수익')).toBeTruthy() // 추정 근거
    expect(screen.getByText(/미산출 사유: 사유9/)).toBeTruthy()
    expect(screen.getByText('37.6')).toBeTruthy()             // 렌즈 8 민감도 표 칸
    expect(screen.getByText('잔고×금리')).toBeTruthy()         // 구조 축 라벨
  })
})

describe('바뀜 조건 게이지 (task#369 UAT 피드백)', () => {
  const renderV2 = async () => {
    api.get.mockImplementation((url) => Promise.resolve({ data: url.endsWith('/2026-10-07') ? V2_REPORT : { reports: [] } }))
    const r = render(
      <MemoryRouter initialEntries={['/analyst-report/CRCL/2026-10-07']}>
        <Routes><Route path="/analyst-report/:ticker/:date" element={<AnalystReport />} /></Routes>
      </MemoryRouter>
    )
    await screen.findByText('금리 의존 구조 그대로')
    return r
  }

  it('게이지가 있는 계산 렌즈는 그 행에 그래프를, 현재값이 놓인 구간 = 그 렌즈의 신호', async () => {
    const { container } = await renderV2()
    const row5 = container.querySelector('[data-lens-cell="5"]')
    const g = row5.querySelector('[data-flip-gauge]')
    expect(g).toBeTruthy()
    expect(g.getAttribute('data-current-zone')).toBe('wait')
    expect(g.getAttribute('aria-label')).toMatch(/준비금 수익률.*3\.49%/)
    expect(g.getAttribute('aria-label')).toMatch(/빨강.*3\.15%/)
    // 구간 3개 + 경계 라벨 2개
    expect(g.querySelectorAll('[data-zone]').length).toBe(3)
    expect([...g.querySelectorAll('[data-boundary]')].map(e => e.textContent)).toEqual(['3.15%', '4.15%'])
    // 그래프 아래 문장도 함께(색만으로 말하지 않는다)
    expect(row5.textContent).toContain('준비금 수익률 3.15% 아래면 빨강')
  })

  it('게이지가 없는 렌즈(판단 렌즈·게이지 이전 발행물)는 문장만, 미산출은 사유', async () => {
    const { container } = await renderV2()
    expect(container.querySelectorAll('[data-flip-gauge]').length).toBe(2)   // 렌즈 5(서버) + 렌즈 2(루틴)
    expect(container.querySelector('[data-lens-cell="8"]').textContent).toContain('forward 이익 515.75 아래면 빨강')
    expect(container.querySelector('[data-lens-cell="1"]').textContent).toContain('바뀜1')
    expect(container.querySelector('[data-lens-cell="9"]').textContent).toContain('사유9')
  })

  // 렌즈 8은 게이지 축이 「색이 바뀌는 주가」다(task#376) — 서버가 박제한 주가 경계를 그리기만 한다.
  // 왼쪽(싼 쪽) 초록 → 오른쪽 빨강이고, 문장은 이익 기준 그대로 남는다.
  const withPriceGauge = (gauge, signal = 'stop') => {
    const l8 = V2_REPORT.lenses[7]
    return { ...V2_REPORT, lenses: V2_REPORT.lenses.map(l => (l.id !== 8 ? l : {
      ...l, signal, flip: 'forward 이익 777.6 이상이면 노랑',
      computed: { ...l8.computed, signal, flip: 'forward 이익 777.6 이상이면 노랑', flip_value: 777.5947, gauge },
    })) }
  }
  const renderReport = async (report) => {
    api.get.mockImplementation((url) => Promise.resolve({ data: url.endsWith('/2026-10-07') ? report : { reports: [] } }))
    const r = render(
      <MemoryRouter initialEntries={['/analyst-report/CRCL/2026-10-07']}>
        <Routes><Route path="/analyst-report/:ticker/:date" element={<AnalystReport />} /></Routes>
      </MemoryRouter>
    )
    await screen.findByText('금리 의존 구조 그대로')
    return r
  }

  it('렌즈 8 주가축 게이지 — 세 색의 1주당 가격과 발행 시점 주가 출처를 그린다', async () => {
    const { container } = await renderReport(withPriceGauge({
      variable: '주가', unit: 'USD', current: 84.13, boundaries: [42.9123, 59.9879], zones: ['go', 'wait', 'stop'],
      current_ref: '발행 시점 주가 (2026-10-07)', origin: 'server', near_boundary: false }))
    const row8 = container.querySelector('[data-lens-cell="8"]')
    const g = row8.querySelector('[data-flip-gauge]')
    expect(g).toBeTruthy()
    expect(g.getAttribute('data-current-zone')).toBe('stop')
    expect([...g.querySelectorAll('[data-zone]')].map(e => e.getAttribute('data-zone'))).toEqual(['go', 'wait', 'stop'])
    expect([...g.querySelectorAll('[data-boundary]')].map(e => e.textContent)).toEqual(['42.91 USD', '59.99 USD'])
    expect(g.getAttribute('aria-label')).toMatch(/주가 현재 84\.13 USD/)
    expect(g.getAttribute('aria-label')).toMatch(/초록 42\.91 USD 미만/)
    expect(g.textContent).toContain('현재값 출처: 발행 시점 주가 (2026-10-07)')
    // 문장은 이익축 그대로(비목표 — 바뀜 조건 문장 불변)
    expect(row8.textContent).toContain('forward 이익 777.6 이상이면 노랑')
  })

  it('렌즈 8 주가축 — 금리가 낮아 경계 1개인 두 색 게이지도 그린다', async () => {
    const { container } = await renderReport(withPriceGauge({
      variable: '주가', unit: 'KRW', current: 273000, boundaries: [5441042], zones: ['go', 'wait'],
      current_ref: '발행 시점 주가 (2026-10-07)', origin: 'server' }, 'go'))
    const g = container.querySelector('[data-lens-cell="8"] [data-flip-gauge]')
    expect(g.getAttribute('data-current-zone')).toBe('go')
    expect([...g.querySelectorAll('[data-boundary]')].map(e => e.textContent)).toEqual(['5,441,042 KRW'])
    expect(g.textContent).toContain('현재값 출처: 발행 시점 주가')
  })
})

describe('판단 렌즈 바뀜 조건 — 수치면 게이지, 아니면 조건 (사람 UAT 피드백 2)', () => {
  const renderV2 = async () => {
    api.get.mockImplementation((url) => Promise.resolve({ data: url.endsWith('/2026-10-07') ? V2_REPORT : { reports: [] } }))
    const r = render(
      <MemoryRouter initialEntries={['/analyst-report/CRCL/2026-10-07']}>
        <Routes><Route path="/analyst-report/:ticker/:date" element={<AnalystReport />} /></Routes>
      </MemoryRouter>
    )
    await screen.findByText('금리 의존 구조 그대로')
    return r
  }

  it('수치형 판단 렌즈는 게이지 + 「루틴 판단」, 계산 렌즈 게이지는 「서버 계산」', async () => {
    const { container } = await renderV2()
    const g2 = container.querySelector('[data-lens-cell="2"] [data-flip-gauge]')
    expect(g2.getAttribute('data-origin')).toBe('routine')
    expect(g2.textContent).toContain('루틴 판단')
    expect(g2.getAttribute('data-current-zone')).toBe('go')
    const g5 = container.querySelector('[data-lens-cell="5"] [data-flip-gauge]')
    expect(g5.getAttribute('data-origin')).toBe('server')
    expect(g5.textContent).toContain('서버 계산')
  })

  it('비수치형 판단 렌즈는 세 색 조건(초록→노랑→빨강), 지금 색은 「현재」 강조, 문장 반복 없음(피드백 3)', async () => {
    const { container } = await renderV2()
    const row6 = container.querySelector('[data-lens-cell="6"]')
    const c = row6.querySelector('[data-flip-conditions]')
    const items = [...c.querySelectorAll('[data-condition]')]
    expect(items.map(e => e.getAttribute('data-condition'))).toEqual(['go', 'wait', 'stop'])
    expect(items.map(e => e.getAttribute('data-current'))).toEqual(['false', 'false', 'true'])   // 렌즈 6 = 빨강
    expect(items[2].textContent).toContain('현재')
    expect(items[2].textContent).toContain('근거')
    expect(items[1].textContent).toContain('모두 확인되면')
    expect([...items[1].querySelectorAll('li')].map(li => li.textContent)).toEqual(['코인베이스 외 분배처 비중 상승', '협약 조건 불변'])
    expect(row6.textContent).not.toContain('바뀜6')
  })

  it('구조화 이전 데이터(게이지·조건 없음)는 문장으로 폴백', async () => {
    const { container } = await renderV2()
    const row1 = container.querySelector('[data-lens-cell="1"]')
    expect(row1.querySelector('[data-flip-gauge],[data-flip-conditions]')).toBeNull()
    expect(row1.textContent).toContain('바뀜1')
  })
})

// ── 렌즈 화면 후속 (task#372) — 일반인 이름 + 「?」 · 애널 추정치 · 렌즈 3 기준 · 경계 근접 ────────────
const NEW_NAMES = ['숫자의 신뢰도', '지금 매출 속도', '벌수록 남는 구조', '묶여 있는 비용', '망할 위험',
  '고객 이탈 위험', '경영진·대주주', '지금 주가 수준', '앞으로의 수요']
// 옛 이름은 잇대어 만든다 — 리터럴로 적으면 「옛 이름 잔존 0」 grep 감사가 이 테스트 자신을 잔존으로 센다
const OLD_NAMES = [['출처', '사슬'], ['런레', '이트'], ['생존 위협', '경로'], ['집중과 전환', '비용'], ['밸류', '에이션']].map(p => p.join(p[0] === '런레' || p[0] === '밸류' ? '' : ' '))
const withComputed = (l, extra) => ({ ...l, computed: { ...l.computed, ...extra } })
// 새 필드 픽스처: 렌즈 3 forward · 렌즈 4 애널 추정치만 · 렌즈 5 추정 기반만 + 경계 근접 · 렌즈 8 둘 다 · 렌즈 2(판단) 근접 아님
const V2_NEW = {
  ...V2_REPORT,
  lenses: V2_REPORT.lenses.map(l => {
    if (l.id === 2) return { ...l, gauge: { ...l.gauge, near_boundary: false } }
    if (l.id === 3) return withComputed(l, { basis: 'forward', consensus_based: false })
    if (l.id === 4) return { ...withComputed(l, { consensus_based: true }), inputs: { revenue_curr: { value: 701, unit: 'USD M', source: 'consensus', ref: 'FactSet 2026-10' } } }
    if (l.id === 5) return withComputed(l, { consensus_based: false, gauge: { ...l.computed.gauge, near_boundary: true } })
    if (l.id === 8) return withComputed(l, { consensus_based: true })
    return l
  }),
}

describe('렌즈 화면 후속 (task#372)', () => {
  const renderWith = async (report) => {
    api.get.mockImplementation((url) => Promise.resolve({ data: url.endsWith('/2026-10-07') ? report : { reports: [] } }))
    const r = render(
      <MemoryRouter initialEntries={['/analyst-report/CRCL/2026-10-07']}>
        <Routes><Route path="/analyst-report/:ticker/:date" element={<AnalystReport />} /></Routes>
      </MemoryRouter>
    )
    await screen.findByText('금리 의존 구조 그대로')
    return r
  }
  const header = (container, id) => container.querySelector(`#lens-${id}`).firstElementChild

  it('픽스처가 새 분기를 실제로 탄다(게이트) — 옛 픽스처는 새 필드가 전혀 없다', () => {
    expect(V2_NEW.lenses.some(l => l.computed?.consensus_based)).toBe(true)
    expect(V2_NEW.lenses.some(l => l.computed?.basis)).toBe(true)
    expect(V2_NEW.lenses.some(l => (l.computed?.gauge ?? l.gauge)?.near_boundary === true)).toBe(true)
    const json = JSON.stringify(V2_REPORT)
    expect(json).not.toMatch(/consensus_based|"basis"|near_boundary/)
  })

  it('ⓐ 9렌즈 전부 새 이름(신호 행·상세 헤더), 옛 이름 0', async () => {
    const { container } = await renderWith(V2_NEW)
    const rowNames = [...container.querySelectorAll('[data-lens-name]')].map(e => e.textContent.replace(/^\d+/, ''))
    expect(rowNames).toEqual(NEW_NAMES)
    const detailNames = [...container.querySelectorAll('[data-lens-detail-name]')].map(e => e.textContent)
    expect(detailNames).toEqual(NEW_NAMES)
    for (const o of OLD_NAMES) expect(container.textContent).not.toContain(o)
  })

  it('ⓑ 「?」 클릭 → 그 렌즈가 묻는 것, 두 위치 모두(버튼 18개)', async () => {
    await renderWith(V2_NEW)
    expect(screen.getAllByRole('button', { name: /— 설명 보기$/ }).length).toBe(18)
    const btns = screen.getAllByRole('button', { name: '벌수록 남는 구조 — 설명 보기' })
    expect(btns.length).toBe(2)
    for (const b of btns) {
      fireEvent.click(b)
      const tip = screen.getByRole('tooltip')
      expect(tip.textContent).toContain('벌수록 남는 구조')
      expect(tip.textContent).toContain('매출이 늘 때 비용이 덜 느는가')
      fireEvent.click(b)   // 토글로 닫기
      expect(screen.queryByRole('tooltip')).toBeNull()
    }
  })

  it('ⓒ 애널 추정치 — consensus_based만이면 「애널 추정치」만, estimate_based만이면 「추정 기반」만, 둘 다면 둘 다', async () => {
    const { container } = await renderWith(V2_NEW)
    const h4 = header(container, 4).textContent, h5 = header(container, 5).textContent, h8 = header(container, 8).textContent
    expect(h4).toContain('애널 추정치'); expect(h4).not.toContain('추정 기반')
    expect(h5).toContain('추정 기반'); expect(h5).not.toContain('애널 추정치')
    expect(h8).toContain('애널 추정치'); expect(h8).toContain('추정 기반')
    // 원자료 출처 consensus는 「공시」로 오표시되지 않는다
    const li = [...container.querySelectorAll('#lens-4 li')].find(e => e.textContent.includes('FactSet'))
    expect(li.textContent).toContain('애널 추정치'); expect(li.textContent).not.toContain('공시')
  })

  it('ⓓ 렌즈 3 비교 기간 — forward·yoy_quarter 각각 표기, 없으면 미표기', async () => {
    const { container, unmount } = await renderWith(V2_NEW)
    expect(container.querySelector('#lens-3 [data-lens-basis]').textContent).toContain('향후 기간 vs 전년 동기')
    unmount()
    const yoy = { ...V2_NEW, lenses: V2_NEW.lenses.map(l => (l.id === 3 ? withComputed(l, { basis: 'yoy_quarter' }) : l)) }
    const r2 = await renderWith(yoy)
    expect(r2.container.querySelector('#lens-3 [data-lens-basis]').textContent).toContain('최근 분기 vs 전년 동기')
    r2.unmount()
    const r3 = await renderWith(V2_REPORT)
    expect(r3.container.querySelector('[data-lens-basis]')).toBeNull()
  })

  it('ⓔ 경계 근접 — true면 그 게이지에 「경계 근접」, false·부재면 없음', async () => {
    const { container } = await renderWith(V2_NEW)
    const near = [...container.querySelectorAll('[data-near-boundary]')]
    expect(near.map(e => e.closest('[data-lens-cell]').getAttribute('data-lens-cell'))).toEqual(['5'])
    expect(near[0].textContent).toBe('경계 근접')
    expect(container.querySelector('[data-lens-cell="2"] [data-flip-gauge]')).toBeTruthy()   // false 게이지는 있다
  })

  it('ⓕ 새 필드가 전부 없는 옛 판도 오류 없이 렌더(새 표시만 생략)', async () => {
    const { container } = await renderWith(V2_REPORT)
    expect(container.querySelectorAll('[data-lens-cell]').length).toBe(9)
    expect(container.querySelectorAll('[data-near-boundary],[data-lens-basis]').length).toBe(0)
    expect(screen.queryByText('애널 추정치')).toBeNull()
    expect([...container.querySelectorAll('[data-lens-name]')].length).toBe(9)
  })
})

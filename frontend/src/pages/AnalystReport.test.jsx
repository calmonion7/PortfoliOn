import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import AnalystReport, { PerBandChart, PeerMultiplesChart, RATING_META, assignLabelRows } from './AnalystReport'
import api from '../api'

vi.mock('../api', () => ({ default: { get: vi.fn() } }))

const REPORT = {
  ticker: '005930', published_date: '2026-07-25', rating: 'buy',
  title: '한줄 논지 테스트', fair_value_low: 80000, fair_value_high: 95000,
  name: '삼성전자', market: 'KR',
  valuation_method: 'PER 밴드 산정',
  points: [
    { title: '포인트A', body: '근거A' },
    { title: '포인트B', body: '근거B' },
  ],
  risks: '리스크 서술',
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
  it('전 섹션 렌더 — 헤더·논지·포인트·밸류에이션·추정·리스크', async () => {
    api.get.mockResolvedValue({ data: REPORT })
    const { container } = renderPage()
    expect(await screen.findByText('한줄 논지 테스트')).toBeTruthy()
    expect(screen.getByText('삼성전자')).toBeTruthy()
    expect(screen.getByText('매수')).toBeTruthy()          // rating 의미 배지
    expect(screen.getByText('투자 포인트')).toBeTruthy()
    expect(screen.getByText('포인트A')).toBeTruthy()
    expect(screen.getByText('밸류에이션')).toBeTruthy()
    expect(screen.getAllByText('SK하이닉스').length).toBe(5)  // 피어 차트 — 지표당 1행 (task#220)
    expect(container.querySelector('table')).toBeNull()    // 피어 표는 차트로 대체됨(task#220)
    expect(screen.getByText('실적 추정')).toBeTruthy()
    // 차트 틱은 jsdom(0크기 컨테이너)에서 미렌더 — 범례·캡션으로 차트화 검증(task#217)
    expect(screen.getByText('매출(원)')).toBeTruthy()
    expect(screen.getByText(/\(E\) = 컨센서스 추정/)).toBeTruthy()
    expect(screen.getByText('리스크 요인')).toBeTruthy()
    expect(screen.getByText('리스크 서술')).toBeTruthy()
  })

  it('칩 열 수는 칩 개수에 맞춤 — ≤3개는 1행, 4개는 2열(task#225)', async () => {
    const withMetrics = (n) => ({
      ...REPORT,
      points: [{ title: '포인트A', body: '근거A', metrics: Array.from({ length: n }, (_, i) => ({ label: `L${i}`, value: `${i}배` })) }],
    })
    for (const [n, expected] of [[2, 2], [3, 3], [4, 2]]) {
      api.get.mockResolvedValue({ data: withMetrics(n) })
      const { container, unmount } = renderPage()
      await screen.findByText('한줄 논지 테스트')
      const grid = [...container.querySelectorAll('div')].find(d => /^repeat\(\d/.test(d.style.gridTemplateColumns || ''))
      expect(grid.style.gridTemplateColumns).toBe(`repeat(${expected}, minmax(0, 1fr))`)
      unmount()
    }
  })

  it('지표 칩 증감은 이중 부호가 되지 않고 소수 자릿수도 정본을 따른다(task#281 F5)', async () => {
    // 정본 ChangeBadge = `▼ 12.5%`(화살표가 부호를 대신, toFixed(1)). 전엔 `▼-12.5%`로 음수 두 번.
    // ⚠️ 선도기술 KeyPointCards.jsx가 이 블록을 미러링한다 — 한쪽만 고치면 두 표면 표기가 갈라진다.
    //    양쪽에 같은 케이스의 회귀 테스트를 쌍으로 둔다.
    api.get.mockResolvedValue({ data: { ...REPORT, points: [{
      title: '포인트A', body: '근거A',
      metrics: [
        { label: 'L0', value: 'V0', change_pct: -12.5 },
        { label: 'L1', value: 'V1', change_pct: -150 },
        { label: 'L2', value: 'V2', change_pct: 22.123456789 },
        { label: 'L3', value: 'V3', change_pct: 233.33 },
      ],
    }] } })
    const { container } = renderPage()
    await screen.findByText('한줄 논지 테스트')
    const chips = [...container.querySelectorAll('div.mono.tnum')].map(d => d.textContent)
    for (const want of ['▼12.5%', '▼150%', '▲+22.1%', '▲+233%']) expect(chips).toContain(want)
    expect(chips.some(t => /[▲▼][+-]?-/.test(t))).toBe(false)   // 이중 부호 0건
  })

  it('문서 하단 복귀 링크 제거 + 플로팅 목록 pill(task#225)', async () => {
    api.get.mockResolvedValue({ data: REPORT })
    const { container } = renderPage()
    await screen.findByText('한줄 논지 테스트')
    expect([...container.querySelectorAll('a')].some(a => a.textContent.trim() === '← 심층 리포트')).toBe(false)
    const pill = container.querySelector('.list-pill')
    expect(pill?.getAttribute('href')).toBe('/analyst-reports')
  })

  it('용어집 배선 — 지표 라벨·본문에 glossary-term 버튼(task#220)', async () => {
    api.get.mockResolvedValue({ data: REPORT })
    const { container } = renderPage()
    await screen.findByText('한줄 논지 테스트')
    // 피어 차트 지표명(R&D집약도 신규 용어) + Stat 라벨(적정주가 밴드) + 본문(PER 밴드 산정의 PER)
    expect(screen.getByRole('button', { name: 'R&D집약도' })).toBeTruthy()
    expect(screen.getByRole('button', { name: '적정주가 밴드' })).toBeTruthy()
    expect(container.querySelectorAll('.glossary-term').length).toBeGreaterThanOrEqual(5)
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

  it('data.market_outlook.segments 있으면 사업부문 시장 분석 섹션이 밸류에이션 앞에 렌더된다(task#275)', async () => {
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
    // 투자 포인트 다음 · 밸류에이션 앞 위치 확인
    const titles = [...container.querySelectorAll('.rpt-title__text')].map(el => el.textContent)
    const pointsIdx = titles.findIndex(t => t.includes('투자 포인트'))
    const segIdx = titles.findIndex(t => t.includes('사업부문 시장 분석'))
    const valIdx = titles.findIndex(t => t.includes('밸류에이션'))
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

describe('RATING_META', () => {
  it('가격색(up/down)이 아닌 의미 배지 variant만 사용(task#194 가토)', () => {
    for (const meta of Object.values(RATING_META)) {
      expect(['success', 'neutral', 'danger']).toContain(meta.variant)
    }
  })
})

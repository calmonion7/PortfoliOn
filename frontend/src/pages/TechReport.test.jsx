import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import TechReport from './TechReport'
import api from '../api'

vi.mock('../api', () => ({ default: { get: vi.fn() } }))

const REPORT = {
  slug: 'reusable-rocket', published_date: '2026-08-03',
  title: '재사용 발사체, 궤도당 비용을 다시 쓴다',
  description: '1단 재사용이 발사비를 낮추는 구조를 설명한다.',
  difficulty: { score: 4, rationale: '극저온 추진제 재점화가 어렵다.' },
  players: [
    // leader_name은 "무엇 대비인지" = 선두 **업체명**이다(CLAUDE_COWORK_API.md 정의). 인명을 넣으면
    // `선두 대비 5년 · Elon Musk`처럼 오표기가 된다 — 이 픽스처의 옛 인명 값이 실제로 오도를 낳았다(task#277).
    { name: 'SpaceX', country: 'US', state_led: false, ticker: null, tech_level: 5, gap_years: 0, leader_name: 'SpaceX', share_pct: 60.0, note: '재사용 1위' },
    { name: 'CASC', country: 'CN', state_led: true, ticker: null, tech_level: 3, gap_years: 5, leader_name: 'SpaceX', share_pct: null, note: null },
  ],
  challenges: [{ title: '재점화 신뢰성', body: '다회 재점화 엔진 내구성.' }],
  related: { prerequisites: [], derivatives: [], complements: [], competitors: [] },
  market: {
    history: [{ year: 2024, size: { value: 12.5, currency: 'USD', unit: 'bn' } }],
    forecast: [{ year: 2030, size: { value: 30.5, currency: 'USD', unit: 'bn' } }],
    cagr_pct: 12.3, share_basis: '발사 횟수 기준', as_of: '2026-08-03',
  },
  sources: [{ title: 'NASA', url: null }],
}

function renderAt(slug) {
  return render(
    <MemoryRouter initialEntries={[`/tech-report/${slug}`]}>
      <Routes>
        <Route path="/tech-report/:slug" element={<TechReport />} />
      </Routes>
    </MemoryRouter>
  )
}

beforeEach(() => vi.clearAllMocks())

describe('선도기술 리포트 상세 (task#276 S5)', () => {
  it('전 섹션 렌더 — 헤더·업체 표·난제·시장 규모·출처', async () => {
    api.get.mockImplementation((url) =>
      url === '/api/tech-reports/reusable-rocket'
        ? Promise.resolve({ data: { slug: 'reusable-rocket', reports: [REPORT] } })
        : Promise.resolve({ data: [] }))
    renderAt('reusable-rocket')
    expect(await screen.findByText('재사용 발사체, 궤도당 비용을 다시 쓴다')).toBeTruthy()
    expect(screen.getByText('재사용 로켓')).toBeTruthy()
    expect(screen.getByText('난이도 4/5')).toBeTruthy()
    expect(screen.getByText('1단 재사용이 발사비를 낮추는 구조를 설명한다.')).toBeTruthy()
    expect(screen.getByText('극저온 추진제 재점화가 어렵다.')).toBeTruthy()

    // 업체 표 — 기술 성숙 단계는 텍스트로만(5칸 밴드는 별도 시각화)
    // task#277 S5가 TechLevelBand·ShareChart를 배선해 업체명·"현재 선두"가 페이지에 다시
    // 등장한다(정당한 중복 — 비교 섹션이라 같은 이름을 또 보여줘야 한다). 이 축(표를 특정)을
    // 결정한 문서는 없다(부수적 단언) — within(tech-report-players)로 표 자체를 스코프한다.
    const playersTable = within(screen.getByTestId('tech-report-players'))
    expect(playersTable.getByText('SpaceX')).toBeTruthy()
    expect(playersTable.getByText('5단계 · 양산상용')).toBeTruthy()
    expect(playersTable.getByText('현재 선두')).toBeTruthy()   // gap_years === 0
    expect(playersTable.getByText('CASC')).toBeTruthy()
    expect(playersTable.getByText('3단계 · 실증')).toBeTruthy()
    expect(playersTable.getByText('선두 대비 5년 · SpaceX')).toBeTruthy()
    expect(playersTable.getByText('정부주도')).toBeTruthy()     // CASC만 state_led
    expect(screen.getByText('점유율 기준: 발사 횟수 기준')).toBeTruthy()

    expect(screen.getByText('재점화 신뢰성')).toBeTruthy()
    expect(screen.getByText('다회 재점화 엔진 내구성.')).toBeTruthy()

    expect(screen.getByTestId('tech-report-market-summary').textContent).toBe('$12.5B (2024) → $30.5B (2030), CAGR 12.3%')
    expect(screen.getByText('2026-08-03 기준')).toBeTruthy()
    expect(screen.getByText('NASA')).toBeTruthy()
  })

  it('발행물 없음 — 빈 상태(에러와 구별)', async () => {
    api.get.mockResolvedValue({ data: { slug: 'robotics', reports: [] } })
    renderAt('robotics')
    expect(await screen.findByText(/아직 발행된 리포트가 없습니다/)).toBeTruthy()
  })

  it('조회 실패(404가 아닌 오류) — 에러 문구', async () => {
    api.get.mockRejectedValue({ response: { status: 500 } })
    renderAt('robotics')
    await waitFor(() => expect(screen.getByText('리포트를 불러오지 못했습니다.')).toBeTruthy())
  })

  it('미등록 slug(422) — 전용 에러 문구', async () => {
    api.get.mockRejectedValue({ response: { status: 422 } })
    renderAt('nonsense')
    await waitFor(() => expect(screen.getByText('존재하지 않는 기술입니다.')).toBeTruthy())
  })

  it('ticker 보유 종목이면 보유 배지 노출', async () => {
    const withTicker = { ...REPORT, players: [{ ...REPORT.players[0], ticker: 'RKLB' }] }
    api.get.mockImplementation((url) =>
      url === '/api/tech-reports/reusable-rocket'
        ? Promise.resolve({ data: { reports: [withTicker] } })
        : Promise.resolve({ data: [{ ticker: 'RKLB', name: 'Rocket Lab', type: 'holding', market: 'US' }] }))
    renderAt('reusable-rocket')
    // task#277 S5: TechLevelBand·ShareChart도 SpaceX를 표시하므로 표 스코프로 특정한다.
    await within(await screen.findByTestId('tech-report-players')).findByText('SpaceX')
    expect(await screen.findByText('보유')).toBeTruthy()
  })

  it('gap_years 음수는 표시하지 않는다 — 표와 밴드가 같은 규율을 쓴다', async () => {
    // backend Player.gap_years에 ge=0 제약이 없어 음수가 발행될 수 있고, 그러면 `선두 대비 -2년`이라는
    // 무의미한 문구가 렌더됐다(적대적 리뷰 렌즈1). TechLevelBand는 고쳐졌는데 이 표는 안 고쳐져
    // **같은 필드가 같은 페이지에서 두 거동**을 갖고 있었다 — 한쪽 테스트가 다른 쪽을 보호하지 않는다.
    const negative = { ...REPORT, players: [{ ...REPORT.players[1], gap_years: -2 }] }
    api.get.mockImplementation((url) =>
      url === '/api/tech-reports/reusable-rocket'
        ? Promise.resolve({ data: { reports: [negative] } })
        : Promise.resolve({ data: [] }))
    renderAt('reusable-rocket')
    const table = within(await screen.findByTestId('tech-report-players'))
    expect(await table.findByText('CASC')).toBeTruthy()
    expect(table.queryByText(/-2년/)).toBeNull()
    expect(table.queryByText(/선두 대비/)).toBeNull()
  })
})

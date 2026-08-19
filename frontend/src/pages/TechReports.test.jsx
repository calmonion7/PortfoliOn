import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import TechReports from './TechReports'
import api from '../api'

vi.mock('../api', () => ({ default: { get: vi.fn() } }))

const REPORTS = [
  {
    slug: 'smr', published_date: '2026-08-03', title: 'SMR, 원전의 다음 세대',
    difficulty: { score: 4, rationale: '인허가 리스크' },
    players: [{ name: 'NuScale' }, { name: 'Rosatom' }],
    market: {
      history: [{ year: 2024, size: { value: 5.2, currency: 'USD', unit: 'bn' } }],
      forecast: [{ year: 2035, size: { value: 40, currency: 'USD', unit: 'bn' } }],
      cagr_pct: 20.1, as_of: '2026-08-03',
    },
  },
]

function renderPage() {
  return render(<MemoryRouter><TechReports /></MemoryRouter>)
}

beforeEach(() => vi.clearAllMocks())

describe('주요기술 리포트 목록 (task#276 S5, 개명 ADR-0038)', () => {
  it('목록 카드 렌더 — 표시명·제목·갱신일·난이도·업체 수·시장 요약', async () => {
    api.get.mockResolvedValue({ data: { reports: REPORTS } })
    renderPage()
    expect(await screen.findByText('SMR, 원전의 다음 세대')).toBeTruthy()
    expect(screen.getByText('SMR')).toBeTruthy()
    expect(screen.getByText('4/5')).toBeTruthy()
    expect(screen.getByText('2개')).toBeTruthy()
    expect(screen.getByText('2026-08-03 갱신')).toBeTruthy()
    expect(screen.getByText('$5.2B (2024) → $40B (2035), CAGR 20.1%')).toBeTruthy()
    // ⚠️ task#306: 카드 전체가 <a>였는데 「해부」 링크가 추가되며 풀렸다(앵커 중첩은 무효 마크업).
    // 계약("카드를 눌러 리포트로 간다")은 그대로이고 그것을 담는 요소만 바뀌었으므로, 단언을
    // 카드 자신의 href에서 본문 Link로 옮긴다 — task#276 계획의 완료기준·비목표 어디에도
    // "카드 루트가 앵커일 것"은 없다(부수적 단언이지 기록된 결정이 아님, CLAUDE.md task#264 판별).
    const card = screen.getByTestId('tech-report-card')
    expect(card.getAttribute('href')).toBe(null)
    expect(within(card).getByTestId('card-to-report').getAttribute('href')).toBe('/tech-report/smr')
  })

  it('카드에 「리포트 / 해부」 두 진입점 — 해부 미기입이면 배지가 붙는다 (task#306)', async () => {
    api.get.mockResolvedValue({ data: { reports: REPORTS } })
    renderPage()
    const card = await screen.findByTestId('tech-report-card')
    expect(within(card).getByTestId('card-link-report').getAttribute('href')).toBe('/tech-report/smr')
    expect(within(card).getByTestId('card-link-anatomy').getAttribute('href')).toBe('/tech-anatomy/smr')
    // 픽스처에 composition이 없으므로 미작성 배지가 뜬다 — 이 픽스처가 그 분기를 실제로 타는지
    // 게이트 식을 직접 적용해 못박는다(이빨과 분기 커버리지는 다른 축, task#301).
    expect(REPORTS[0].composition == null).toBe(true)
    expect(within(card).getByTestId('card-anatomy-pending')).toBeTruthy()
  })

  it('composition이 있으면 미작성 배지가 없다 (반대 분기)', async () => {
    api.get.mockResolvedValue({ data: { reports: [{ ...REPORTS[0], composition: { experts: [] } }] } })
    renderPage()
    const card = await screen.findByTestId('tech-report-card')
    expect(within(card).getByTestId('card-link-anatomy')).toBeTruthy()
    expect(within(card).queryByTestId('card-anatomy-pending')).toBeNull()
  })

  it('빈 목록 — 빈 상태 문구', async () => {
    api.get.mockResolvedValue({ data: { reports: [] } })
    renderPage()
    expect(await screen.findByText('발행된 주요기술 리포트가 없습니다.')).toBeTruthy()
  })

  it('조회 실패 — 에러 문구(빈 상태와 구별, 에러 정직성)', async () => {
    api.get.mockRejectedValue(new Error('network'))
    renderPage()
    await waitFor(() => expect(screen.getByText('목록을 불러오지 못했습니다.')).toBeTruthy())
    expect(screen.queryByText('발행된 주요기술 리포트가 없습니다.')).toBeNull()
  })
})

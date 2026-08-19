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

  it('카드 앵커는 정확히 2개 — 본문(리포트) + 「해부」 버튼, 미작성이면 라벨이 흐려진다 (task#309)', async () => {
    api.get.mockResolvedValue({ data: { reports: REPORTS } })
    renderPage()
    const card = await screen.findByTestId('tech-report-card')
    // ⚠️ task#309: 옛 판은 하단에 「리포트」 링크(`card-link-report`)를 따로 뒀고 이 테스트가 그것을
    // 단언했다. 본문 Link(`card-to-report`)와 목적지가 같은 두 번째 앵커라 제거했고, 그래서 그
    // 단언도 뒤집는다 — task#306 계획의 완료기준은 "목록 → 해부 → 리포트 → 해부 왕복이 라이브에서
    // 동작"이고 비목표 어디에도 「두 링크」가 없다(부수적 단언이지 기록된 결정이 아님, task#264 판별).
    // 개수만 세면 본문 Link가 사라지고 해부 버튼이 2개인 판에서도 통과하므로 href **집합**을 본다.
    const hrefs = [...card.querySelectorAll('a[href]')].map((a) => a.getAttribute('href'))
    expect(hrefs.length).toBe(2)
    expect(new Set(hrefs)).toEqual(new Set(['/tech-report/smr', '/tech-anatomy/smr']))
    expect(within(card).getByTestId('card-link-anatomy').getAttribute('href')).toBe('/tech-anatomy/smr')
    // 픽스처에 composition이 없으므로 미작성 라벨이 뜬다 — 이 픽스처가 그 분기를 실제로 타는지
    // 게이트 식을 직접 적용해 못박는다(이빨과 분기 커버리지는 다른 축, task#301).
    expect(REPORTS[0].composition == null).toBe(true)
    const pending = within(card).getByTestId('card-anatomy-pending')
    expect(pending.textContent).toBe('해부 미작성')
    expect(pending.style.color).toBe('var(--text-3)')
    // 톤만 흐려질 뿐 **여전히 클릭 가능**하다(ADR-0042 결정 6 — 숨기지 않는다).
    expect(within(card).getByTestId('card-link-anatomy').getAttribute('href')).toBeTruthy()
  })

  it('composition이 있으면 라벨이 「해부 보기 →」이고 미작성 표기가 없다 (반대 분기)', async () => {
    api.get.mockResolvedValue({ data: { reports: [{ ...REPORTS[0], composition: { experts: [] } }] } })
    renderPage()
    const card = await screen.findByTestId('tech-report-card')
    expect(within(card).getByTestId('card-link-anatomy').textContent).toBe('해부 보기 →')
    expect(within(card).queryByTestId('card-anatomy-pending')).toBeNull()
    expect([...card.querySelectorAll('a[href]')].length).toBe(2)
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

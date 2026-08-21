import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import ReportDetailTabs from './ReportDetailTabs'

// task#324 (ADR-0047) — 심층 리포트를 리포트 상세의 탭으로 흡수한다.
// 채택 조건은 컴포넌트 자신이 판정한다(publications.length > 0) → publications를 넘기지 않는
// 호출부(Ranking.jsx 모달)는 손대지 않아도 4탭이 유지된다. 그 「손대지 않음」을 대조군으로 못박는다.

const PUB = { ticker: '005930', published_date: '2026-07-25', name: '삼성전자' }

const REPORT_DOC = {
  ticker: '005930', published_date: '2026-07-25', rating: 'buy',
  title: '한줄 논지', fair_value_low: 80000, fair_value_high: 95000,
  name: '삼성전자', market: 'KR', points: [{ title: '포인트A', body: '근거A' }],
  risks: '리스크 서술',
  data: { snapshot_date: '2026-07-25', price: 90000, market: 'KR', name: '삼성전자' },
}

vi.mock('../../hooks/useIsMobile', () => ({ default: () => false }))   // jsdom엔 matchMedia가 없다
vi.mock('../../api', () => ({
  default: {
    get: vi.fn((url) => {
      if (/\/api\/analyst-reports\/[^/]+\/[^/]+$/.test(url)) return Promise.resolve({ data: REPORT_DOC })
      if (/\/api\/analyst-reports\/[^/]+$/.test(url)) return Promise.resolve({ data: { reports: [{ published_date: '2026-07-25' }, { published_date: '2026-06-30' }] } })
      return Promise.resolve({ data: {} })
    }),
  },
}))

const SUMMARY = { market: 'KR', name: '삼성전자', price: 90000 }

const renderTabs = (props = {}) => render(
  <MemoryRouter>
    <ReportDetailTabs summary={SUMMARY} ticker="005930" {...props} />
  </MemoryRouter>
)

const tabLabels = (container) =>
  [...container.querySelectorAll('button.tab-btn')].map(b => b.textContent.trim())

beforeEach(() => vi.clearAllMocks())

describe('리포트 상세 탭 — 심층 리포트 흡수 (task#324)', () => {
  it('발행물이 있으면 탭 5개이고 「심층 리포트」가 그중 하나다', () => {
    const { container } = renderTabs({ publications: [PUB] })
    const labels = tabLabels(container)
    expect(labels.length).toBe(5)
    expect(labels.some(l => l.includes('심층 리포트'))).toBe(true)
  })

  it('탭을 누르면 발행물 본문이 실제로 렌더된다 — 투자의견 배지 + 적정주가 밴드', async () => {
    // 「탭이 5개다」만 세면 내용이 빈 탭도 통과한다 → 본문 렌더까지 단언한다(계획서의 자기반박 항목).
    const { container } = renderTabs({ publications: [PUB] })
    const deep = [...container.querySelectorAll('button.tab-btn')].find(b => b.textContent.includes('심층 리포트'))
    fireEvent.click(deep)
    expect(await screen.findByText('한줄 논지')).toBeTruthy()
    expect(screen.getByText('매수')).toBeTruthy()               // 투자의견 배지
    expect(screen.getByText('적정주가 밴드')).toBeTruthy()       // 밴드 게이지 라벨
    expect(screen.getByText('리스크 요인')).toBeTruthy()
  })

  it('탭 안에서 이전 판으로 갈아탄다 — 라우팅으로 탭을 벗어나지 않는다', async () => {
    const { container } = renderTabs({ publications: [PUB] })
    fireEvent.click([...container.querySelectorAll('button.tab-btn')].find(b => b.textContent.includes('심층 리포트')))
    await screen.findByText('한줄 논지')
    const older = [...container.querySelectorAll('button.mono')].find(b => b.textContent.trim() === '2026-06-30')
    expect(older).toBeTruthy()                                  // Link가 아니라 button — 탭 안에서 판을 바꾼다
    expect(container.querySelector('a[href^="/analyst-report/"]')).toBeNull()
    fireEvent.click(older)
    await screen.findByText('한줄 논지')
    expect(tabLabels(container).length).toBe(5)                 // 여전히 탭 안이다
  })

  it('발행물이 없으면 탭 4개 (대조군)', () => {
    const { container } = renderTabs({ publications: [] })
    const labels = tabLabels(container)
    expect(labels.length).toBe(4)
    expect(labels.some(l => l.includes('심층 리포트'))).toBe(false)
  })

  it('publications를 아예 안 넘기면(랭킹 모달 경로) 탭 4개 (대조군)', () => {
    const { container } = renderTabs()
    expect(tabLabels(container).length).toBe(4)
    expect(tabLabels(container).some(l => l.includes('심층 리포트'))).toBe(false)
  })

  it('ETF 필터는 불변 — 요약·사업분석이 빠지고 발행물이 있으면 심층 리포트는 남는다', () => {
    const { container } = renderTabs({ summary: { ...SUMMARY, is_etf: true }, publications: [PUB] })
    const labels = tabLabels(container)
    expect(labels.some(l => l.includes('요약'))).toBe(false)
    expect(labels.some(l => l.includes('사업분석'))).toBe(false)
    expect(labels.some(l => l.includes('지표'))).toBe(true)
    expect(labels.some(l => l.includes('히스토리'))).toBe(true)
  })
})

describe('enrich 탭 개명 — 옛 이름을 「사업분석」으로 (task#324 S3)', () => {
  it('「사업분석」 라벨이 렌더된다 (양성 축 — grep 0은 라벨 삭제로도 만들어진다)', () => {
    const { container } = renderTabs({ publications: [] })
    // 옛 이름의 *부재*를 문자열로 단언하면 그 문자열이 소스에 남아 개명 감사(grep)를 오염시킨다.
    // 그래서 라벨 **집합 전체**를 못박는다 — 부재 단언보다 강하다(순서·오탈자·유령 탭까지 잡는다).
    expect(tabLabels(container)).toEqual(['📊 요약', '📈 지표', '📝 사업분석', '📅 히스토리'])
  })

  it('발행물이 있으면 라벨 집합은 5개이고 「심층 리포트」가 사업분석 다음이다', () => {
    const { container } = renderTabs({ publications: [PUB] })
    expect(tabLabels(container)).toEqual(['📊 요약', '📈 지표', '📝 사업분석', '🎯 심층 리포트', '📅 히스토리'])
  })

  it('탭 key는 report로 유지된다 — 개명은 라벨만이고 분석 이벤트 페이로드는 불변이다(task#251)', () => {
    const onTabChange = vi.fn()
    const { container } = renderTabs({ publications: [], onTabChange })
    fireEvent.click([...container.querySelectorAll('button.tab-btn')].find(b => b.textContent.includes('사업분석')))
    expect(onTabChange).toHaveBeenCalledWith('report')
  })
})

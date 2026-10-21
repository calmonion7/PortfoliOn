import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

const authMock = vi.fn(() => ({
  menuPermissions: ['research', 'portfolio', 'market', 'guru'],
  role: 'user',
  loading: false,
}))
vi.mock('../contexts/AuthContext', () => ({ useAuth: () => authMock() }))
vi.mock('../utils/analytics', () => ({ trackEvent: vi.fn() }))
vi.mock('../api', () => ({ default: { get: vi.fn() } }))
vi.mock('../hooks/useIsMobile', () => ({ default: () => true }))

import Masthead from '../components/Masthead'
import MobileNav from '../components/MobileNav'
import ResearchShell from '../pages/ResearchShell'
import { ToastProvider } from '../components/Toast'

// task#251: 같은 IA(마스트헤드 5섹션)를 세 곳에 수기 복제한 탓에 심층 리포트 상세
// `/analyst-report/{ticker}/{date}`에서 세 표면 모두 "지금 어디인가"를 잃었다(버그리포트 M1+M3).
// 목록 `/analyst-reports`와 상세 두 경로를 세 소비처에 각각 먹여 active 표시를 단언한다.
// jsdom은 여기서 블라인드가 아니다 — 레이아웃이 아니라 className 존재 여부를 본다.
const LIST = '/analyst-reports'
const DETAIL = '/analyst-report/000660/2026-07-30'
const TECH_LIST = '/tech-reports'
const TECH_DETAIL = '/tech-report/smr'

const noop = () => {}

function renderAt(path, ui) {
  return render(
    <ToastProvider>
      <MemoryRouter initialEntries={[path]}>{ui}</MemoryRouter>
    </ToastProvider>
  )
}

// task#396(ADR-0047 결정 5 개정): 리서치 탭이 「리포트·심층·기술·추천·랭킹·비교」가 됐다.
// 「심층」이 심층 리포트 목록·문서를 함께 덮고(match `/analyst-report`), 「리포트」는 `/reports`만 잡는다.
// 위 task#251의 계약(세 표면 모두 "지금 어디인가"를 유지한다)은 그대로다 — 강조되는 항목만 바뀌었다.
// 각 active 단언은 **형제 「리포트」의 비-active 대조군과 쌍**이다 — 「모든 경로에서 둘 다 active」인 구현을 배제한다.
const RESEARCH_ORDER = ['리포트', '심층', '기술', '추천', '랭킹', '비교']

describe('리서치 탭 순서 (task#396)', () => {
  it('Masthead 서브바 순서가 리포트·심층·기술·추천·랭킹·비교다', () => {
    const { container } = renderAt('/reports', <Masthead theme="light" setTheme={noop} onLogout={noop} />)
    const labels = [...container.querySelectorAll('.masthead-subbar a')].map(a => a.textContent.trim())
    expect(labels).toEqual(RESEARCH_ORDER)
  })

  it('ResearchShell seg 순서가 리포트·심층·기술·추천·랭킹·비교다', () => {
    const { container } = renderAt('/reports', <ResearchShell><div>CHILD</div></ResearchShell>)
    const labels = [...container.querySelectorAll('.seg a')].map(a => a.textContent.trim())
    expect(labels).toEqual(RESEARCH_ORDER)
  })
})

describe('Masthead 서브바 — 심층이 심층 리포트 경로를 덮는다', () => {
  it.each([
    ['목록', LIST],
    ['문서 상세', DETAIL],
  ])('%s(%s)에서 "심층"이 active이고 "리포트"는 아니다', (_label, path) => {
    const { container } = renderAt(path, <Masthead theme="light" setTheme={noop} onLogout={noop} />)
    expect(container.querySelector('.masthead-subbar'), '리서치 서브바 노드').not.toBeNull()
    expect(screen.getByRole('link', { name: '심층' }).className).toContain('is-active')
    expect(screen.getByRole('link', { name: '리포트' }).className).not.toContain('is-active')
  })

  it('대조군 — 종목 리포트(/reports)에서는 "리포트"가 active이고 "심층"은 아니다', () => {
    renderAt('/reports', <Masthead theme="light" setTheme={noop} onLogout={noop} />)
    expect(screen.getByRole('link', { name: '리포트' }).className).toContain('is-active')
    expect(screen.getByRole('link', { name: '심층' }).className).not.toContain('is-active')
  })

  it('부정 대조군 — 기술 상세에서는 "리포트"가 active가 아니다', () => {
    renderAt(TECH_DETAIL, <Masthead theme="light" setTheme={noop} onLogout={noop} />)
    expect(screen.getByRole('link', { name: '기술' }).className).toContain('is-active')
    expect(screen.getByRole('link', { name: '리포트' }).className).not.toContain('is-active')
  })
})

// task#276 S5 — 주요기술 리포트 탭 추가(navSections.js 단일 소스 한 줄). analyst-report와
// 동형으로 단수 match('/tech-report')가 목록·상세를 함께 덮어야 세 표면 모두 "지금
// 어디인가"를 유지한다. task#396에서 nav 라벨만 「기술」로 줄었다(문서 명칭은 「주요기술 리포트」 그대로).
describe('Masthead 서브바 — 기술', () => {
  it.each([
    ['목록', TECH_LIST],
    ['상세', TECH_DETAIL],
  ])('%s(%s)에서 리서치 서브바가 뜨고 "기술"이 active다', (_label, path) => {
    const { container } = renderAt(path, <Masthead theme="light" setTheme={noop} onLogout={noop} />)
    const subbar = container.querySelector('.masthead-subbar')
    expect(subbar, '리서치 서브바 노드').not.toBeNull()
    const link = screen.getByRole('link', { name: '기술' })
    expect(link.className).toContain('is-active')
  })
})

describe('MobileNav 하단 탭바 — 리서치', () => {
  it.each([
    ['목록', LIST],
    ['상세', DETAIL],
    ['기술 목록', TECH_LIST],
    ['기술 상세', TECH_DETAIL],
  ])('%s(%s)에서 "리서치" 탭이 active다', (_label, path) => {
    renderAt(path, <MobileNav />)
    const tab = screen.getByRole('link', { name: '리서치' })
    expect(tab.className).toContain('is-active')
  })
})

describe('ResearchShell seg — 심층이 심층 리포트 경로를 덮는다', () => {
  it.each([
    ['목록', LIST],
    ['문서 상세', DETAIL],
  ])('%s(%s)에서 seg "심층"이 active이고 "리포트"는 아니다', (_label, path) => {
    renderAt(path, <ResearchShell><div>CHILD</div></ResearchShell>)
    expect(screen.getByRole('link', { name: '심층' }).className).toContain('is-active')
    expect(screen.getByRole('link', { name: '리포트' }).className).not.toContain('is-active')
  })

  it('대조군 — 종목 리포트(/reports)에서는 seg "리포트"가 active이고 "심층"은 아니다', () => {
    renderAt('/reports', <ResearchShell><div>CHILD</div></ResearchShell>)
    expect(screen.getByRole('link', { name: '리포트' }).className).toContain('is-active')
    expect(screen.getByRole('link', { name: '심층' }).className).not.toContain('is-active')
  })

  it('부정 대조군 — 기술 상세에서는 seg "리포트"가 active가 아니다', () => {
    renderAt(TECH_DETAIL, <ResearchShell><div>CHILD</div></ResearchShell>)
    expect(screen.getByRole('link', { name: '기술' }).className).toContain('is-active')
    expect(screen.getByRole('link', { name: '리포트' }).className).not.toContain('is-active')
  })
})

describe('ResearchShell seg — 기술', () => {
  it.each([
    ['목록', TECH_LIST],
    ['상세', TECH_DETAIL],
  ])('%s(%s)에서 seg "기술"이 active다', (_label, path) => {
    renderAt(path, <ResearchShell><div>CHILD</div></ResearchShell>)
    const tab = screen.getByRole('link', { name: '기술' })
    expect(tab.className).toContain('is-active')
  })
})

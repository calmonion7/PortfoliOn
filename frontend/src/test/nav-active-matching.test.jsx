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

// task#324(ADR-0047): 「심층 리포트」 nav 항목이 제거되고 그 경로들이 「리포트」 항목에 흡수됐다.
// 위 task#251의 계약(세 표면 모두 "지금 어디인가"를 유지한다)은 그대로다 — 강조되는 항목만 바뀌었다.
// 이것은 축의 **완화가 아니라 등가 재작성**이다: 아래 부정 대조군이 「모든 경로에서 리포트가 active」인
// 구현을 배제하므로 판별력이 줄지 않는다.
describe('Masthead 서브바 — 리포트가 심층 경로를 흡수', () => {
  it.each([
    ['목록(=admin 발행 관리)', LIST],
    ['문서 상세', DETAIL],
    ['종목 리포트', '/reports'],
  ])('%s(%s)에서 리서치 서브바가 뜨고 "리포트"가 active다', (_label, path) => {
    const { container } = renderAt(path, <Masthead theme="light" setTheme={noop} onLogout={noop} />)
    const subbar = container.querySelector('.masthead-subbar')
    expect(subbar, '리서치 서브바 노드').not.toBeNull()
    const link = screen.getByRole('link', { name: '리포트' })
    expect(link.className).toContain('is-active')
  })

  it('「심층 리포트」 항목은 nav에 더 이상 없다', () => {
    renderAt(DETAIL, <Masthead theme="light" setTheme={noop} onLogout={noop} />)
    expect(screen.queryByRole('link', { name: '심층 리포트' })).toBeNull()
  })

  it('부정 대조군 — 주요기술 상세에서는 "리포트"가 active가 아니다', () => {
    renderAt(TECH_DETAIL, <Masthead theme="light" setTheme={noop} onLogout={noop} />)
    expect(screen.getByRole('link', { name: '주요기술' }).className).toContain('is-active')
    expect(screen.getByRole('link', { name: '리포트' }).className).not.toContain('is-active')
  })
})

// task#276 S5 — 주요기술 리포트 탭 추가(navSections.js 단일 소스 한 줄). analyst-report와
// 동형으로 단수 match('/tech-report')가 목록·상세를 함께 덮어야 세 표면 모두 "지금
// 어디인가"를 유지한다.
describe('Masthead 서브바 — 주요기술', () => {
  it.each([
    ['목록', TECH_LIST],
    ['상세', TECH_DETAIL],
  ])('%s(%s)에서 리서치 서브바가 뜨고 "주요기술"이 active다', (_label, path) => {
    const { container } = renderAt(path, <Masthead theme="light" setTheme={noop} onLogout={noop} />)
    const subbar = container.querySelector('.masthead-subbar')
    expect(subbar, '리서치 서브바 노드').not.toBeNull()
    const link = screen.getByRole('link', { name: '주요기술' })
    expect(link.className).toContain('is-active')
  })
})

describe('MobileNav 하단 탭바 — 리서치', () => {
  it.each([
    ['목록', LIST],
    ['상세', DETAIL],
    ['주요기술 목록', TECH_LIST],
    ['주요기술 상세', TECH_DETAIL],
  ])('%s(%s)에서 "리서치" 탭이 active다', (_label, path) => {
    renderAt(path, <MobileNav />)
    const tab = screen.getByRole('link', { name: '리서치' })
    expect(tab.className).toContain('is-active')
  })
})

describe('ResearchShell seg — 리포트가 심층 경로를 흡수', () => {
  it.each([
    ['목록(=admin 발행 관리)', LIST],
    ['문서 상세', DETAIL],
    ['종목 리포트', '/reports'],
  ])('%s(%s)에서 seg "리포트"가 active다', (_label, path) => {
    renderAt(path, <ResearchShell><div>CHILD</div></ResearchShell>)
    const tab = screen.getByRole('link', { name: '리포트' })
    expect(tab.className).toContain('is-active')
  })

  it('부정 대조군 — 주요기술 상세에서는 seg "리포트"가 active가 아니다', () => {
    renderAt(TECH_DETAIL, <ResearchShell><div>CHILD</div></ResearchShell>)
    expect(screen.getByRole('link', { name: '주요기술' }).className).toContain('is-active')
    expect(screen.getByRole('link', { name: '리포트' }).className).not.toContain('is-active')
  })
})

describe('ResearchShell seg — 주요기술', () => {
  it.each([
    ['목록', TECH_LIST],
    ['상세', TECH_DETAIL],
  ])('%s(%s)에서 seg "주요기술"이 active다', (_label, path) => {
    renderAt(path, <ResearchShell><div>CHILD</div></ResearchShell>)
    const tab = screen.getByRole('link', { name: '주요기술' })
    expect(tab.className).toContain('is-active')
  })
})

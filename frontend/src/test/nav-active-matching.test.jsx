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

const noop = () => {}

function renderAt(path, ui) {
  return render(
    <ToastProvider>
      <MemoryRouter initialEntries={[path]}>{ui}</MemoryRouter>
    </ToastProvider>
  )
}

describe('Masthead 서브바 — 심층 리포트', () => {
  it.each([
    ['목록', LIST],
    ['상세', DETAIL],
  ])('%s(%s)에서 리서치 서브바가 뜨고 "심층 리포트"가 active다', (_label, path) => {
    const { container } = renderAt(path, <Masthead theme="light" setTheme={noop} onLogout={noop} />)
    const subbar = container.querySelector('.masthead-subbar')
    expect(subbar, '리서치 서브바 노드').not.toBeNull()
    const link = screen.getByRole('link', { name: '심층 리포트' })
    expect(link.className).toContain('is-active')
  })
})

describe('MobileNav 하단 탭바 — 리서치', () => {
  it.each([
    ['목록', LIST],
    ['상세', DETAIL],
  ])('%s(%s)에서 "리서치" 탭이 active다', (_label, path) => {
    renderAt(path, <MobileNav />)
    const tab = screen.getByRole('link', { name: '리서치' })
    expect(tab.className).toContain('is-active')
  })
})

describe('ResearchShell seg — 심층 리포트', () => {
  it.each([
    ['목록', LIST],
    ['상세', DETAIL],
  ])('%s(%s)에서 seg "심층 리포트"가 active다', (_label, path) => {
    renderAt(path, <ResearchShell><div>CHILD</div></ResearchShell>)
    const tab = screen.getByRole('link', { name: '심층 리포트' })
    expect(tab.className).toContain('is-active')
  })
})

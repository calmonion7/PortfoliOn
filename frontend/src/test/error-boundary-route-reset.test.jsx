// B48 — App.jsx의 실제 배선(AppShell): location.pathname을 anim-fade div의 key로 써서
// 라우트 전환마다 그 div를 remount한다. ErrorBoundary는 별도 key 없이 이 remount에 얹혀
// 리셋된다(App.jsx 주석 참조). 무거운 App.jsx(로그인 셸·useAuthBootstrap)는 import하지
// 않고(관례) 동일 패턴만 재현한다 — route-redirects.test.jsx와 같은 방식.
// 단언은 key 속성의 존재가 아니라 행동("이동하면 폴백이 사라지고 새 화면이 렌더된다")에 건다 —
// 누군가 key를 지우면(=ErrorBoundary가 remount되지 않으면) 이 단언이 깨져야 한다.
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter, Routes, Route, Link, useLocation, useNavigate } from 'react-router-dom'
import ErrorBoundary from '../components/ErrorBoundary'

function Boom() {
  throw new Error('route boom')
}

// App.jsx AppShell의 <div key={location.pathname}><ErrorBoundary>...</ErrorBoundary></div> 재현.
// 내비게이션 링크는 실제 앱처럼 경계 *밖*(Masthead/MobileNav 위치)에 둔다 — 경계 안에 두면
// throw 시 fallback이 자식을 통째로 대체해 링크 자체가 사라진다.
function Shell() {
  const location = useLocation()
  return (
    <div key={location.pathname} className="anim-fade">
      <ErrorBoundary>
        <Routes>
          <Route path="/boom" element={<Boom />} />
          <Route path="/ok" element={<div data-testid="ok-page">OK_PAGE</div>} />
        </Routes>
      </ErrorBoundary>
    </div>
  )
}

describe('App 라우트 경계 배선 (B48)', () => {
  afterEach(() => vi.restoreAllMocks())

  it('라우트 throw → 폴백, 다른 라우트로 이동 → 폴백 소멸+새 화면 렌더', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})

    render(
      <MemoryRouter initialEntries={['/boom']}>
        <Link to="/ok">go-ok</Link>
        <Shell />
      </MemoryRouter>,
    )

    expect(screen.getByRole('alert')).toBeInTheDocument()

    fireEvent.click(screen.getByText('go-ok'))

    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.getByTestId('ok-page')).toBeInTheDocument()
  })
})

// 검토 지적 HIGH — GlobalSearch가 이미 '/reports'인 채로 다른 ticker를
// navigate('/reports', { state: { ticker } })하는 실제 패턴(task#131 딥링크). pathname이
// 안 바뀌므로 anim-fade div는 remount되지 않는다 — 경계 자체가 location.key로 remount돼야
// ticker A의 옛 에러가 ticker B 화면까지 새지 않는다.
function TickerPage() {
  const location = useLocation()
  const ticker = location.state?.ticker
  if (ticker === 'A') throw new Error('ticker A boom')
  return <div data-testid="ticker-page">{ticker}</div>
}

function SameRouteShell() {
  const location = useLocation()
  return (
    <div key={location.pathname} className="anim-fade">
      <ErrorBoundary key={location.key}>
        <Routes>
          <Route path="/reports" element={<TickerPage />} />
        </Routes>
      </ErrorBoundary>
    </div>
  )
}

describe('App 라우트 경계 — 같은 경로·다른 state 재네비게이션 (B48)', () => {
  afterEach(() => vi.restoreAllMocks())

  it('ticker A에서 throw → 폴백, 같은 경로로 ticker B 재네비게이션 → 폴백 소멸+B 렌더', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})

    function Nav() {
      const navigate = useNavigate()
      return <button onClick={() => navigate('/reports', { state: { ticker: 'B' } })}>go-B</button>
    }

    render(
      <MemoryRouter initialEntries={[{ pathname: '/reports', state: { ticker: 'A' } }]}>
        <Nav />
        <SameRouteShell />
      </MemoryRouter>,
    )

    expect(screen.getByRole('alert')).toBeInTheDocument()

    fireEvent.click(screen.getByText('go-B'))

    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.getByTestId('ticker-page')).toHaveTextContent('B')
  })
})

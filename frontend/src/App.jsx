import { useState, useEffect } from 'react'
import useTheme from './hooks/useTheme'
import useBfcacheAuthGuard from './hooks/useBfcacheAuthGuard'
import useSwUpdateReload from './hooks/useSwUpdateReload'
import useAuthBootstrap from './hooks/useAuthBootstrap'
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom'
import { AuthProvider } from './contexts/AuthContext'
import Portfolio from './pages/Portfolio'
import ResearchShell from './pages/ResearchShell'
import Reports from './pages/Reports'
import Recommendations from './pages/Recommendations'
import Ranking from './pages/Ranking'
import Compare from './pages/Compare'
import Calendar from './pages/Calendar'
import Dividends from './pages/Dividends'
import Digest from './pages/Digest'
import MarketHub from './pages/MarketHub'
import AnalystReport from './pages/AnalystReport'
import AnalystReports from './pages/AnalystReports'
import TechReport from './pages/TechReport'
import TechReports from './pages/TechReports'
import TechAnatomy from './pages/TechAnatomy'
import Guru from './pages/Guru'
import GuruDetail from './pages/GuruDetail'
import Settings from './pages/Settings'
import Showcase from './pages/Showcase'
import LoginPage from './pages/LoginPage'
import Masthead from './components/Masthead'
import MobileNav from './components/MobileNav'
import MobileTopActions from './components/MobileTopActions'
import InstallPrompt from './components/InstallPrompt'
import GlobalSearch from './components/GlobalSearch'
import { Sun, Moon, LogOut } from './components/ui/icons'
import { ToastProvider } from './components/Toast'
import DiagLog from './components/DiagLog'
import './App.css'
import AdminAnalytics from './pages/AdminAnalytics'
import { REDIRECTS } from './routes'
import { SPLASH_HTML } from './oauthSplash'
import { purgeApiCache } from './apiCachePurge'

async function doLogout(setSession) {
  const refresh = localStorage.getItem('refresh_token')
  if (refresh) {
    await fetch(`${import.meta.env.VITE_API_BASE_URL || ''}/api/auth/logout`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh_token: refresh }),
    }).catch(() => {})
  }
  localStorage.removeItem('access_token')
  localStorage.removeItem('refresh_token')
  // 이 함수는 SPA 전용이다(리로드·내비게이션 없음) → main.jsx의 부팅 1회 퍼지가 재실행되지
  // 않는다. 그런데 B47의 문서화된 주 도달 경로가 정확히 "A 로그아웃 → 5분 내 같은 브라우저에서
  // B 로그인"이라 같은 문서 안에서 일어난다. 새 SW가 활성화된 뒤에는 아무도 api-cache를 채우지
  // 않아 no-op이지만, 옛 SW가 아직 살아 있는 전환 창에서는 이 한 줄이 그 경로의 유일한 방어선이다
  // (ADR-0036 결과절). await하지 않는다 — 로그아웃 반응성을 캐시 IO에 묶지 않는다.
  purgeApiCache()
  setSession(null)
}

// 리포트 상세 딥링크(location.state.ticker) — 같은 라우트 재네비게이션도 반영해야 한다(task#131 가토)
function ReportsRoute() {
  const location = useLocation()
  const [deepTicker, setDeepTicker] = useState(location.state?.ticker || null)
  useEffect(() => {
    setDeepTicker(location.state?.ticker || null)
  }, [location.state])
  return <Reports initialTicker={deepTicker} navKey={location.key} />
}

// BrowserRouter 내부 셸 — location.pathname을 라우트 전환 페이드업 key로 쓰려면 Router 컨텍스트가 필요하다.
function AppShell({ theme, setTheme, setSession }) {
  const location = useLocation()
  useSwUpdateReload(location.pathname)
  return (
    <div className="app-pc">
      <Masthead theme={theme} setTheme={setTheme} onLogout={() => doLogout(setSession)} />
      <div className="app-main">
        <header className="mobile-header">
          <div className="brand">
            <img src="/favicon.svg" className="brand-mark" alt="" />
            <span className="serif">PortfoliOn</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <GlobalSearch variant="mobile" />
            <MobileTopActions />
            <button className="theme-toggle" onClick={() => setTheme(t => t === 'dark' ? 'light' : 'dark')} title="테마">
              {theme === 'dark' ? <Sun /> : <Moon />}
            </button>
            <button className="icon-btn" title="로그아웃" onClick={() => doLogout(setSession)}><LogOut /></button>
          </div>
        </header>
        <main className="page-wrap">
          {/* 라우트 전환 페이드 — transform 없는 .anim-fade만 사용(fixed 자손 컨테이닝 블록 함정, task#195) */}
          <div key={location.pathname} className="anim-fade">
            <InstallPrompt />
            <Routes>
              {REDIRECTS.map(([from, to]) => (
                <Route key={from} path={from} element={<Navigate to={to} replace />} />
              ))}
              <Route path="/reports" element={<ResearchShell><ReportsRoute /></ResearchShell>} />
              <Route path="/recommend" element={<ResearchShell><Recommendations /></ResearchShell>} />
              <Route path="/ranking" element={<ResearchShell><Ranking /></ResearchShell>} />
              <Route path="/compare" element={<ResearchShell><Compare /></ResearchShell>} />
              <Route path="/calendar" element={<ResearchShell><Calendar /></ResearchShell>} />
              <Route path="/dividends" element={<ResearchShell><Dividends /></ResearchShell>} />
              <Route path="/digest" element={<ResearchShell><Digest /></ResearchShell>} />
              <Route path="/analyst-reports" element={<ResearchShell><AnalystReports /></ResearchShell>} />
              <Route path="/analyst-report/:ticker/:date" element={<ResearchShell><AnalystReport /></ResearchShell>} />
              <Route path="/tech-reports" element={<ResearchShell><TechReports /></ResearchShell>} />
              <Route path="/tech-report/:slug" element={<ResearchShell><TechReport /></ResearchShell>} />
              <Route path="/tech-anatomy/:slug" element={<ResearchShell><TechAnatomy /></ResearchShell>} />
              <Route path="/portfolio" element={<Portfolio />} />
              <Route path="/market/indicators" element={<MarketHub tab="indicators" />} />
              <Route path="/market/flow" element={<MarketHub tab="flow" />} />
              <Route path="/guru" element={<Guru />} />
              <Route path="/guru/:id" element={<GuruDetail />} />
              <Route path="/settings" element={<Settings />} />
              <Route path="/admin-analytics" element={<AdminAnalytics />} />
              <Route path="/dev/showcase" element={<Showcase />} />
            </Routes>
          </div>
        </main>
        <MobileNav />
      </div>
    </div>
  )
}

export default function App() {
  const [theme, setTheme] = useTheme()
  const { session, setSession, authLoading } = useAuthBootstrap()
  // 콜백 착지(/?oauth= 또는 ?error=) 여부를 마운트 시점에 한 번만 고정한다 — index.html
  // 인라인 스크립트와 동일한 판정. authLoading 동안 이 값을 유지해야 코드교환 fetch를
  // 기다리는 창에서 index.html 스플래시가 지워진 자리가 blank로 남지 않는다.
  const [isOAuthLanding] = useState(() => /[?&](oauth|error)=/.test(window.location.search))

  useBfcacheAuthGuard(!!session, setSession)

  // task#284 진단 진입점 A(브라우저) — 로그인 여부와 무관하게 보여야 관심 구간(로그인 화면
  // 잔상 구간)의 로그가 읽힌다. authLoading/session 분기보다 먼저 두는 이유가 그것이다.
  if (new URLSearchParams(window.location.search).get('diag') === '1') return <DiagLog />

  if (authLoading) {
    return isOAuthLanding
      ? <div dangerouslySetInnerHTML={{ __html: SPLASH_HTML }} />
      : null
  }
  if (!session) return <LoginPage />

  return (
    <ToastProvider>
    <AuthProvider isLoggedIn={!!session}>
    <BrowserRouter>
      <AppShell theme={theme} setTheme={setTheme} setSession={setSession} />
    </BrowserRouter>
    </AuthProvider>
    </ToastProvider>
  )
}

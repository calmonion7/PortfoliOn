import { useState, useEffect } from 'react'
import useTheme from './hooks/useTheme'
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
import Guru from './pages/Guru'
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
import './App.css'
import AdminAnalytics from './pages/AdminAnalytics'
import { REDIRECTS } from './routes'

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
              <Route path="/portfolio" element={<Portfolio />} />
              <Route path="/market/indicators" element={<MarketHub tab="indicators" />} />
              <Route path="/market/flow" element={<MarketHub tab="flow" />} />
              <Route path="/guru" element={<Guru />} />
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
  const [session, setSession] = useState(null)
  const [authLoading, setAuthLoading] = useState(true)

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const oauthCode = params.get('oauth')
    const oauthError = params.get('error')
    const token = params.get('token')
    const refresh = params.get('refresh')

    if (oauthError) {
      window.history.replaceState({}, '', '/')
      setSession(null)
      setAuthLoading(false)
      return
    }

    if (oauthCode) {
      window.history.replaceState({}, '', '/')
      const API = import.meta.env.VITE_API_BASE_URL || ''
      fetch(`${API}/api/auth/oauth/token?code=${oauthCode}`)
        .then(r => r.ok ? r.json() : null)
        .then(data => {
          if (data?.access_token) {
            localStorage.setItem('access_token', data.access_token)
            localStorage.setItem('refresh_token', data.refresh_token)
            window.location.replace('/')
          } else {
            setSession(null)
            setAuthLoading(false)
          }
        })
        .catch(() => {
          setSession(null)
          setAuthLoading(false)
        })
      return
    }

    if (token && refresh) {
      localStorage.setItem('access_token', token)
      localStorage.setItem('refresh_token', refresh)
      window.history.replaceState({}, '', '/')
    }

    const stored = localStorage.getItem('access_token')
    setSession(stored ? { access_token: stored } : null)
    setAuthLoading(false)
  }, [])

  if (authLoading) return null
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

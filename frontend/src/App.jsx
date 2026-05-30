import { useState, useEffect } from 'react'
import useTheme from './hooks/useTheme'
import { BrowserRouter, Routes, Route, NavLink } from 'react-router-dom'
import Portfolio from './pages/Portfolio'
import Research from './pages/Research'
import MarketHub from './pages/MarketHub'
import AnalysisHub from './pages/AnalysisHub'
import Guru from './pages/Guru'
import Settings from './pages/Settings'
import Showcase from './pages/Showcase'
import LoginPage from './pages/LoginPage'
import MobileNav from './components/MobileNav'
import { Sun, Moon, Refresh } from './components/ui/icons'
import { ToastProvider } from './components/Toast'
import './App.css'

function TopNav({ theme, setTheme, setSession }) {
  const navItems = [
    { to: '/',         label: '종목관리', end: true },
    { to: '/research', label: '리서치' },
    { to: '/market',   label: '시장' },
    { to: '/analysis', label: '분석' },
    { to: '/guru',     label: '구루' },
    { to: '/settings', label: '설정' },
  ]
  return (
    <header className="topnav">
      <div className="topnav-inner">
        <div className="brand">
          <div className="brand-mark">
            <div className="brand-dot" />
            <div className="brand-dot brand-dot--2" />
          </div>
          <span>PortfoliOn</span>
        </div>
        <nav className="topnav-tabs">
          {navItems.map(({ to, label, end }) => (
            <NavLink key={to} to={to} end={end}
              className={({ isActive }) => 'topnav-tab' + (isActive ? ' is-active' : '')}>
              {label}
            </NavLink>
          ))}
        </nav>
        <div className="topnav-tools">
          <button className="icon-btn" title="새로고침" onClick={() => window.location.reload()}><Refresh /></button>
          <button className="theme-toggle" onClick={() => setTheme(t => t === 'dark' ? 'light' : 'dark')} title="테마">
            {theme === 'dark' ? <Sun /> : <Moon />}
          </button>
          <button className="ghost-btn" onClick={async () => {
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
          }}>로그아웃</button>
        </div>
      </div>
    </header>
  )
}

export default function App() {
  const [theme, setTheme] = useTheme()
  const [session, setSession] = useState(null)
  const [authLoading, setAuthLoading] = useState(true)

  useEffect(() => {
    // OAuth 콜백에서 URL 파라미터로 token 전달
    const params = new URLSearchParams(window.location.search)
    const token = params.get('token')
    const refresh = params.get('refresh')
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
    <BrowserRouter>
      <div className="app-pc">
        <TopNav theme={theme} setTheme={setTheme} setSession={setSession} />
        <header className="mobile-header">
          <div className="brand">
            <div className="brand-mark">
              <div className="brand-dot" />
              <div className="brand-dot brand-dot--2" />
            </div>
            <span>PortfoliOn</span>
          </div>
          <button className="theme-toggle" onClick={() => setTheme(t => t === 'dark' ? 'light' : 'dark')} title="테마">
            {theme === 'dark' ? <Sun /> : <Moon />}
          </button>
        </header>
        <main className="page-wrap">
          <Routes>
            <Route path="/" element={<Portfolio />} />
            <Route path="/research" element={<Research />} />
            <Route path="/market" element={<MarketHub />} />
            <Route path="/analysis" element={<AnalysisHub />} />
            <Route path="/guru" element={<Guru />} />
            <Route path="/settings" element={<Settings />} />
            <Route path="/dev/showcase" element={<Showcase />} />
          </Routes>
        </main>
        <MobileNav />
      </div>
    </BrowserRouter>
    </ToastProvider>
  )
}

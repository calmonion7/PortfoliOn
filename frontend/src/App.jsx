import { useState, useEffect } from 'react'
import useTheme from './hooks/useTheme'
import { BrowserRouter, Routes, Route, NavLink, Navigate } from 'react-router-dom'
import { AuthProvider, useAuth } from './contexts/AuthContext'
import Portfolio from './pages/Portfolio'
import Research from './pages/Research'
import MarketHub from './pages/MarketHub'
import Guru from './pages/Guru'
import Settings from './pages/Settings'
import Showcase from './pages/Showcase'
import LoginPage from './pages/LoginPage'
import MobileNav from './components/MobileNav'
import InstallPrompt from './components/InstallPrompt'
import { Sun, Moon, Refresh, LogOut } from './components/ui/icons'
import { ToastProvider } from './components/Toast'
import './App.css'
import { trackEvent } from './utils/analytics'
import AdminAnalytics from './pages/AdminAnalytics'

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

function TopNav({ theme, setTheme, setSession }) {
  const { menuPermissions, role, loading } = useAuth() || { menuPermissions: [], role: null, loading: true }
  const allItems = [
    { to: '/',          label: '리서치',   key: 'research', end: true },
    { to: '/portfolio', label: '포트폴리오', key: 'portfolio' },
    { to: '/market',    label: '시장',     key: 'market' },
    { to: '/guru',      label: '구루',     key: 'guru' },
    { to: '/settings',  label: '설정',     key: 'settings' },
  ]
  const adminItem = role === 'admin' ? [{ to: '/admin-analytics', label: '행동', key: 'analytics' }] : []
  const navItems = loading ? [] : [
    ...allItems.filter(item => menuPermissions.includes(item.key)),
    ...adminItem,
  ]
  return (
    <header className="topnav">
      <div className="topnav-inner">
        <div className="brand">
          <img src="/favicon.svg" className="brand-mark" alt="" />
          <span>PortfoliOn</span>
        </div>
        <nav className="topnav-tabs">
          {navItems.map(({ to, label, end, key }) => (
            <NavLink key={to} to={to} end={end}
              onClick={() => trackEvent('nav_' + key)}
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
          <button className="icon-btn" title="로그아웃" onClick={() => doLogout(setSession)}><LogOut /></button>
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
      <div className="app-pc">
        <TopNav theme={theme} setTheme={setTheme} setSession={setSession} />
        <header className="mobile-header">
          <div className="brand">
            <img src="/favicon.svg" className="brand-mark" alt="" />
            <span>PortfoliOn</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <button className="theme-toggle" onClick={() => setTheme(t => t === 'dark' ? 'light' : 'dark')} title="테마">
              {theme === 'dark' ? <Sun /> : <Moon />}
            </button>
            <button className="icon-btn" title="로그아웃" onClick={() => doLogout(setSession)}><LogOut /></button>
          </div>
        </header>
        <main className="page-wrap">
          <InstallPrompt />
          <Routes>
            <Route path="/" element={<Research />} />
            <Route path="/portfolio" element={<Portfolio />} />
            <Route path="/research" element={<Research />} />
            <Route path="/market" element={<MarketHub />} />
            <Route path="/analysis" element={<Navigate to="/portfolio" replace />} />
            <Route path="/guru" element={<Guru />} />
            <Route path="/settings" element={<Settings />} />
            <Route path="/admin-analytics" element={<AdminAnalytics />} />
            <Route path="/dev/showcase" element={<Showcase />} />
          </Routes>
        </main>
        <MobileNav />
      </div>
    </BrowserRouter>
    </AuthProvider>
    </ToastProvider>
  )
}

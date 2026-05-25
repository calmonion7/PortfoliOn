import { useState, useEffect } from 'react'
import { BrowserRouter, Routes, Route, NavLink } from 'react-router-dom'
import Portfolio from './pages/Portfolio'
import Research from './pages/Research'
import MarketHub from './pages/MarketHub'
import AnalysisHub from './pages/AnalysisHub'
import Guru from './pages/Guru'
import Settings from './pages/Settings'
import Showcase from './pages/Showcase'
import { supabase } from './supabase'
import LoginPage from './pages/LoginPage'
import MobileNav from './components/MobileNav'
import { Sun, Moon, Bell, Refresh } from './components/ui/icons'
import './App.css'

function TopNav({ theme, setTheme }) {
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
          <button className="icon-btn" title="알림"><Bell /><span className="dot-indic" /></button>
          <button className="icon-btn" title="새로고침" onClick={() => window.location.reload()}><Refresh /></button>
          <button className="theme-toggle" onClick={() => setTheme(t => t === 'dark' ? 'light' : 'dark')} title="테마">
            {theme === 'dark' ? <Sun /> : <Moon />}
          </button>
          <button className="ghost-btn" onClick={() => supabase.auth.signOut()}>로그아웃</button>
        </div>
      </div>
    </header>
  )
}

export default function App() {
  const [theme, setTheme] = useState(() => localStorage.getItem('theme') ?? 'light')
  const [session, setSession] = useState(null)
  const [authLoading, setAuthLoading] = useState(true)

  useEffect(() => {
    if (theme === 'dark') {
      document.documentElement.setAttribute('data-theme', 'dark')
    } else {
      document.documentElement.removeAttribute('data-theme')
    }
    localStorage.setItem('theme', theme)
  }, [theme])

  useEffect(() => {
    supabase.auth.getSession()
      .then(({ data: { session } }) => setSession(session))
      .catch(() => {})
      .finally(() => setAuthLoading(false))
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_, session) => setSession(session))
    return () => subscription.unsubscribe()
  }, [])

  if (authLoading) return null
  if (!session) return <LoginPage />

  return (
    <BrowserRouter>
      <div className="app-pc">
        <TopNav theme={theme} setTheme={setTheme} />
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
  )
}

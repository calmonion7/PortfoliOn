import { useState, useEffect } from 'react'
import { BrowserRouter, Routes, Route, NavLink } from 'react-router-dom'
import Portfolio from './pages/Portfolio'
import Research from './pages/Research'
import MarketHub from './pages/MarketHub'
import AnalysisHub from './pages/AnalysisHub'
import Guru from './pages/Guru'
import Settings from './pages/Settings'
import './App.css'

const THEMES = [
  { key: 'dark',   swatch: '#1a1a2e', label: '다크' },
  { key: 'beige',  swatch: '#d4b896', label: '베이지' },
  { key: 'white',  swatch: '#e8e8e8', label: '화이트' },
  { key: 'pastel', swatch: '#9fa8da', label: '파스텔' },
]

export default function App() {
  const [theme, setTheme] = useState(() => localStorage.getItem('theme') ?? 'dark')

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
    localStorage.setItem('theme', theme)
  }, [theme])

  return (
    <BrowserRouter>
      <nav style={{
        padding: '12px 24px',
        background: 'var(--bg-nav)',
        display: 'flex',
        alignItems: 'center',
        gap: 24,
        borderBottom: '1px solid var(--border)',
      }}>
        <span style={{ color: 'var(--text)', fontWeight: 'bold', marginRight: 16 }}>Portfolio Manager</span>
        {[['/', '종목관리'], ['/research', '리서치'], ['/market', '시장'], ['/analysis', '분석'], ['/guru', '구루'], ['/settings', '설정']].map(([to, label]) => (
          <NavLink
            key={to}
            to={to}
            end={to === '/'}
            style={({ isActive }) => ({
              color: isActive ? 'var(--accent)' : 'var(--text-muted)',
              textDecoration: 'none',
              fontWeight: isActive ? 600 : 400,
            })}
          >
            {label}
          </NavLink>
        ))}
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 6, alignItems: 'center' }}>
          {THEMES.map(t => (
            <button
              key={t.key}
              title={t.label}
              onClick={() => setTheme(t.key)}
              style={{
                width: 18,
                height: 18,
                borderRadius: '50%',
                background: t.swatch,
                border: theme === t.key ? '2px solid white' : '2px solid transparent',
                outline: theme === t.key ? '1px solid #888' : 'none',
                cursor: 'pointer',
                padding: 0,
                flexShrink: 0,
              }}
            />
          ))}
        </div>
      </nav>
      <main style={{ padding: 24, background: 'var(--bg)', minHeight: 'calc(100vh - 49px)' }}>
        <Routes>
          <Route path="/" element={<Portfolio />} />
          <Route path="/research" element={<Research />} />
          <Route path="/market" element={<MarketHub />} />
          <Route path="/analysis" element={<AnalysisHub />} />
          <Route path="/guru" element={<Guru />} />
          <Route path="/settings" element={<Settings />} />
        </Routes>
      </main>
    </BrowserRouter>
  )
}

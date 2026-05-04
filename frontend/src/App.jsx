import { BrowserRouter, Routes, Route, NavLink } from 'react-router-dom'
import Portfolio from './pages/Portfolio'
import Reports from './pages/Reports'
import Settings from './pages/Settings'
import './App.css'

export default function App() {
  return (
    <BrowserRouter>
      <nav style={{ padding: '12px 24px', background: '#1a1a2e', display: 'flex', gap: 24 }}>
        <span style={{ color: '#e0e0e0', fontWeight: 'bold', marginRight: 16 }}>Portfolio Manager</span>
        {[['/', '종목 관리'], ['/reports', '리포트'], ['/settings', '설정']].map(([to, label]) => (
          <NavLink
            key={to}
            to={to}
            end={to === '/'}
            style={({ isActive }) => ({
              color: isActive ? '#4fc3f7' : '#b0b0b0',
              textDecoration: 'none',
              fontWeight: isActive ? 600 : 400,
            })}
          >
            {label}
          </NavLink>
        ))}
      </nav>
      <main style={{ padding: 24 }}>
        <Routes>
          <Route path="/" element={<Portfolio />} />
          <Route path="/reports" element={<Reports />} />
          <Route path="/settings" element={<Settings />} />
        </Routes>
      </main>
    </BrowserRouter>
  )
}

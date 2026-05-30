import { useState } from 'react'
import useIsMobile from '../hooks/useIsMobile'

const API = import.meta.env.VITE_API_BASE_URL || ''

export default function LoginPage() {
  const isMobile = useIsMobile()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  const handleLogin = async (e) => {
    e.preventDefault()
    setLoading(true); setError(null)
    try {
      const res = await fetch(`${API}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      })
      if (!res.ok) {
        const data = await res.json()
        setError(data.detail || '로그인 실패')
        return
      }
      const { access_token, refresh_token } = await res.json()
      localStorage.setItem('access_token', access_token)
      localStorage.setItem('refresh_token', refresh_token)
      window.location.href = '/'
    } catch {
      setError('네트워크 오류')
    } finally {
      setLoading(false)
    }
  }

  const handleGoogle = () => { window.location.href = `${API}/api/auth/oauth/google` }
  const handleGithub = () => { window.location.href = `${API}/api/auth/oauth/github` }

  if (isMobile) return (
    <div className="m-login">
      <div className="brand-big">
        <div className="brand-mark"><div className="brand-dot"/><div className="brand-dot brand-dot--2"/></div>
        PortfoliOn
      </div>
      <h1>당신의 자산을<br/>한 화면에서.</h1>
      <p className="lead">보유 종목, 시장 지표, 매니저 추천을 매일 아침 정리해드려요.</p>
      <form onSubmit={handleLogin}>
        <input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="이메일" required/>
        <input type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="비밀번호" required/>
        {error && <p style={{color:'var(--down)', fontSize:13, marginBottom:8}}>{error}</p>}
        <button className="btn btn-primary submit" type="submit" disabled={loading}>
          {loading ? '로그인 중…' : '로그인'}
        </button>
      </form>
      <div className="divider">또는</div>
      <button className="btn" style={{width:'100%', justifyContent:'center', marginBottom: 8}} onClick={handleGoogle}>Google로 계속</button>
      <button className="btn" style={{width:'100%', justifyContent:'center'}} onClick={handleGithub}>GitHub로 계속</button>
    </div>
  )

  return (
    <div className="login-wrap">
      {/* 좌측 브랜드 */}
      <div className="login-art">
        <div className="brand-big">
          <div className="brand-mark"><div className="brand-dot"/><div className="brand-dot brand-dot--2"/></div>
          PortfoliOn
        </div>
        <div className="login-quote">
          <h1>당신의 자산을<br/>한 화면에서.</h1>
          <p>보유 종목, 시장 지표, 매니저 추천까지 — 흩어진 데이터를 한 곳에서.<br/>매일 아침 9시 30분, 정리된 리포트가 메일로 도착합니다.</p>
        </div>
        <div className="login-ticker-strip">
          {[['S&P 500','+0.42%',true],['NASDAQ','+0.61%',true],['KOSPI','−0.18%',false],['USD/KRW','+0.55%',true],['VIX','−0.12',false]].map(([label, val, up]) => (
            <div key={label}>
              <span>{label}</span>
              <span className={'tnum ' + (up ? 'up' : 'down')}>{val}</span>
            </div>
          ))}
        </div>
      </div>

      {/* 우측 폼 */}
      <div className="login-form">
        <h2>다시 만나서 반가워요</h2>
        <p className="lead">이메일과 비밀번호를 입력해 로그인하세요.</p>
        <form onSubmit={handleLogin}>
          <div className="field">
            <label>이메일</label>
            <input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="you@example.com" required/>
          </div>
          <div className="field">
            <label>비밀번호</label>
            <input type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="••••••••" required/>
          </div>
          {error && <p style={{color:'var(--down)', fontSize:13, marginBottom:8}}>{error}</p>}
          <button className="btn btn-primary submit" type="submit" disabled={loading}>
            {loading ? '로그인 중…' : '로그인'}
          </button>
        </form>
        <div className="divider">또는</div>
        <div className="sso">
          <button className="btn" onClick={handleGoogle}>Google로 계속</button>
          <button className="btn" onClick={handleGithub}>GitHub로 계속</button>
        </div>
      </div>
    </div>
  )
}

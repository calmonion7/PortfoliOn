import { useState } from 'react'
import useIsMobile from '../hooks/useIsMobile'

const API = import.meta.env.VITE_API_BASE_URL || ''

export default function LoginPage() {
  const isMobile = useIsMobile()
  const [mode, setMode] = useState('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [success, setSuccess] = useState(null)

  const switchMode = (m) => { setMode(m); setError(null); setSuccess(null) }

  const doLogin = async (e) => {
    e.preventDefault()
    setLoading(true); setError(null)
    try {
      const res = await fetch(`${API}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      })
      if (!res.ok) { setError((await res.json()).detail || '로그인 실패'); return }
      const { access_token, refresh_token } = await res.json()
      localStorage.setItem('access_token', access_token)
      localStorage.setItem('refresh_token', refresh_token)
      window.location.href = '/'
    } catch { setError('네트워크 오류') }
    finally { setLoading(false) }
  }

  const doRegister = async (e) => {
    e.preventDefault()
    setLoading(true); setError(null)
    try {
      const res = await fetch(`${API}/api/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      })
      if (!res.ok) { setError((await res.json()).detail || '회원가입 실패'); return }
      setSuccess('계정이 생성됐어요. 로그인해 주세요.')
      setMode('login')
    } catch { setError('네트워크 오류') }
    finally { setLoading(false) }
  }

  const handleGoogle = () => { window.location.href = `${API}/api/auth/oauth/google` }
  const handleGithub = () => { window.location.href = `${API}/api/auth/oauth/github` }

  const isLogin = mode === 'login'

  if (isMobile) return (
    <div className="m-login">
      <div className="brand-big">
        <img src="/favicon.svg" className="brand-mark" alt="" />
        PortfoliOn
      </div>
      <h1>당신의 자산을<br/>한 화면에서.</h1>
      <p className="lead">보유 종목, 시장 지표, 구루 동향까지 — 흩어진 데이터를 한 곳에서.</p>
      <form onSubmit={isLogin ? doLogin : doRegister}>
        <input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="이메일" required/>
        <input type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="비밀번호" required/>
        {error && <p style={{color:'var(--down)', fontSize:13, marginBottom:8}}>{error}</p>}
        {success && <p style={{color:'var(--up)', fontSize:13, marginBottom:8}}>{success}</p>}
        <button className="btn btn-primary submit" type="submit" disabled={loading}>
          {loading ? (isLogin ? '로그인 중…' : '가입 중…') : (isLogin ? '로그인' : '회원가입')}
        </button>
      </form>
      <p style={{fontSize:13, textAlign:'center', marginTop:12, color:'var(--muted)'}}>
        {isLogin ? '계정이 없으신가요?' : '이미 계정이 있으신가요?'}{' '}
        <button className="link-btn" onClick={() => switchMode(isLogin ? 'signup' : 'login')}>
          {isLogin ? '회원가입' : '로그인'}
        </button>
      </p>
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
          <img src="/favicon.svg" className="brand-mark" alt="" />
          PortfoliOn
        </div>
        <div className="login-quote">
          <h1>당신의 자산을<br/>한 화면에서.</h1>
          <p>보유 종목, 시장 지표, 구루 동향까지 — 흩어진 데이터를 한 곳에서.<br/>매일 아침, 정리된 다이제스트로 시장을 한눈에 확인하세요.</p>
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
        <h2>{isLogin ? '다시 만나서 반가워요' : '계정 만들기'}</h2>
        <p className="lead">{isLogin ? '이메일과 비밀번호를 입력해 로그인하세요.' : '이메일과 비밀번호를 입력해 가입하세요.'}</p>
        <form onSubmit={isLogin ? doLogin : doRegister}>
          <div className="field">
            <label>이메일</label>
            <input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="you@example.com" required/>
          </div>
          <div className="field">
            <label>비밀번호</label>
            <input type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="••••••••" required/>
          </div>
          {error && <p style={{color:'var(--down)', fontSize:13, marginBottom:8}}>{error}</p>}
          {success && <p style={{color:'var(--up)', fontSize:13, marginBottom:8}}>{success}</p>}
          <button className="btn btn-primary submit" type="submit" disabled={loading}>
            {loading ? (isLogin ? '로그인 중…' : '가입 중…') : (isLogin ? '로그인' : '회원가입')}
          </button>
        </form>
        <p style={{fontSize:13, marginTop:12, color:'var(--muted)'}}>
          {isLogin ? '계정이 없으신가요?' : '이미 계정이 있으신가요?'}{' '}
          <button className="link-btn" onClick={() => switchMode(isLogin ? 'signup' : 'login')}>
            {isLogin ? '회원가입' : '로그인'}
          </button>
        </p>
        <div className="divider">또는</div>
        <div className="sso">
          <button className="btn" onClick={handleGoogle}>Google로 계속</button>
          <button className="btn" onClick={handleGithub}>GitHub로 계속</button>
        </div>
      </div>
    </div>
  )
}

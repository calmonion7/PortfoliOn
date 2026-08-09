import { useState, useEffect } from 'react'
import { flushSync } from 'react-dom'
import useIsMobile from '../hooks/useIsMobile'
import { markOAuthStart } from '../utils/oauthHistory'
import Input from '../components/ui/Input'
import { SketchHero } from '../components/sketches'
import { SPLASH_HTML } from '../oauthSplash'
import '../components/ui/Button.css'
import './LoginPage.css'

const API = import.meta.env.VITE_API_BASE_URL || ''

export default function LoginPage() {
  const isMobile = useIsMobile()
  const [mode, setMode] = useState('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [success, setSuccess] = useState(null)
  // OAuth로 떠나는 순간부터 콜백 문서와 픽셀 동일한 스플래시를 보여준다(task#285 S4) —
  // bfcache가 복원하는 건 '떠나기 직전 DOM'이라 이 상태가 그대로 되살아난다.
  const [leaving, setLeaving] = useState(false)

  // 취소 복귀 가드 — 구글에서 취소하고 뒤로가기로 돌아오면 이 스플래시가 bfcache로 복원된다.
  // 토큰이 없으면(=취소) 로그인 폼으로 되돌린다. 토큰이 있으면(=성공) 손대지 않는다 — App의
  // useBfcacheAuthGuard가 곧 세션을 뒤집어 이 화면 자체를 교체할 몫이라, 여기서 먼저 걷으면
  // 로그인 폼이 한 프레임 다시 보인다(원래 버그 재발, 레이스 방지를 위해 토큰 유무로만 가른다).
  useEffect(() => {
    const onPageShow = () => {
      if (!localStorage.getItem('access_token')) setLeaving(false)
    }
    window.addEventListener('pageshow', onPageShow)
    return () => window.removeEventListener('pageshow', onPageShow)
  }, [])

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
      // replace — 로그인 화면 엔트리를 히스토리에 남기지 않는다(뒤로가기 재진입 차단)
      window.location.replace('/')
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

  // push(href) — 되감기 착지점을 우리 문서로 남긴다(task#252). IdP가 자기 도메인에 만든 엔트리는
  // 지울 수 없으므로, 로그인 성공 랜딩에서 returnFromOAuth()가 되감아 그것들을 앞으로 밀어낸다.
  // replace로 떠나면 착지점이 IdP 엔트리가 되어 되감기가 성립하지 않는다.
  const startOAuth = (provider) => {
    // flushSync로 스플래시를 동기 페인트한 뒤에 떠난다 — 그래야 bfcache 복원 프레임이
    // 로그인 폼이 아니라 스플래시다(task#285 S4, 설계 근거는 위 leaving 상태 주석).
    flushSync(() => setLeaving(true))
    markOAuthStart()
    window.location.href = `${API}/api/auth/oauth/${provider}`
  }
  const handleGoogle = () => startOAuth('google')
  const handleGithub = () => startOAuth('github')

  const isLogin = mode === 'login'

  if (leaving) return <div dangerouslySetInnerHTML={{ __html: SPLASH_HTML }} />

  if (isMobile) return (
    <div className="m-login">
      <div className="brand-big">
        <img src="/favicon.svg" className="brand-mark" alt="" />
        PortfoliOn
      </div>
      <div className="login-hero login-hero--mobile sketch-draw">
        <SketchHero />
      </div>
      <h1>당신의 자산을<br/>한 화면에서.</h1>
      <p className="lead">보유 종목, 시장 지표, 구루 동향까지 — 흩어진 데이터를 한 곳에서.</p>
      <form onSubmit={isLogin ? doLogin : doRegister}>
        <div className="field">
          <label htmlFor="m-login-email" className="sr-only">이메일</label>
          <Input id="m-login-email" type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="이메일" required/>
        </div>
        <div className="field">
          <label htmlFor="m-login-password" className="sr-only">비밀번호</label>
          <Input id="m-login-password" type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="비밀번호" required/>
        </div>
        {error && <p style={{color:'var(--color-error)', fontSize:13, marginBottom:8}}>{error}</p>}
        {success && <p style={{color:'var(--color-success)', fontSize:13, marginBottom:8}}>{success}</p>}
        <button className="btn btn-primary submit" type="submit" disabled={loading}>
          {loading && <span className="btn__spinner" aria-hidden />}
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
        <div className="login-hero sketch-draw">
          <SketchHero />
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
            <Input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="you@example.com" required/>
          </div>
          <div className="field">
            <label>비밀번호</label>
            <Input type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="••••••••" required/>
          </div>
          {error && <p style={{color:'var(--color-error)', fontSize:13, marginBottom:8}}>{error}</p>}
          {success && <p style={{color:'var(--color-success)', fontSize:13, marginBottom:8}}>{success}</p>}
          <button className="btn btn-primary submit" type="submit" disabled={loading}>
            {loading && <span className="btn__spinner" aria-hidden />}
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

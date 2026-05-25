import { supabase } from '../supabase'
import Button from '../components/ui/Button'
import './LoginPage.css'

const FEATURES = [
  { icon: '📊', title: '한눈에 보는 포트폴리오', desc: '보유·관심 종목을 한 화면에서 추적하고 손익을 자동 계산합니다.' },
  { icon: '🤖', title: 'AI 분석 리포트', desc: '해자, 성장 전략, 리스크까지 매일 새로운 인사이트가 도착합니다.' },
  { icon: '🎯', title: '구루 추종', desc: '버핏·달리오 같은 거장의 포트폴리오 변화를 자동으로 따라갑니다.' },
]

const GoogleIcon = () => (
  <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden>
    <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.56c2.08-1.92 3.28-4.74 3.28-8.1z"/>
    <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.56-2.77c-.98.66-2.24 1.06-3.72 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84A11 11 0 0 0 12 23z"/>
    <path fill="#FBBC05" d="M5.84 14.1A6.6 6.6 0 0 1 5.5 12c0-.73.13-1.44.34-2.1V7.06H2.18A11 11 0 0 0 1 12c0 1.77.42 3.45 1.18 4.94l3.66-2.84z"/>
    <path fill="#EA4335" d="M12 5.38c1.62 0 3.07.56 4.21 1.64l3.16-3.16C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84C6.71 7.3 9.14 5.38 12 5.38z"/>
  </svg>
)

const GitHubIcon = () => (
  <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden fill="currentColor">
    <path d="M12 .5C5.65.5.5 5.65.5 12c0 5.08 3.29 9.39 7.86 10.91.58.1.79-.25.79-.56v-2.02c-3.2.7-3.87-1.36-3.87-1.36-.52-1.32-1.27-1.67-1.27-1.67-1.04-.71.08-.7.08-.7 1.15.08 1.76 1.18 1.76 1.18 1.02 1.74 2.68 1.24 3.34.95.1-.74.4-1.24.72-1.52-2.55-.29-5.24-1.27-5.24-5.66 0-1.25.45-2.27 1.18-3.07-.12-.29-.51-1.46.11-3.04 0 0 .96-.31 3.15 1.17a10.9 10.9 0 0 1 5.74 0c2.19-1.48 3.15-1.17 3.15-1.17.63 1.58.23 2.75.11 3.04.73.8 1.18 1.82 1.18 3.07 0 4.4-2.69 5.36-5.25 5.65.41.35.78 1.05.78 2.12v3.14c0 .31.21.67.8.56A11.5 11.5 0 0 0 23.5 12C23.5 5.65 18.35.5 12 .5z"/>
  </svg>
)

export default function LoginPage() {
  const handleLogin = (provider) => {
    supabase.auth.signInWithOAuth({
      provider,
      options: { redirectTo: window.location.origin },
    })
  }

  return (
    <div className="login">
      <div className="login__brand">
        <div>
          <div className="login__logo">
            <span className="login__logo-mark" aria-hidden>◐</span>
            <span>PortfoliOn</span>
          </div>
          <h1 className="login__headline">
            당신의 포트폴리오, <br />
            AI가 <em>매일</em> 분석합니다.
          </h1>
          <p className="login__sub">
            보유 종목부터 관심 종목까지. 시장 데이터·재무·뉴스·구루 동향을 묶어 매일 새로운 인사이트로 정리해드립니다.
          </p>
          <ul className="login__features">
            {FEATURES.map(f => (
              <li key={f.title} className="login__feature">
                <span className="login__feature-icon" aria-hidden>{f.icon}</span>
                <div>
                  <strong>{f.title}</strong>
                  <p>{f.desc}</p>
                </div>
              </li>
            ))}
          </ul>
        </div>
      </div>

      <div className="login__panel">
        <div className="login__card">
          <h2 className="login__card-title">시작하기</h2>
          <p className="login__card-sub">소셜 계정으로 30초 만에 시작하세요.</p>
          <div className="login__actions">
            <Button variant="secondary" size="lg" fullWidth icon={<GoogleIcon />} onClick={() => handleLogin('google')}>
              Google로 계속하기
            </Button>
            <Button variant="secondary" size="lg" fullWidth icon={<GitHubIcon />} onClick={() => handleLogin('github')}>
              GitHub로 계속하기
            </Button>
          </div>
          <p className="login__legal">
            계속 진행하면 <a href="#">이용약관</a>과 <a href="#">개인정보처리방침</a>에 동의하는 것으로 간주됩니다.
          </p>
        </div>
      </div>
    </div>
  )
}

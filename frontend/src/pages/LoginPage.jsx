import { supabase } from '../supabase'

export default function LoginPage() {
  const handleLogin = (provider) => {
    supabase.auth.signInWithOAuth({
      provider,
      options: { redirectTo: window.location.origin },
    })
  }

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      height: '100vh',
      gap: 16,
      background: 'var(--bg)',
      color: 'var(--text)',
    }}>
      <h1 style={{ marginBottom: 8 }}>PortfoliOn</h1>
      <button
        onClick={() => handleLogin('google')}
        style={{ padding: '10px 24px', cursor: 'pointer', borderRadius: 6 }}
      >
        Google로 로그인
      </button>
      <button
        onClick={() => handleLogin('github')}
        style={{ padding: '10px 24px', cursor: 'pointer', borderRadius: 6 }}
      >
        GitHub로 로그인
      </button>
    </div>
  )
}

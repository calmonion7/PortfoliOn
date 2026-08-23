import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './styles/tokens.css'
import './styles/motion.css'
import './index.css'
import App from './App.jsx'
import ErrorBoundary from './components/ErrorBoundary'
import { purgeApiCache } from './apiCachePurge'

purgeApiCache()

createRoot(document.getElementById('root')).render(
  <StrictMode>
    {/* B48 — AppShell·ToastProvider·AuthProvider·useAuthBootstrap의 throw까지 받는 최외곽
        안전망. 라우트 경계(App.jsx)는 이 층에 원리적으로 닿지 못한다. */}
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
)

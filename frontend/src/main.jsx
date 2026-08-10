import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './styles/tokens.css'
import './styles/motion.css'
import './index.css'
import App from './App.jsx'
import { purgeApiCache } from './apiCachePurge'

purgeApiCache()

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

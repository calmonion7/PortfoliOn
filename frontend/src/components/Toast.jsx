import { createContext, useContext, useState, useCallback } from 'react'

const ToastContext = createContext(null)

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([])

  const showToast = useCallback((message, type = 'success') => {
    const id = Date.now() + Math.random()
    setToasts(prev => [...prev.slice(-2), { id, message, type }])
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 3000)
  }, [])

  return (
    <ToastContext.Provider value={{ showToast }}>
      {children}
      <div style={{
        position: 'fixed', bottom: 88, left: '50%', transform: 'translateX(-50%)',
        zIndex: 9999, display: 'flex', flexDirection: 'column', gap: 8,
        alignItems: 'center', pointerEvents: 'none',
      }}>
        {toasts.map(t => (
          <div key={t.id} style={{
            background: t.type === 'error' ? 'var(--toast-err-bg, #3b1a1a)' : t.type === 'warning' ? 'var(--toast-warn-bg, #3b2e1a)' : 'var(--toast-ok-bg, #1a3b2a)',
            color: t.type === 'error' ? 'var(--toast-err-color, #ef9a9a)' : t.type === 'warning' ? 'var(--toast-warn-color, #ffcc80)' : 'var(--toast-ok-color, #81c784)',
            border: `1px solid ${t.type === 'error' ? 'var(--toast-err-border, #7f2020)' : t.type === 'warning' ? 'var(--toast-warn-border, #7f5a20)' : 'var(--toast-ok-border, #2e6b4a)'}`,
            borderRadius: 8, padding: '10px 20px', fontSize: 13,
            whiteSpace: 'pre-wrap', maxWidth: 280, textAlign: 'center',
            boxShadow: '0 4px 16px rgba(0,0,0,0.4)',
            animation: 'toast-in 0.2s ease',
          }}>
            {t.message}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  )
}

export function useToast() {
  return useContext(ToastContext)
}

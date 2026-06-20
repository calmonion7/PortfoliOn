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
            background: t.type === 'error' ? 'var(--color-error-soft)' : t.type === 'warning' ? 'var(--warn-soft)' : 'var(--color-success-soft)',
            color: t.type === 'error' ? 'var(--color-error)' : t.type === 'warning' ? 'var(--warn)' : 'var(--color-success)',
            border: `1px solid ${t.type === 'error' ? 'var(--color-error)' : t.type === 'warning' ? 'var(--warn)' : 'var(--color-success)'}`,
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

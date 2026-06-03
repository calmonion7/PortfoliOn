import { useState, useCallback } from 'react'

export default function useTheme() {
  const [theme, setThemeState] = useState(() => {
    const saved = localStorage.getItem('theme') ?? 'light'
    if (saved === 'dark') document.documentElement.setAttribute('data-theme', 'dark')
    else document.documentElement.removeAttribute('data-theme')
    return saved
  })

  const setTheme = useCallback((next) => {
    const value = typeof next === 'function' ? next(localStorage.getItem('theme') ?? 'light') : next
    localStorage.setItem('theme', value)
    if (value === 'dark') {
      document.documentElement.setAttribute('data-theme', 'dark')
    } else {
      document.documentElement.removeAttribute('data-theme')
    }
    setThemeState(value)
  }, [])

  return [theme, setTheme]
}

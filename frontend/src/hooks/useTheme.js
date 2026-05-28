import { useState, useCallback } from 'react'

export default function useTheme() {
  const [theme, setThemeState] = useState(() => localStorage.getItem('theme') ?? 'light')

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

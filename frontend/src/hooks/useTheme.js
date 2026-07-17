import { useState, useCallback } from 'react'

const THEME_COLORS = { dark: '#171310', light: '#f6f1e7' }

function applyTheme(value) {
  if (value === 'dark') {
    document.documentElement.setAttribute('data-theme', 'dark')
  } else {
    document.documentElement.removeAttribute('data-theme')
  }
  let meta = document.querySelector('meta[name="theme-color"]')
  if (!meta) {
    meta = document.createElement('meta')
    meta.name = 'theme-color'
    document.head.appendChild(meta)
  }
  meta.setAttribute('content', THEME_COLORS[value] ?? THEME_COLORS.light)
}

export default function useTheme() {
  const [theme, setThemeState] = useState(() => {
    const saved = localStorage.getItem('theme') ?? 'light'
    applyTheme(saved)
    return saved
  })

  const setTheme = useCallback((next) => {
    const value = typeof next === 'function' ? next(localStorage.getItem('theme') ?? 'light') : next
    localStorage.setItem('theme', value)
    applyTheme(value)
    setThemeState(value)
  }, [])

  return [theme, setTheme]
}

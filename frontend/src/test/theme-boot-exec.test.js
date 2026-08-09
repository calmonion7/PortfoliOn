// task#286 S1 — 테마 부트스트랩 인라인 스크립트의 실행 동작.
// THEME_BOOT_JS는 index.html에 그대로 박히는 raw JS 텍스트이므로, new Function()으로 직접
// 실행해 jsdom에서 검증한다(브라우저의 실제 실행 방식과 동일 — 파싱만 다르다).
import { describe, it, expect, afterEach } from 'vitest'
import { THEME_BOOT_JS } from '../themeBoot'

describe('themeBoot 인라인 스크립트 — 실행 동작', () => {
  afterEach(() => {
    document.documentElement.removeAttribute('data-theme')
    localStorage.clear()
    document.querySelectorAll('meta[name=theme-color]').forEach((el) => el.remove())
  })

  it("localStorage.theme === 'dark'면 documentElement에 data-theme=dark를 세운다", () => {
    localStorage.setItem('theme', 'dark')
    new Function(THEME_BOOT_JS)()
    expect(document.documentElement.dataset.theme).toBe('dark')
  })

  it("localStorage.theme === 'dark'면 meta[name=theme-color]의 content를 다크 값으로 바꾼다", () => {
    const meta = document.createElement('meta')
    meta.setAttribute('name', 'theme-color')
    meta.setAttribute('content', '#f6f1e7')
    document.head.appendChild(meta)

    localStorage.setItem('theme', 'dark')
    new Function(THEME_BOOT_JS)()

    expect(meta.getAttribute('content')).toBe('#171310')
  })

  it('저장값이 없으면 data-theme 속성을 세우지 않는다', () => {
    new Function(THEME_BOOT_JS)()
    expect(document.documentElement.hasAttribute('data-theme')).toBe(false)
  })

  it("localStorage.theme === 'light'면 data-theme 속성을 세우지 않는다", () => {
    localStorage.setItem('theme', 'light')
    new Function(THEME_BOOT_JS)()
    expect(document.documentElement.hasAttribute('data-theme')).toBe(false)
  })
})

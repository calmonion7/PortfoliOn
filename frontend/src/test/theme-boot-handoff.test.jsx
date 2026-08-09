// task#286 S3 — 인계 지점: 인라인 부트스트랩이 세운 data-theme를 useTheme의 lazy init(useTheme.js:22)이
// 다시 applyTheme한다. 같은 값이면 no-op이어야 하고, 어긋나면 첫 페인트 직후 테마가 한 번 뒤집힌다.
// 두 계약을 못박는다: ① 인라인이 세운 dark를 useTheme이 뒤집지 않는다 ② 저장값이 없을 때
// 인라인·useTheme의 기본값(속성 미설정=라이트)이 같다 — 한쪽만 바뀌면 깨지는 계약이다.
import { describe, it, expect, afterEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import useTheme from '../hooks/useTheme'
import { THEME_BOOT_JS } from '../themeBoot'

afterEach(() => {
  document.documentElement.removeAttribute('data-theme')
  localStorage.clear()
})

describe('테마 부트스트랩 → useTheme 인계', () => {
  it('인라인이 dark를 세운 뒤 useTheme이 마운트해도 data-theme가 dark로 유지된다', () => {
    localStorage.setItem('theme', 'dark')
    new Function(THEME_BOOT_JS)()
    expect(document.documentElement.dataset.theme).toBe('dark') // 전제 확인(인라인이 실제로 세웠다)

    renderHook(() => useTheme())

    expect(document.documentElement.dataset.theme).toBe('dark')
  })

  it('저장값이 없으면 인라인도 useTheme도 data-theme 속성을 세우지 않는다(기본값 일치)', () => {
    new Function(THEME_BOOT_JS)()
    expect(document.documentElement.hasAttribute('data-theme')).toBe(false) // 전제 확인

    renderHook(() => useTheme())

    expect(document.documentElement.hasAttribute('data-theme')).toBe(false)
  })
})

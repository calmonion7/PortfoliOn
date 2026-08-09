// task#286 S1 — 테마 배경색 3소스 일치.
// 배경색 리터럴은 번들 CSS 로드 전에 칠해야 하므로 토큰 참조가 원리적으로 불가능하다 — 그래서
// tokens.css(--bg) · useTheme.js(THEME_COLORS) · index.html(인라인 background 리터럴) 세 곳에
// 값이 하드코딩돼 있고, 이 셋이 어긋나면 다크 사용자가 "잘못된 색"으로 한 번 칠해지는데 어떤
// 게이트도 못 잡는다. fs로 읽어 직접 대조한다.
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, it, expect } from 'vitest'

const TOKENS_PATH = resolve(process.cwd(), 'src/styles/tokens.css')
const USE_THEME_PATH = resolve(process.cwd(), 'src/hooks/useTheme.js')
const INDEX_HTML_PATH = resolve(process.cwd(), 'index.html')

function extractTokensBg(css) {
  const darkBlockStart = css.indexOf('[data-theme="dark"]')
  if (darkBlockStart === -1) throw new Error('tokens.css에서 [data-theme="dark"] 블록을 찾지 못함')
  const lightPart = css.slice(0, darkBlockStart)
  const darkPart = css.slice(darkBlockStart)
  const lightMatch = lightPart.match(/--bg:\s*(#[0-9a-fA-F]{6})/)
  const darkMatch = darkPart.match(/--bg:\s*(#[0-9a-fA-F]{6})/)
  if (!lightMatch || !darkMatch) throw new Error('tokens.css에서 --bg 값을 찾지 못함')
  return { light: lightMatch[1], dark: darkMatch[1] }
}

function extractUseThemeColors(js) {
  const match = js.match(/THEME_COLORS\s*=\s*\{\s*dark:\s*'(#[0-9a-fA-F]{6})',\s*light:\s*'(#[0-9a-fA-F]{6})'\s*\}/)
  if (!match) throw new Error('useTheme.js에서 THEME_COLORS를 찾지 못함')
  return { dark: match[1], light: match[2] }
}

function extractIndexHtmlBg(html) {
  const lightMatch = html.match(/html\s*\{\s*background:\s*(#[0-9a-fA-F]{6})\s*\}/)
  const darkMatch = html.match(/html\[data-theme="dark"\]\s*\{\s*background:\s*(#[0-9a-fA-F]{6})\s*\}/)
  if (!lightMatch || !darkMatch) throw new Error('index.html에서 인라인 background 리터럴을 찾지 못함')
  return { light: lightMatch[1], dark: darkMatch[1] }
}

describe('테마 배경색 3소스 일치 — tokens.css · useTheme.js · index.html', () => {
  it('라이트/다크 --bg 값이 세 소스에서 모두 같고, 라이트≠다크다', () => {
    const tokens = extractTokensBg(readFileSync(TOKENS_PATH, 'utf-8'))
    const useTheme = extractUseThemeColors(readFileSync(USE_THEME_PATH, 'utf-8'))
    const indexHtml = extractIndexHtmlBg(readFileSync(INDEX_HTML_PATH, 'utf-8'))

    expect(useTheme.light).toBe(tokens.light)
    expect(useTheme.dark).toBe(tokens.dark)
    expect(indexHtml.light).toBe(tokens.light)
    expect(indexHtml.dark).toBe(tokens.dark)
    // 이빨 단언 — 라이트/다크 값이 같아지면 위 등가 비교들이 아무것도 안 보면서 통과한다
    expect(tokens.light).not.toBe(tokens.dark)
  })
})

// task#286 S1 — index.html의 theme-boot 인라인 사본과 themeBoot.THEME_BOOT_JS는
// 바이트 동일해야 한다(index.html은 import할 수 없으므로 사본을 두고 이 테스트가 동일성을 지킨다).
// 내부 정규화는 절대 하지 않는다 — 정규화하면 축이 무디어져 실제 드리프트를 놓친다.
// (oauth-splash-twin.test.js와 동형 패턴 — task#285)
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, it, expect } from 'vitest'
import { THEME_BOOT_JS } from '../themeBoot'

// vitest는 프론트 루트(frontend/)에서 실행되므로 cwd 기준으로 잡는다.
const INDEX_HTML_PATH = resolve(process.cwd(), 'index.html')

function extractThemeBootCopy(html) {
  const start = html.indexOf('<!-- theme-boot:start -->')
  const end = html.indexOf('<!-- theme-boot:end -->')
  if (start === -1 || end === -1) throw new Error('theme-boot 마커를 index.html에서 찾지 못함')
  return html.slice(start + '<!-- theme-boot:start -->'.length, end).trim()
}

describe('index.html theme-boot 사본 == themeBoot.THEME_BOOT_JS (쌍둥이 동일성)', () => {
  it('마커 사이 문자열이 THEME_BOOT_JS와 바이트 동일하다', () => {
    const html = readFileSync(INDEX_HTML_PATH, 'utf-8')
    expect(extractThemeBootCopy(html)).toBe(THEME_BOOT_JS)
  })
})

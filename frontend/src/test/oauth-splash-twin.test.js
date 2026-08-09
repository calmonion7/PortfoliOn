// task#285 S3 — index.html의 인라인 스플래시 사본과 oauthSplash.js의 SPLASH_HTML은
// 바이트 동일해야 한다(문서 전환 시 화면이 안 바뀌는 게 이 계약의 목적).
// 내부 정규화는 절대 하지 않는다 — 정규화하면 축이 무디어져 실제 드리프트를 놓친다.
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, it, expect } from 'vitest'
import { SPLASH_HTML } from '../oauthSplash'

// vitest는 프론트 루트(frontend/)에서 실행되므로 cwd 기준으로 잡는다(import.meta.url이
// 이 러너에서 file:// 스킴이 아니라 fileURLToPath가 던진다).
const INDEX_HTML_PATH = resolve(process.cwd(), 'index.html')

function extractSplashCopy(html) {
  const start = html.indexOf('<!-- oauth-splash:start -->')
  const end = html.indexOf('<!-- oauth-splash:end -->')
  if (start === -1 || end === -1) throw new Error('oauth-splash 마커를 index.html에서 찾지 못함')
  return html.slice(start + '<!-- oauth-splash:start -->'.length, end).trim()
}

describe('index.html 스플래시 사본 == oauthSplash.SPLASH_HTML (쌍둥이 동일성)', () => {
  it('마커 사이 문자열이 SPLASH_HTML과 바이트 동일하다', () => {
    const html = readFileSync(INDEX_HTML_PATH, 'utf-8')
    expect(extractSplashCopy(html)).toBe(SPLASH_HTML)
  })
})

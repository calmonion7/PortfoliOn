// task#320 S2 — 램프 값 2소스 일치: `tokens.css` ↔ `shareRamp.js`의 `RAMP`.
//
// 왜 필요한가: 램프 색은 **JS로 계산**해야 하고(프로브가 대비를 숫자로 재야 하며 `color-mix`의 computed
// style 직렬화가 브라우저마다 갈린다) `getComputedStyle`은 jsdom에서 스타일시트의 커스텀 프로퍼티를
// 해석하지 못한다. 그래서 값이 두 곳에 산다 — 어긋나면 **CSS가 칠한 트랙 위에 JS가 계산한 막대**가
// 놓여 대비 기준이 조용히 무너지는데, vitest·빌드·라이브 프로브 어느 것도 그 *불일치*를 보지 않는다.
// 선례: `theme-color-sources.test.js`(--bg 3소스 일치, task#286).
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, it, expect } from 'vitest'
import { RAMP, contrastRatio, mixOklab } from './shareRamp'

const CSS = readFileSync(resolve(process.cwd(), 'src/styles/tokens.css'), 'utf-8')
const DARK_AT = CSS.indexOf('[data-theme="dark"]')
if (DARK_AT === -1) throw new Error('tokens.css에서 [data-theme="dark"] 블록을 찾지 못함')
const LIGHT_CSS = CSS.slice(0, DARK_AT)
const DARK_CSS = CSS.slice(DARK_AT)

const pick = (block, name) => {
  const m = block.match(new RegExp(`--${name}:\\s*([^;]+);`))
  if (!m) throw new Error(`tokens.css에서 --${name}를 찾지 못함`)
  return m[1].trim()
}

describe('지분 램프 토큰 2소스 일치 (task#320 S2)', () => {
  it.each([
    ['라이트', LIGHT_CSS, RAMP.light],
    ['다크', DARK_CSS, RAMP.dark],
  ])('%s: tokens.css의 --ramp-* 4개가 RAMP와 같다', (_label, block, js) => {
    expect(pick(block, 'ramp-hi')).toBe(js.hi)
    expect(pick(block, 'ramp-lo')).toBe(js.lo)
    expect(pick(block, 'ramp-residual')).toBe(js.residual)
    expect(pick(block, 'ramp-track')).toBe(js.track)
    expect(pick(block, 'bg')).toBe(js.bg)
  })

  // 이빨 — 라이트/다크가 같아지면 위 등가 비교들이 아무것도 안 보면서 통과한다(선례의 이빨 단언 이식).
  it('이빨: 라이트와 다크 램프 값이 서로 다르다', () => {
    expect(RAMP.light.hi).not.toBe(RAMP.dark.hi)
    expect(RAMP.light.lo).not.toBe(RAMP.dark.lo)
    expect(RAMP.light.track).not.toBe(RAMP.dark.track)
  })

  // 램프 방향이 테마마다 뒤집혀야 한다 — 같은 값을 두 테마에 쓰면 다크에서 최대 지분이 가장 어두워져
  // 읽는 방향이 거꾸로 된다(계획 결정 4). 「hi가 지배적인 몫」이라는 계약을 밝기로 못박는다.
  it('라이트는 hi가 더 어둡고, 다크는 hi가 더 밝다 (방향 반전)', () => {
    const lum = (c, bg) => contrastRatio(c, '#ffffff', bg)   // 흰색 대비가 크면 = 더 어둡다
    expect(lum(RAMP.light.hi, RAMP.light.bg)).toBeGreaterThan(lum(RAMP.light.lo, RAMP.light.bg))
    expect(lum(RAMP.dark.hi, RAMP.dark.bg)).toBeLessThan(lum(RAMP.dark.lo, RAMP.dark.bg))
  })

  it('두 테마 모두 가장 연한 막대의 트랙 대비가 1.4:1 이상 (토큰 실값으로)', () => {
    for (const T of [RAMP.light, RAMP.dark]) {
      expect(contrastRatio(mixOklab(T.hi, T.lo, 1), T.track, T.bg)).toBeGreaterThanOrEqual(1.4)
    }
  })

  it('「기타」 중립색이 램프 위 어느 지점과도 같지 않다 — 잔여가 분류로 읽히지 않게', () => {
    for (const T of [RAMP.light, RAMP.dark]) {
      const onRamp = Array.from({ length: 21 }, (_, i) => mixOklab(T.hi, T.lo, i / 20))
      expect(onRamp).not.toContain(T.residual)
    }
  })
})

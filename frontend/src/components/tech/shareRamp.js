// 지분 램프 — 「구성과 연관」 섹션의 항목별 막대 색을 지분 *값*에서 계산한다 (task#320 · ADR-0046).
//
// 왜 한 색 농도 램프인가(카테고리 팔레트 기각): `--data-1…5`는 **5색뿐인데** `composition.tech`는
// 스키마상 3~7항목이라 7항목에서 색이 바닥나 두 막대가 같은 색이 된다 — 그건 「같은 부류」라는
// **없는 사실**을 말한다. 램프는 항목 수에서 계산되므로 원리적으로 안 바닥난다. 부수로 **색이
// 카테고리를 뜻한다고 약속하지 않는다**(각 막대에 이미 이름표가 있어 색은 아무것도 뜻하지 않는다).
//
// 왜 순위가 아니라 지분 *값*에서 계산하나: `t = (max − v) / (max − min)`.
// 라이브 실측에 **같은 지분 쌍이 실재한다**(semiconductor-equipment 15%×2 · robotics 25%×2 ·
// smr 20%×2). 순위로 주면 그 두 항목이 다른 색이 되어 **없는 구별**을 말한다.
// **색은 길이와 같은 말을 해야 한다.**
//
// 왜 CSS `color-mix`가 아니라 JS인가: ⓐ 결과 색을 숫자로 알아야 프로브가 대비를 잴 수 있다
// (`color-mix`의 computed style 직렬화는 브라우저마다 갈린다) ⓑ 미지원 브라우저 폴백 분기가 없다.
//
// 보간을 oklab에서 하는 이유: sRGB 선형 보간은 중간 지점이 탁해지고(특히 틸 계열) 지각 균등하지
// 않아 항목 수가 늘 때 인접 막대가 구별되지 않는다. oklab은 L이 지각 밝기에 가깝다.

/** 「기타」 식별 — **접두일치**다. 정확일치는 조용히 오분류한다(라이브에 `기타`와
 *  `기타(팩·BMS·안전 통합)` 두 형태가 실재한다). 규약 출처: 루틴 프롬프트 · ADR-0042. */
export const RESIDUAL_PREFIX = '기타'
export const isResidual = (name) => typeof name === 'string' && name.trim().startsWith(RESIDUAL_PREFIX)

// ── 색 파싱 ────────────────────────────────────────────────────────────────
/** `#rgb` · `#rrggbb` · `rgb()` · `rgba()` → `{r,g,b,a}` (0~255, a 0~1). 못 읽으면 null. */
export function parseColor(v) {
  if (typeof v !== 'string') return null
  const s = v.trim()
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(s)
  if (hex) {
    const h = hex[1]
    const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h
    return { r: parseInt(full.slice(0, 2), 16), g: parseInt(full.slice(2, 4), 16), b: parseInt(full.slice(4, 6), 16), a: 1 }
  }
  const m = /^rgba?\(([^)]+)\)$/i.exec(s)
  if (!m) return null
  const p = m[1].split(',').map((x) => parseFloat(x.trim()))
  if (p.length < 3 || p.slice(0, 3).some((n) => !Number.isFinite(n))) return null
  return { r: p[0], g: p[1], b: p[2], a: p.length > 3 && Number.isFinite(p[3]) ? p[3] : 1 }
}

const toHex2 = (n) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0')
export const toHex = ({ r, g, b }) => `#${toHex2(r)}${toHex2(g)}${toHex2(b)}`

// ── sRGB ↔ oklab (Björn Ottosson) ──────────────────────────────────────────
const lin = (c) => { const x = c / 255; return x <= 0.04045 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4) }
const unlin = (x) => 255 * (x <= 0.0031308 ? x * 12.92 : 1.055 * Math.pow(x, 1 / 2.4) - 0.055)

export function srgbToOklab({ r, g, b }) {
  const R = lin(r), G = lin(g), B = lin(b)
  const l = Math.cbrt(0.4122214708 * R + 0.5363325363 * G + 0.0514459929 * B)
  const m = Math.cbrt(0.2119034982 * R + 0.6806995451 * G + 0.1073969566 * B)
  const s = Math.cbrt(0.0883024619 * R + 0.2817188376 * G + 0.6299787005 * B)
  return {
    L: 0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s,
    a: 1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s,
    bb: 0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s,
  }
}

export function oklabToSrgb({ L, a, bb }) {
  const l = (L + 0.3963377774 * a + 0.2158037573 * bb) ** 3
  const m = (L - 0.1055613458 * a - 0.0638541728 * bb) ** 3
  const s = (L - 0.0894841775 * a - 1.2914855480 * bb) ** 3
  return {
    r: unlin(+4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
    g: unlin(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
    b: unlin(-0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s),
    a: 1,
  }
}

/** oklab 공간에서 a→b를 t(0~1)로 보간한 sRGB hex. t=0 → a, t=1 → b. */
export function mixOklab(a, b, t) {
  const ca = parseColor(a), cb = parseColor(b)
  if (!ca || !cb) return null
  const u = Number.isFinite(t) ? Math.max(0, Math.min(1, t)) : 0
  // ⚠️ **identity 단축(`ca === cb`면 그대로 반환)을 두지 않는다.** 처음엔 왕복 오차 보험으로 넣었는데
  //    fault injection에서 **제거해도 실패 0건**이었다 — 「아무도 지키지 않는 축」의 신호다(task#315·316).
  //    원인을 계측했다: sRGB 8비트 격자 **50,653색 전수에서 왕복 손실 0색**이므로 그 단축은 죽은 코드다.
  //    그리고 더 나쁜 것은 **그것이 회귀를 가렸다**는 점이다 — 아래 변환 수식이 깨져도 단축이
  //    `mixOklab(c, c, t)`를 통과시켜 identity 테스트가 초록으로 남는다.
  //    ⚠️ 다만 「제거하면 카나리아가 된다」를 그대로 믿지 말 것 — 그 감도를 실측했다:
  //    L 계수에 `×1.001`·`×1.005`를 주입해도 **15건 전부 통과**하고(8비트 반올림이 흡수한다),
  //    `×1.02`부터 3건이 FAIL한다. 즉 이 축들은 **~2% 이상의 변환 오류만** 잡는다.
  //    미세 오차용 가드가 필요하면 왕복 오차의 절대값을 재는 별도 축을 세워야 한다(현재는 불필요 —
  //    이 파일의 소비처는 토큰 hex 6종뿐이고 그 왕복은 전수 무손실이다).
  const A = srgbToOklab(ca), B = srgbToOklab(cb)
  return toHex(oklabToSrgb({
    L: A.L + (B.L - A.L) * u,
    a: A.a + (B.a - A.a) * u,
    bb: A.bb + (B.bb - A.bb) * u,
  }))
}

// ── 대비 ───────────────────────────────────────────────────────────────────
const relLum = ({ r, g, b }) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)
/** 반투명 fg를 bg 위에 합성 — 트랙이 알파 0.11이면 이걸 거치지 않은 대비는 무의미하다. */
export function over(fg, bg) {
  if (!fg) return null
  if (fg.a >= 1 || !bg) return fg
  return { r: fg.r * fg.a + bg.r * (1 - fg.a), g: fg.g * fg.a + bg.g * (1 - fg.a), b: fg.b * fg.a + bg.b * (1 - fg.a), a: 1 }
}
/** WCAG 대비비. 알파가 있으면 `pageBg` 위에 합성한 실효색으로 잰다. */
export function contrastRatio(a, b, pageBg) {
  const pg = parseColor(pageBg) || { r: 255, g: 255, b: 255, a: 1 }
  const ca = over(parseColor(a), pg), cb = over(parseColor(b), pg)
  if (!ca || !cb) return null
  const la = relLum(ca), lb = relLum(cb)
  const hi = Math.max(la, lb), lo = Math.min(la, lb)
  return Math.round(((hi + 0.05) / (lo + 0.05)) * 100) / 100
}

// ── 램프 위치 ──────────────────────────────────────────────────────────────
/**
 * `composition.tech[]` → 표시 순서(지분 내림차순, 「기타」 항상 마지막) + 램프 위치 `t`.
 *
 * ⚠️ **「기타」는 `t` 계산의 분모에서 빠진다** — 그건 분류가 아니라 **잔여분**이고 램프 밖
 * 중립색을 쓴다. 분모에 넣으면 잔여 5%가 최소값이 되어 실제 최소 항목의 색을 밀어낸다.
 * ⚠️ **축퇴(max === min, 전 항목 동률)에서 예외를 던지지 않는다** — 0으로 나누지 않고 `t = 0`
 *   (전부 진한 쪽)으로 수렴시킨다. 실측엔 없지만 3항목 판에서 발생 가능하다.
 */
export function rampPositions(items) {
  const list = (Array.isArray(items) ? items : [])
    .filter((x) => x && typeof x.name === 'string' && x.name.trim() !== '')
    // ⚠️ `Number(null) === 0`이다 — `Number()`만 쓰면 **결측이 0%로 붕괴**해 램프의 min을 0으로
    //    끌어내리고, 그 항목이 「지분 0인 항목」으로 렌더된다(`wrong < missing` 위반).
    //    null/undefined를 먼저 걸러야 한다. `Number('abc')`·`Number(undefined)`는 NaN이라 안전하다.
    .map((x) => ({
      ...x,
      share: x.share_pct == null ? NaN : Number(x.share_pct),
      residual: isResidual(x.name),
    }))
    .filter((x) => Number.isFinite(x.share))
  const ramp = list.filter((x) => !x.residual).sort((a, b) => b.share - a.share)
  const residual = list.filter((x) => x.residual).sort((a, b) => b.share - a.share)
  const shares = ramp.map((x) => x.share)
  const max = shares.length ? Math.max(...shares) : 0
  const min = shares.length ? Math.min(...shares) : 0
  const span = max - min
  return [
    ...ramp.map((x) => ({ ...x, t: span > 0 ? (max - x.share) / span : 0 })),
    ...residual.map((x) => ({ ...x, t: null })),
  ]
}

/** 램프 위치 → 실제 색. `hi`(지분 최대) · `lo`(지분 최소) · `residual`은 호출측이 토큰 실측값을 준다. */
export function rampColor(t, hi, lo, residualColor) {
  if (t == null) return residualColor
  return mixOklab(hi, lo, t)
}

// ── 테마별 램프 값 (tokens.css 미러) ────────────────────────────────────────
// ⚠️ **왜 여기 하드코딩하나**: 램프 색을 JS로 계산해야 하는데(위 「왜 CSS color-mix가 아닌가」)
//    `getComputedStyle`은 jsdom에서 스타일시트의 커스텀 프로퍼티를 해석하지 못해 테스트가 원리적으로
//    빈 값을 받는다. 그래서 `theme-color-sources.test.js`가 `--bg`에 쓴 것과 **같은 선례**를 따른다:
//    JS에 값을 두고 **`shareRamp.tokens.test.js`가 tokens.css를 fs로 읽어 등가를 단언**한다.
//    그 테스트가 드리프트를 기계적으로 막는다(주석의 약속이 아니라 게이트다).
export const RAMP = {
  light: { hi: '#12433e', lo: '#8fbdb6', residual: '#8a7f6b', track: 'rgba(29, 95, 88, 0.11)', bg: '#f6f1e7' },
  dark: { hi: '#9ae6d5', lo: '#2f5f57', residual: '#7d7566', track: 'rgba(98, 179, 164, 0.11)', bg: '#171310' },
}

/** 현재 테마의 램프 값. 앱 관례와 같은 판정식(`reportUtils.rsiColor`·`ExposureTab`와 동일). */
export function currentRamp() {
  const dark = typeof document !== 'undefined'
    && document.documentElement.getAttribute('data-theme') === 'dark'
  return dark ? RAMP.dark : RAMP.light
}

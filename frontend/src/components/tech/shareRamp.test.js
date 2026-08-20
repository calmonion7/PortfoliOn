import { describe, it, expect } from 'vitest'
import {
  rampPositions, mixOklab, srgbToOklab, oklabToSrgb, contrastRatio,
  parseColor, toHex, isResidual, rampColor,
} from './shareRamp'

// 실측 토큰값 미러(2026-08-21 `styles/tokens.css`) — 축 ⑦이 이 값을 직접 잰다.
// ⚠️ 토큰이 바뀌면 이 핀이 깨진다. 그게 의도다 — 대비 기준을 코드에 박아 두지 않으면
//    다음 사람이 램프 폭을 넓히다 바닥 대비를 1.4 밑으로 떨어뜨려도 아무것도 안 잡는다.
const LIGHT = { bg: '#f6f1e7', hi: '#12433e', lo: '#8fbdb6', track: 'rgba(29, 95, 88, 0.11)' }
const DARK = { bg: '#171310', hi: '#9ae6d5', lo: '#2f5f57', track: 'rgba(98, 179, 164, 0.11)' }

describe('지분 램프 — 색 보간 (task#320 S2)', () => {
  it('① identity — 같은 색을 섞으면 모든 t에서 그 색이다', () => {
    for (const t of [0, 0.13, 0.5, 0.87, 1]) {
      expect(mixOklab('#1d5f58', '#1d5f58', t)).toBe('#1d5f58')
      expect(mixOklab('#f6f1e7', '#f6f1e7', t)).toBe('#f6f1e7')
    }
  })

  it('② sRGB → oklab → sRGB 왕복이 입력과 동일하다', () => {
    for (const hex of ['#12433e', '#8fbdb6', '#9ae6d5', '#2f5f57', '#000000', '#ffffff', '#7a4a7e']) {
      expect(toHex(oklabToSrgb(srgbToOklab(parseColor(hex))))).toBe(hex)
    }
  })

  it('t 양끝은 각각 hi·lo와 같다 (보간이 끝점을 옮기지 않는다)', () => {
    expect(mixOklab(LIGHT.hi, LIGHT.lo, 0)).toBe(LIGHT.hi)
    expect(mixOklab(LIGHT.hi, LIGHT.lo, 1)).toBe(LIGHT.lo)
  })

  it('t가 커질수록 oklab L이 단조 증가한다 (라이트: 연해진다)', () => {
    const Ls = [0, 0.25, 0.5, 0.75, 1].map((t) => srgbToOklab(parseColor(mixOklab(LIGHT.hi, LIGHT.lo, t))).L)
    Ls.slice(1).forEach((L, i) => expect(L).toBeGreaterThan(Ls[i]))
  })
})

describe('지분 램프 — 위치 계산 (task#320 S2)', () => {
  it('③ 같은 지분 두 항목이 같은 t를 받는다 — 순위 기반이면 실패한다', () => {
    // semiconductor-equipment 실판 미러: 15%가 두 개다(라이브 실측).
    const pos = rampPositions([
      { name: '극자외선 광원·투영광학계', share_pct: 35 },
      { name: '원자층 수준 증착·식각 제어', share_pct: 20 },
      { name: '계측·검사와 수율 학습', share_pct: 15 },
      { name: '하이브리드 본딩·후공정 접합', share_pct: 15 },
      { name: '초정밀 스테이지·진동/열 제어', share_pct: 10 },
    ])
    const t15 = pos.filter((p) => p.share === 15).map((p) => p.t)
    expect(t15).toHaveLength(2)
    expect(t15[0]).toBe(t15[1])
    // 그리고 그 t가 다른 지분의 t와는 달라야 한다(색이 길이와 같은 말을 한다).
    const t20 = pos.find((p) => p.share === 20).t
    expect(t15[0]).not.toBe(t20)
    // 색까지 확인 — 같은 지분 → 같은 색, 다른 지분 → 다른 색
    const c15 = t15.map((t) => rampColor(t, LIGHT.hi, LIGHT.lo, LIGHT.residual))
    expect(c15[0]).toBe(c15[1])
    expect(rampColor(t20, LIGHT.hi, LIGHT.lo, LIGHT.residual)).not.toBe(c15[0])
  })

  it('④ 「기타」는 t 분모에서 빠지고 항상 마지막이다', () => {
    const pos = rampPositions([
      { name: '기타', share_pct: 5 },
      { name: 'A', share_pct: 50 },
      { name: 'B', share_pct: 25 },
      { name: 'C', share_pct: 20 },
    ])
    expect(pos.map((p) => p.name)).toEqual(['A', 'B', 'C', '기타'])
    expect(pos[pos.length - 1].t).toBeNull()
    // 분모는 램프 항목만(50~20) — 「기타」 5%가 min이 됐다면 C(20)의 t가 1이 아니게 된다.
    expect(pos.find((p) => p.name === 'C').t).toBe(1)
    expect(pos.find((p) => p.name === 'A').t).toBe(0)
  })

  it('⑤ 전 항목 동률(max === min)에서 예외 없이 t=0', () => {
    const pos = rampPositions([
      { name: 'A', share_pct: 33 }, { name: 'B', share_pct: 33 }, { name: 'C', share_pct: 33 },
    ])
    expect(pos.map((p) => p.t)).toEqual([0, 0, 0])
  })

  it('⑥ 「기타」와 「기타(팩·BMS·안전 통합)」이 **둘 다** 잔여로 분류된다 — 정확일치면 실패', () => {
    // 라이브 실측: semiconductor-equipment는 `기타`, solid-state-battery는 `기타(팩·BMS·안전 통합)`.
    expect(isResidual('기타')).toBe(true)
    expect(isResidual('기타(팩·BMS·안전 통합)')).toBe(true)
    expect(isResidual('기타 설비')).toBe(true)
    expect(isResidual('전해질 소재 양산·연속화')).toBe(false)
    const pos = rampPositions([
      { name: '대면적 전해질층 무결점 성막·적층', share_pct: 35 },
      { name: '기타(팩·BMS·안전 통합)', share_pct: 5 },
      { name: '전해질 소재 양산·연속화', share_pct: 25 },
    ])
    expect(pos.map((p) => p.name)).toEqual([
      '대면적 전해질층 무결점 성막·적층', '전해질 소재 양산·연속화', '기타(팩·BMS·안전 통합)'])
    expect(pos[2].t).toBeNull()
  })

  it('비유한 share_pct는 정의역에서 빠진다 (NaN·null·문자열)', () => {
    const pos = rampPositions([
      { name: 'A', share_pct: 60 }, { name: 'NaN', share_pct: NaN },
      { name: 'null', share_pct: null }, { name: 'str', share_pct: 'abc' },
      { name: 'B', share_pct: 40 },
    ])
    expect(pos.map((p) => p.name)).toEqual(['A', 'B'])
  })

  it('비배열·빈 입력에서 예외를 던지지 않는다', () => {
    for (const bad of [null, undefined, 'x', 42, {}, []]) expect(rampPositions(bad)).toEqual([])
  })
})

describe('지분 램프 — 대비 하한 핀 (task#320 S2 ⑦)', () => {
  // 가장 연한 막대(t=1)가 트랙 위에서 실제로 보이는지. 트랙이 알파 0.11이므로 **페이지 배경 위에
  // 합성한 실효색**으로 재야 한다 — 합성 없이 rgba를 그대로 넣으면 무의미한 값이 나온다.
  it.each([
    ['라이트', LIGHT, 1.4],
    ['다크', DARK, 1.4],
  ])('%s 램프의 가장 연한 막대 vs 트랙 대비가 %s 이상', (_label, T) => {
    const faint = mixOklab(T.hi, T.lo, 1)
    const cr = contrastRatio(faint, T.track, T.bg)
    expect(cr).toBeGreaterThanOrEqual(1.4)
  })

  it('실측값을 못박는다 — 라이트 1.57:1 · 다크 2.16:1 (토큰이 바뀌면 이 핀이 깨진다)', () => {
    expect(contrastRatio(LIGHT.lo, LIGHT.track, LIGHT.bg)).toBe(1.57)
    expect(contrastRatio(DARK.lo, DARK.track, DARK.bg)).toBe(2.16)
  })

  // ⚠️ **이 축이 왜 필요한가**: 계획서는 「ΔL 0.548 · 바닥 1.49:1」을 적었는데 실측상 ΔL을 0.53까지
  //    밀면 바닥 대비가 **1.29:1**로 기준(1.4) 미달이다. 즉 두 목표가 이 색공간에서 동시에 성립하지
  //    않는다. 그 사실을 테스트로 박제해, 다음 사람이 「폭이 좁다」며 램프를 넓히면 여기서 걸리게 한다.
  it('램프를 더 넓히면(ΔL 0.53) 바닥 대비가 기준 미달로 떨어진다 — 넓히기 금지의 근거', () => {
    const wide = { hi: '#0b332f', lo: '#a8cec8' }
    const dL = Math.abs(srgbToOklab(parseColor(wide.hi)).L - srgbToOklab(parseColor(wide.lo)).L)
    expect(dL).toBeGreaterThan(0.52)
    expect(contrastRatio(wide.lo, LIGHT.track, LIGHT.bg)).toBeLessThan(1.4)
  })

  it('알파 합성을 건너뛰면 값이 달라진다 — 합성 경로가 load-bearing임을 확인', () => {
    const withBg = contrastRatio(LIGHT.lo, LIGHT.track, LIGHT.bg)
    const withWhite = contrastRatio(LIGHT.lo, LIGHT.track, '#ffffff')
    expect(withBg).not.toBe(withWhite)
  })
})

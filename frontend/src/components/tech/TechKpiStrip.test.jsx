import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import TechKpiStrip from './TechKpiStrip'

// task#280 S2 — KPI 스트립 렌더. 파생 로직 자체는 techReportUtils.test.js가 덮으므로 여기서는
// *배선*(6칩이 순서대로 Stat에 실리는가)과 *결측/실값 두 분기*, 그리고 색 variant 회귀를 잠근다.

const P = (name, tech_level, gap_years) => ({ name, country: '한국', tech_level, gap_years })

// 실데이터 SMR 판 형태(라이브 실측 2026-08-04): players 9곳 · cagr_pct null · share_pct 전무.
// 선두(gap_years===0) 2곳과 양산상용(tech_level===5) 3곳을 *다르게* 둔다 — 같으면 두 칩이 같은
// 필터를 공유하는 배선 실수가 통과해버린다.
// ⚠️ 선두 업체명은 라이브 실값 `CNNC (중국핵공업집단)` 그대로(부연 괄호 포함) — 이 칩이 6칩 중
//    **최장 값**(18px 값 폰트 기준 약 234px > 시장 규모 158px)이라 레이아웃 판단의 기준이 된다.
const SMR = {
  slug: 'smr',
  difficulty: { score: 4 },
  market: {
    cagr_pct: null,
    history: [{ year: 2024, size: { value: 5.8, currency: 'USD', unit: 'bn' } }],
    forecast: [{ year: 2030, size: { value: 15.2, currency: 'USD', unit: 'bn' } }],
  },
  players: [
    P('CNNC (중국핵공업집단)', 5, 0),
    P('NuScale', 5, 0),
    P('롤스로이스SMR', 5, 3),
    P('두산에너빌리티', 4, null),
    P('GE히타치', 4, 2),
    P('테라파워', 3, 4),
    P('X-에너지', 3, 5),
    P('홀텍', 2, 6),
    P('뉴클리어리오', 1, 8),
  ],
}

// 표시된 [라벨, 값] 쌍을 DOM 순서대로
function chips(container) {
  return [...container.querySelectorAll('.stat')].map((el) => [
    el.querySelector('.stat__label').textContent,
    el.querySelector('.stat__value').textContent,
  ])
}

describe('TechKpiStrip', () => {
  it('SMR 실판 형태에서 6칩이 계획 순서대로 렌더되고 CAGR만 —다', () => {
    const { container } = render(<TechKpiStrip report={SMR} />)
    expect(chips(container)).toEqual([
      ['기술난이도', '4/5'],
      ['선두 업체', 'CNNC (중국핵공업집단) +1'],
      ['시장 규모', '$5.8B → $15.2B'],
      ['CAGR', '—'],
      ['주요 업체', '9곳'],
      ['양산상용', '3곳'],
    ])
  })

  it('cagr_pct가 실값이면 그대로 표시한다(reusable-rocket 판 12.97)', () => {
    const { container } = render(<TechKpiStrip report={{ ...SMR, market: { ...SMR.market, cagr_pct: 12.97 } }} />)
    expect(chips(container)[3]).toEqual(['CAGR', '12.97%'])
  })

  it('빈 입력이면 예외 없이 6칩 전부 —를 표시한다', () => {
    const { container } = render(<TechKpiStrip report={{ players: [], market: {} }} />)
    const rows = chips(container)
    expect(rows.length).toBe(6)
    expect(rows.every(([, v]) => v === '—')).toBe(true)
  })

  it('report가 null이어도 렌더가 죽지 않고 6칩 골격을 유지한다', () => {
    const { container } = render(<TechKpiStrip report={null} />)
    expect(chips(container).map(([l]) => l))
      .toEqual(['기술난이도', '선두 업체', '시장 규모', 'CAGR', '주요 업체', '양산상용'])
  })

  it('⚠️ 회귀 잠금: valueColor를 넘기지 않는다 — Stat은 클래스를 문자열 조립하므로 CSS에 없는 variant를 주면 색이 조용히 사라진다(가토 ⑪)', () => {
    const { container } = render(<TechKpiStrip report={SMR} />)
    expect(container.querySelectorAll('[class*="stat__value--"]').length).toBe(0)
  })

  it('프로브 앵커 data-testid="tech-report-kpis"가 6칩을 직접 자식으로 담는다', () => {
    const { getByTestId } = render(<TechKpiStrip report={SMR} />)
    expect(getByTestId('tech-report-kpis').children.length).toBe(6)
  })

  // ⚠️ 아래 두 축은 **인라인 선언**만 잠근다 — jsdom은 레이아웃도 스타일시트도 적용하지 않으므로
  //    "실제로 접히지 않는가"는 원리적으로 여기서 잴 수 없고 라이브 프로브가 최종 판정한다(가토 ⑪).
  //    그래도 잠글 값이 있다: 고정 트랙 그리드로 되돌아가면 값보다 좁은 상자가 다시 생겨 접힘이
  //    복구되므로(F2의 원인 그 자체), 그 되돌림만은 여기서 red가 되게 한다.
  it('F2 회귀 잠금: 고정 트랙 그리드가 아니라 내용 주도 flex-wrap이고, 칩에 폭 하한이 없다', () => {
    const { getByTestId } = render(<TechKpiStrip report={SMR} />)
    const strip = getByTestId('tech-report-kpis')
    expect(strip.style.display).toBe('flex')
    expect(strip.style.flexWrap).toBe('wrap')
    expect(strip.style.gridTemplateColumns).toBe('')   // minmax 트랙 복귀 차단
    ;[...strip.children].forEach((chip) => {
      expect(chip.style.flex).toBe('1 1 auto')          // basis auto = max-content(값 폭을 받는다)
      expect(chip.style.minWidth).toBe('')              // 하한을 주면 값보다 좁은 상자가 생긴다
    })
  })

  it('F13: 회사명 칩만 일반 폰트로 덮는다 — 수치 칩 5개는 Stat의 mono 계약 유지', () => {
    const { container } = render(<TechKpiStrip report={SMR} />)
    const overridden = [...container.querySelectorAll('.stat')]
      .filter((el) => el.querySelector('.stat__value > span[style*="font-family"]'))
      .map((el) => el.querySelector('.stat__label').textContent)
    expect(overridden).toEqual(['선두 업체'])
    const span = container.querySelector('.stat__value > span')
    expect(span.style.fontFamily).toBe('var(--font-sans)')
    expect(span.style.fontVariantNumeric).toBe('normal')  // tabular-nums 상속 차단
    expect(span.textContent).toBe('CNNC (중국핵공업집단) +1')  // 폰트만 바꾸고 값은 그대로
  })

  // 실데이터 두 판을 모두 덮는다 — SMR만 보면 "선두 복수 · cagr null" 분기만 검증된다.
  it('reusable-rocket 판(선두 1곳 · cagr 12.97 · players 8)도 6칩이 결측 없이 렌더된다', () => {
    const rr = {
      slug: 'reusable-rocket',
      difficulty: { score: 4 },
      market: {
        cagr_pct: 12.97,
        history: [{ year: 2025, size: { value: 8.44, currency: 'USD', unit: 'bn' } }],
        forecast: [{ year: 2034, size: { value: 32.08, currency: 'USD', unit: 'bn' } }],
      },
      players: [
        { name: 'SpaceX', country: '미국', tech_level: 5, gap_years: 0, leader_name: 'SpaceX (Grasshopper 호핑 2013년)', share_pct: 50.9 },
        P('Blue Origin', 4, 9), P('LandSpace (란드스페이스)', 3, 10), P('Rocket Lab', 3, 11),
        P('Relativity Space', 2, 11), P('Stoke Space', 2, 11),
        P('ArianeGroup·ESA (Themis)', 2, 13), P('CNES·DLR·JAXA (Callisto)', 1, 13),
      ],
    }
    const { container } = render(<TechKpiStrip report={rr} />)
    expect(chips(container)).toEqual([
      ['기술난이도', '4/5'],
      ['선두 업체', 'SpaceX'],       // 선두 1곳이면 "+N" 없음(leader_name의 부연 괄호도 새지 않는다)
      ['시장 규모', '$8.4B → $32.1B'],
      ['CAGR', '12.97%'],
      ['주요 업체', '8곳'],
      ['양산상용', '1곳'],
    ])
  })
})

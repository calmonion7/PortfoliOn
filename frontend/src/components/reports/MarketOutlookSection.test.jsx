import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import MarketOutlookSection from './MarketOutlookSection'

// task#210 — LLM enrich가 size_current/size_forecast의 value·year에 문자열 "nan"을 기입하면
// fmtSize가 무가드 렌더로 화면에 nan/NaN을 흘리던 회귀를 잠근다.
describe('MarketOutlookSection nan 표시 가드 (task#210)', () => {
  it('value가 문자열 "nan"/"NaN"이면 시장 규모 stat 미표시, nan/NaN 미노출', () => {
    const { container, queryByText } = render(
      <MarketOutlookSection market_outlook={{
        market_name: 'AI 반도체',
        size_current: { value: 'nan', unit: '억달러', year: 2026 },
        size_forecast: { value: 'NaN', unit: '억달러', year: 2030 },
      }} />
    )
    expect(container.textContent).not.toMatch(/nan/i)
    expect(queryByText('시장 규모(현재)')).toBeNull()
    expect(queryByText('시장 규모(예상)')).toBeNull()
  })

  it('value는 정상·year가 "nan"이면 값+단위는 표시, (nan) 접미사 없음', () => {
    const { container, getByText } = render(
      <MarketOutlookSection market_outlook={{
        size_forecast: { value: 100, unit: '억달러', year: 'nan' },
      }} />
    )
    expect(container.textContent).not.toMatch(/nan/i)
    expect(getByText('100억달러')).toBeTruthy()
  })

  it('정상 값(숫자 value+year)은 기존대로 표시', () => {
    const { getByText } = render(
      <MarketOutlookSection market_outlook={{
        size_current: { value: 100, unit: '억달러', year: 2026 },
      }} />
    )
    expect(getByText('100억달러 (2026)')).toBeTruthy()
  })
})

// task#254 — 결측(null/빈 문자열)이 Number()로 0이 되어 `(0)`·`0`으로 오표시되던 회귀를 잠근다.
// `'' != null`은 true고 `Number('') === 0`이라, nan 가드(task#210)만으로는 빈 문자열이 샌다.
describe('MarketOutlookSection 결측 표시 가드 (task#254)', () => {
  it('year가 null이면 값·단위는 표시되고 (0) 접미사가 없다', () => {
    const { container, getByText } = render(
      <MarketOutlookSection market_outlook={{
        size_forecast: { value: 100, unit: '억달러', year: null },
      }} />
    )
    expect(getByText('100억달러')).toBeTruthy()
    expect(container.textContent).not.toMatch(/\(0\)/)
  })

  it("year가 빈 문자열이어도 (0) 접미사가 없다", () => {
    const { container, getByText } = render(
      <MarketOutlookSection market_outlook={{
        size_forecast: { value: 100, unit: '억달러', year: '' },
      }} />
    )
    expect(getByText('100억달러')).toBeTruthy()
    expect(container.textContent).not.toMatch(/\(0\)/)
  })

  it("value가 빈 문자열이면 시장 규모 stat 자체를 표시하지 않는다(0 미노출)", () => {
    const { container, queryByText } = render(
      <MarketOutlookSection market_outlook={{
        market_name: 'AI 반도체',
        size_current: { value: '', unit: '조원', year: 2026 },
      }} />
    )
    expect(queryByText('시장 규모(현재)')).toBeNull()
    expect(container.textContent).not.toMatch(/0조원/)
  })
})

// task#275 — segments만 있고 나머지 필드가 전부 결측이어도 early-return에 걸려 부문 섹션까지
// 통째로 사라지지 않는지 잠근다(34행 조건에 hasSegments 반영).
describe('MarketOutlookSection 사업부문 시장 분석 배선 (task#275)', () => {
  it('시장 전망 필드가 전부 결측이어도 segments가 있으면 부문 섹션이 렌더된다', () => {
    const { queryByText, getByText } = render(
      <MarketOutlookSection market_outlook={{
        segments: [{ name: '반도체', period: '2024', revenue_share_pct: 60 }],
      }} />
    )
    // 시장 규모/CAGR/점유율 stat 블록은 여전히 결측이라 미표시 — 부문 섹션만 뜬다
    expect(queryByText('시장 규모(현재)')).toBeNull()
    expect(getByText('🧩 사업부문 시장 분석')).toBeTruthy()
  })

  it('market_outlook 자체가 없으면 완전 미렌더(기존 동작 보존)', () => {
    const { container } = render(<MarketOutlookSection market_outlook={null} />)
    expect(container.innerHTML).toBe('')
  })
})

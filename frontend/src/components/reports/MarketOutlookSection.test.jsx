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

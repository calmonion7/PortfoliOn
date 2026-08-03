import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import SegmentAnalysisSection from './SegmentAnalysisSection'

// task#275 S2 — 렌더 계약: 부문명·산식 문자열 노출, 게이트 실패 시 산식만 생략, segments 부재 시 null.

const FIN = [{ period: '2024', revenue: 1000, is_consensus: false }]

describe('SegmentAnalysisSection — task#275 렌더 계약', () => {
  it('부문 3개 표본: 부문명 3개와 산식 문자열이 렌더된다', () => {
    const mo = {
      segments: [
        { name: '메모리', period: '2024', revenue_share_pct: 40, market: { size: 1200, unit: '억달러' }, share_pct: 12.0 },
        { name: '파운드리', period: '2024', revenue_share_pct: 30, market: { size: 500, unit: '억달러' }, share_pct: 20 },
        { name: '시스템반도체', period: '2024', revenue_share_pct: 20, market: { size: 300, unit: '억달러' }, share_pct: 10 },
      ],
    }
    const { getByText, getAllByText } = render(<SegmentAnalysisSection market_outlook={mo} financialsAnnual={FIN} />)

    expect(getAllByText('메모리').length).toBeGreaterThan(0)
    expect(getAllByText('파운드리').length).toBeGreaterThan(0)
    expect(getAllByText('시스템반도체').length).toBeGreaterThan(0)
    expect(getByText('1,200억달러 × 12.0% = 144억달러')).toBeTruthy()
    expect(getByText('500억달러 × 20.0% = 100억달러')).toBeTruthy()
    expect(getByText('300억달러 × 10.0% = 30억달러')).toBeTruthy()
  })

  it('게이트 실패 표본(Σ비중 초과 105%, 자사 점유율 미기입): 산식이 없고 부문명·시장 수치는 남는다', () => {
    const mo = {
      segments: [
        { name: 'A사업부', period: '2024', revenue_share_pct: 60, market: { size: 1000, unit: '억달러', cagr_pct: 8 } },
        { name: 'B사업부', period: '2024', revenue_share_pct: 45, market: { size: 500, unit: '억달러', cagr_pct: 5 } },
      ],
    }
    const { container, getByText, getAllByText } = render(<SegmentAnalysisSection market_outlook={mo} financialsAnnual={FIN} />)

    // 산식은 "×"를 포함하는 유일한 문자열 형태 — 전체 미노출로 부재를 확인
    expect(container.textContent).not.toMatch(/×/)
    expect(getAllByText('A사업부').length).toBeGreaterThan(0)
    expect(getAllByText('B사업부').length).toBeGreaterThan(0)
    // 시장 수치(규모)는 재무 게이트와 무관하게 남는다
    expect(getByText('1,000억달러')).toBeTruthy()
    expect(getByText('500억달러')).toBeTruthy()
  })

  it('market_outlook에 segments 부재 → 컴포넌트가 null 반환(아무것도 렌더 안 함)', () => {
    const { container } = render(<SegmentAnalysisSection market_outlook={{}} financialsAnnual={FIN} />)
    expect(container.firstChild).toBeNull()
  })

  it('⚠️ 회귀 잠금: market 객체 자체가 없어도 자사 점유율(share_pct)은 독립 칩으로 남는다(task#275 적대적 리뷰)', () => {
    const mo = {
      segments: [
        { name: '메모리', period: '2024', revenue_share_pct: 58.3, share_pct: 12.0 },
      ],
    }
    const { getByText, getAllByText } = render(<SegmentAnalysisSection market_outlook={mo} financialsAnnual={FIN} />)

    expect(getByText('자사 점유율')).toBeTruthy()
    expect(getByText('12.0%')).toBeTruthy()
  })

  it('⚠️ 회귀 잠금: period 불일치(매출 게이트 a)로 매출 증감이 없어도 시장기회 산식은 지워지지 않는다(task#248→#249 과보수 재발 방지)', () => {
    const mo = {
      segments: [
        { name: '메모리', period: '2099', revenue_share_pct: 58.3, market: { size: 1200, unit: '억달러' }, share_pct: 12.0 },
      ],
    }
    const { getByText, queryByText } = render(<SegmentAnalysisSection market_outlook={mo} financialsAnnual={FIN} />)

    expect(getByText('1,200억달러 × 12.0% = 144억달러')).toBeTruthy()
    expect(queryByText('매출 증감')).toBeNull()
  })
})

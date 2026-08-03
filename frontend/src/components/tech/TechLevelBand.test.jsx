import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import TechLevelBand from './TechLevelBand'

// task#277 S3 — 업체 4개 × 서로 다른 tech_level, 채워진 칸 수 일치 + 결측 행 '—' 단언.
const PLAYERS = [
  { name: '업체A', tech_level: 5, gap_years: 0, leader_name: '업체A' },   // 선두
  { name: '업체B', tech_level: 3, gap_years: 4, leader_name: '업체A' },
  { name: '업체C', tech_level: 1, gap_years: 9, leader_name: '업체A' },
  { name: '업체D', tech_level: null, gap_years: null, leader_name: null }, // 결측
]

function filledCount(row) {
  return row.querySelectorAll('.tech-level-band__cell--filled').length
}

describe('TechLevelBand', () => {
  it('업체별 채워진 칸 수가 tech_level과 각각 일치한다', () => {
    render(<TechLevelBand players={PLAYERS} />)
    const rows = screen.getAllByTestId('tech-level-band-row')
    expect(rows.length).toBe(4)
    expect(filledCount(rows[0])).toBe(5)
    expect(filledCount(rows[1])).toBe(3)
    expect(filledCount(rows[2])).toBe(1)
  })

  it('tech_level 결측 행은 밴드 대신 —를 렌더하고 칸이 없다', () => {
    render(<TechLevelBand players={PLAYERS} />)
    const rows = screen.getAllByTestId('tech-level-band-row')
    const missingRow = rows[3]
    expect(missingRow.textContent).toContain('—')
    expect(missingRow.querySelectorAll('.tech-level-band__cell').length).toBe(0)
  })

  it('gap_years===0인 업체는 별도 마커(현재 선두), 나머지는 선두 대비 N년을 보인다', () => {
    render(<TechLevelBand players={PLAYERS} />)
    expect(screen.getByText('현재 선두')).toBeTruthy()
    expect(screen.getByText('선두 대비 4년')).toBeTruthy()
    expect(screen.getByText('선두 대비 9년')).toBeTruthy()
  })

  it('⚠️ 회귀 잠금: gap_years가 음수면 "선두 대비 -N년" 대신 아무 문구도 보이지 않는다(wrong<missing, 적대 리뷰 [low])', () => {
    const players = [{ name: '업체E', tech_level: 4, gap_years: -2, leader_name: '업체A' }]
    render(<TechLevelBand players={players} />)
    expect(screen.queryByText(/-2년/)).toBeNull()
  })

  it('빈 players 배열이면 범례만 렌더하고 행은 없다', () => {
    render(<TechLevelBand players={[]} />)
    expect(screen.queryAllByTestId('tech-level-band-row').length).toBe(0)
    expect(screen.getByText('1 기초연구')).toBeTruthy()
  })
})

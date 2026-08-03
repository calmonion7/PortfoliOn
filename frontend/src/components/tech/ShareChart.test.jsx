import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import ShareChart from './ShareChart'

// task#277 S2 — 렌더 계약: 정상 렌더 · share_pct 전무 시 섹션 부재 · share_basis 없음 시 값 생략.

describe('ShareChart — task#277 렌더 계약', () => {
  it('① 정상: 업체별 막대·수치가 내림차순으로 렌더되고 캡션에 share_basis가 표기된다', () => {
    const players = [
      { name: 'A사', share_pct: 20.5 },
      { name: 'B사', share_pct: 45.2 },
      { name: 'C사', share_pct: 10 },
    ]
    const { getByText, getAllByTestId } = render(<ShareChart players={players} shareBasis="2025년 매출 기준" />)

    const rows = getAllByTestId('tech-share-chart-row')
    expect(rows).toHaveLength(3)
    // 내림차순 — 첫 행이 B사(45.2%)
    expect(rows[0].textContent).toContain('B사')
    expect(rows[0].textContent).toContain('45.2%')
    expect(rows[2].textContent).toContain('C사')

    expect(getByText('20.5%')).toBeTruthy()
    expect(getByText(/점유율 기준: 2025년 매출 기준/)).toBeTruthy()
  })

  it('② share_pct가 한 업체도 없으면 섹션 전체가 렌더되지 않는다(null)', () => {
    const players = [
      { name: 'A사', share_pct: null },
      { name: 'B사' },
    ]
    const { container } = render(<ShareChart players={players} shareBasis="기준" />)
    expect(container.firstChild).toBeNull()
  })

  it('players가 빈 배열/undefined여도 null을 반환한다', () => {
    expect(render(<ShareChart players={[]} shareBasis="기준" />).container.firstChild).toBeNull()
    expect(render(<ShareChart shareBasis="기준" />).container.firstChild).toBeNull()
  })

  it('③ share_basis가 없으면 캡션이 렌더되지 않는다(값을 빈칸으로 보이지 않는다) — 막대는 그대로 남는다', () => {
    const players = [{ name: 'A사', share_pct: 30 }]
    const { queryByTestId, getByText } = render(<ShareChart players={players} />)

    expect(queryByTestId('tech-share-chart-caption')).toBeNull()
    expect(getByText('A사')).toBeTruthy()
    expect(getByText('30.0%')).toBeTruthy()
  })

  it('⚠️ 회귀 잠금: Σshare_pct가 100%를 유의하게 넘어도 막대는 지워지지 않고 캡션에 경고만 붙는다(task#249 과보수 재발 방지)', () => {
    const players = [
      { name: 'A사', share_pct: 70 },
      { name: 'B사', share_pct: 60 },
    ]
    const { getAllByTestId, getByText } = render(<ShareChart players={players} shareBasis="기준" />)

    expect(getAllByTestId('tech-share-chart-row')).toHaveLength(2)
    expect(getByText('70.0%')).toBeTruthy()
    expect(getByText('60.0%')).toBeTruthy()
    expect(getByText(/100% 초과/)).toBeTruthy()
  })

  it('⚠️ 회귀 잠금: share_pct가 음수인 행은 필터에서 제외된다(wrong<missing — 음수 표시·Σ 오염 방지, 적대 리뷰 [low])', () => {
    const players = [
      { name: 'A사', share_pct: 30 },
      { name: 'B사', share_pct: -5 },
    ]
    const { getAllByTestId, queryByText } = render(<ShareChart players={players} shareBasis="기준" />)

    expect(getAllByTestId('tech-share-chart-row')).toHaveLength(1)
    expect(queryByText(/-5/)).toBeNull()
  })

  it('업체명은 ellipsis 상자, 수치는 flexShrink:0 형제로 분리돼 있다(잘림 축 회귀 방지)', () => {
    const players = [{ name: '아주 긴 업체명 테스트 컴퍼니 이름', share_pct: 12.3 }]
    const { getByTestId } = render(<ShareChart players={players} shareBasis="기준" />)

    const row = getByTestId('tech-share-chart-row')
    const nameSpan = row.querySelector('span[title]')
    expect(nameSpan.style.textOverflow).toBe('ellipsis')
    expect(nameSpan.style.whiteSpace).toBe('nowrap')

    const pctSpan = [...row.querySelectorAll('span')].find((s) => s.textContent === '12.3%')
    expect(pctSpan.style.flexShrink).toBe('0')
  })
})

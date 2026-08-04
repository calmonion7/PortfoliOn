import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import CategoryGroups, { groupByCategory } from './CategoryGroups'

// task#281 S4 — 계보 분류 그룹 칩. 판정축은 "그룹 수 · 칩 총계 · 섹션 유무" 셋뿐이다
// (색·간격은 jsdom이 못 보므로 라이브 프로브 몫 — TESTING.md §9).

// SMR 노형 계열을 본뜬 3분류 × 9곳
const NINE = [
  { name: 'CNNC', category: '경수형' },
  { name: 'NuScale', category: '경수형' },
  { name: 'Rolls-Royce', category: '경수형' },
  { name: 'GE Hitachi', category: '비등수형' },
  { name: '두산에너빌리티', category: '비등수형' },
  { name: 'X-energy', category: '고온가스로' },
  { name: 'USNC', category: '고온가스로' },
  { name: 'Kairos Power', category: '고온가스로' },
  { name: 'TerraPower', category: '고온가스로' },
]

function groupSizes() {
  return screen.getAllByTestId('tech-report-category-group')
    .map((g) => g.querySelectorAll('[data-testid="tech-report-category-chip"]').length)
}

describe('CategoryGroups', () => {
  it('3분류 × 업체 9곳 → 그룹 3개이고 그룹별 칩 수의 합이 분류가 있는 업체 수와 같다', () => {
    render(<CategoryGroups players={NINE} />)
    const sizes = groupSizes()
    expect(sizes.length).toBe(3)
    expect(sizes.reduce((a, b) => a + b, 0)).toBe(NINE.length)
    // 라벨은 입력 순서(페이지의 sortPlayers 단일 순서)를 따른다
    expect(screen.getAllByTestId('tech-report-category-group').map((g) => g.firstChild.textContent))
      .toEqual(['경수형', '비등수형', '고온가스로'])
  })

  it('일부만 category를 가지면 나머지가 버려지지 않고 미분류 그룹으로 보존된다(맨 뒤)', () => {
    // 미분류 3형태를 한 입력에 섞는다 — 구발행물(키 없음) · 명시적 null · 공백 문자열
    const players = [
      { name: 'CNNC', category: '경수형' },
      { name: 'NuScale' },                      // 구발행물: category 키 자체가 없다(undefined)
      { name: 'X-energy', category: '고온가스로' },
      { name: 'TerraPower', category: null },
      { name: 'Kairos', category: '   ' },
    ]
    render(<CategoryGroups players={players} />)
    const groups = screen.getAllByTestId('tech-report-category-group')
    expect(groups.length).toBe(3)
    // 칩 총계 == 입력 업체 수 — 한 곳도 사라지지 않는다
    expect(screen.getAllByTestId('tech-report-category-chip').length).toBe(players.length)

    const last = groups[groups.length - 1]
    expect(last.textContent).toContain('미분류')
    const names = [...last.querySelectorAll('[data-testid="tech-report-category-chip"]')].map((c) => c.textContent)
    expect(names).toEqual(['NuScale', 'TerraPower', 'Kairos'])
  })

  it('category 전무면 섹션 DOM이 없다(키 없음·null·공백 3형태 모두)', () => {
    const shapes = [
      [{ name: 'A' }, { name: 'B' }],                                  // 구발행물 실데이터 형태
      [{ name: 'A', category: null }, { name: 'B', category: null }],
      [{ name: 'A', category: '' }, { name: 'B', category: '  ' }],
    ]
    for (const players of shapes) {
      const { unmount } = render(<CategoryGroups players={players} />)
      expect(screen.queryByTestId('tech-report-categories')).toBeNull()
      unmount()
    }
  })

  it('players 미전달·비배열이어도 죽지 않고 섹션이 없다', () => {
    const { unmount } = render(<CategoryGroups />)
    expect(screen.queryByTestId('tech-report-categories')).toBeNull()
    unmount()
    render(<CategoryGroups players={null} />)
    expect(screen.queryByTestId('tech-report-categories')).toBeNull()
  })

  it('루틴이 실제로 category="미분류"를 써도 분류 없는 버킷과 합쳐지지 않는다(task#281 F6)', () => {
    // category는 자유 문자열이라 루틴이 표시 라벨과 같은 값을 쓸 수 있다. 센티넬을 리터럴로 두면
    // 그때 두 버킷이 같은 Map 키를 공유해 **조용히** 합쳐진다(업체 수는 맞아서 총계로도 안 잡힌다).
    const players = [{ name: 'A', category: '미분류' }, { name: 'B' }]
    const groups = groupByCategory(players)
    expect(groups.length).toBe(2)                       // 합쳐지면 1
    expect(groups.map((g) => g.players.map((p) => p.name))).toEqual([['A'], ['B']])
    expect(groups[groups.length - 1].category).toBe('미분류')   // 미분류 버킷은 항상 맨 뒤

    render(<CategoryGroups players={players} />)
    expect(groupSizes()).toEqual([1, 1])
    expect(screen.getAllByTestId('tech-report-category-chip').length).toBe(2)
    // 같은 라벨 두 그룹이 React key로 충돌하지 않는다(중복 key는 console.error로 새어나온다)
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    render(<CategoryGroups players={players} />)
    expect(errSpy).not.toHaveBeenCalled()
    errSpy.mockRestore()
  })

  it('groupByCategory는 페이지 게이트와 컴포넌트가 공유하는 단일 판정이다(전무 → 빈 배열)', () => {
    // 페이지가 다른 식으로 게이트하면 공백 문자열만 있는 판에서 제목만 남고 본문이 사라진다
    expect(groupByCategory([{ name: 'A', category: '  ' }])).toEqual([])
    expect(groupByCategory(NINE).length).toBe(3)
  })
})

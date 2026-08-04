import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import TechGraph, { techGraphLayout } from './TechGraph'

// task#277 S4 — 3열 연관기술 관계도. TDD 대상은 techGraphLayout(좌표 계약을 리터럴이 아니라
// 불변식으로 단언 — 정당한 크기 변경에 거짓 실패하지 않게). 렌더 테스트는 TechGraph가 그 결과를
// 실제로 그리는지만 얕게 확인한다(jsdom은 SVG geometry가 아니라 DOM 구조·텍스트만 신뢰할 수 있다).

const WIDTH = 600
const HEIGHT = 300

describe('techGraphLayout — 좌표 불변식', () => {
  it('① 같은 열 x는 동일, 열 간 x는 단조 증가', () => {
    const { nodes } = techGraphLayout({
      prerequisites: ['전제1', '전제2'],
      target: '대상기술',
      derivatives: ['파생1', '파생2', '파생3'],
      width: WIDTH, height: HEIGHT,
    })
    const xsByCol = [0, 1, 2].map((col) => nodes.filter((n) => n.col === col).map((n) => n.x))
    xsByCol.forEach((xs) => {
      if (xs.length > 1) expect(new Set(xs).size).toBe(1) // 같은 열은 x 동일
    })
    const colX = xsByCol.map((xs) => xs[0])
    expect(colX[0]).toBeLessThan(colX[1])
    expect(colX[1]).toBeLessThan(colX[2])
  })

  it('② 같은 열 노드 bbox는 서로 겹치지 않는다(y 간격 ≥ h)', () => {
    const { nodes } = techGraphLayout({
      prerequisites: ['a', 'b', 'c', 'd'],
      target: 'T',
      derivatives: ['e', 'f'],
      width: WIDTH, height: HEIGHT,
    })
    ;[0, 1, 2].forEach((col) => {
      const rows = nodes.filter((n) => n.col === col).sort((a, b) => a.y - b.y)
      for (let i = 1; i < rows.length; i++) {
        expect(rows[i].y - rows[i - 1].y).toBeGreaterThanOrEqual(rows[i - 1].h - 1e-6)
      }
    })
  })

  it('③ 모든 노드가 0 ≤ x,y 및 x+w ≤ width, y+h ≤ height 안에 있다', () => {
    const { nodes } = techGraphLayout({
      prerequisites: ['a', 'b', 'c', 'd', 'e'],
      target: '대상기술',
      derivatives: ['f'],
      width: WIDTH, height: HEIGHT,
    })
    nodes.forEach((n) => {
      expect(n.x).toBeGreaterThanOrEqual(0)
      expect(n.y).toBeGreaterThanOrEqual(0)
      expect(n.x + n.w).toBeLessThanOrEqual(WIDTH + 1e-6)
      expect(n.y + n.h).toBeLessThanOrEqual(HEIGHT + 1e-6)
    })
  })

  it('④ 빈 열(전제 0개)에서도 대상·파생이 정상 배치된다', () => {
    const { nodes } = techGraphLayout({
      prerequisites: [],
      target: '대상기술',
      derivatives: ['파생1', '파생2'],
      width: WIDTH, height: HEIGHT,
    })
    expect(nodes.filter((n) => n.col === 0)).toHaveLength(0)
    const target = nodes.find((n) => n.id === 'target')
    expect(target).toBeTruthy()
    expect(Number.isFinite(target.x)).toBe(true)
    expect(Number.isFinite(target.y)).toBe(true)
    expect(nodes.filter((n) => n.col === 2)).toHaveLength(2)
  })

  it('⑤ 열당 최대 5노드 — 6개 입력이면 앞 4개 + 마지막 슬롯이 "+2개" 폴드로 접혀 총 5노드', () => {
    const { nodes } = techGraphLayout({
      prerequisites: ['a', 'b', 'c', 'd', 'e', 'f'],
      target: 'T',
      derivatives: [],
      width: WIDTH, height: HEIGHT,
    })
    const col0 = nodes.filter((n) => n.col === 0)
    expect(col0).toHaveLength(5)
    const fold = col0[col0.length - 1]
    expect(fold.fold).toBe(true)
    expect(fold.label).toBe('+2개')
    expect(col0.slice(0, 4).every((n) => !n.fold)).toBe(true)
  })

  it('5개 이하 입력은 폴드 없이 전부 개별 노드', () => {
    const { nodes } = techGraphLayout({
      prerequisites: ['a', 'b', 'c', 'd', 'e'],
      target: 'T',
      derivatives: [],
      width: WIDTH, height: HEIGHT,
    })
    const col0 = nodes.filter((n) => n.col === 0)
    expect(col0).toHaveLength(5)
    expect(col0.every((n) => !n.fold)).toBe(true)
  })

  it('target 없이도 예외 없이 배치되고, 엣지는 생성되지 않는다', () => {
    const { nodes, edges } = techGraphLayout({
      prerequisites: ['a'], target: undefined, derivatives: ['b'], width: WIDTH, height: HEIGHT,
    })
    expect(nodes.find((n) => n.id === 'target')).toBeUndefined()
    expect(edges).toHaveLength(0)
  })

  it('prerequisites→target, target→derivatives 엣지가 각 개수만큼 생성된다', () => {
    const { edges } = techGraphLayout({
      prerequisites: ['a', 'b'], target: 'T', derivatives: ['c', 'd', 'e'], width: WIDTH, height: HEIGHT,
    })
    expect(edges.filter((e) => e.to === 'target')).toHaveLength(2)
    expect(edges.filter((e) => e.from === 'target')).toHaveLength(3)
  })

  it('입력이 전부 비면(target도 없음) 빈 nodes/edges', () => {
    expect(techGraphLayout({})).toEqual({ nodes: [], edges: [] })
  })

  it('⑥ maxN=1(열마다 노드 1개뿐인 흔한 케이스)이어도 노드 높이가 SVG 전체 높이로 늘어나지 않는다(적대 리뷰 [high])', () => {
    const { nodes } = techGraphLayout({
      prerequisites: ['리튬 정제'], target: '전고체 배터리', derivatives: ['전고체 셀'],
      width: 640, height: 260,
    })
    expect(nodes.length).toBeGreaterThan(0)
    nodes.forEach((n) => expect(n.h).toBeLessThanOrEqual(60))
  })
})

describe('TechGraph — 렌더', () => {
  it('전제·대상·파생 라벨이 title로 노출된다(ellipsis 대비 원문은 title에 보존)', () => {
    const related = { prerequisites: ['리튬 정제'], derivatives: ['전고체 셀'] }
    const { container } = render(<TechGraph related={related} target="전고체 배터리" />)
    const titles = [...container.querySelectorAll('title')].map((t) => t.textContent)
    expect(titles).toEqual(expect.arrayContaining(['리튬 정제', '전고체 배터리', '전고체 셀']))
  })

  it('6개 입력 열은 "+2개" 폴드 노드를 렌더한다', () => {
    const related = { prerequisites: ['a', 'b', 'c', 'd', 'e', 'f'] }
    const { getAllByText } = render(<TechGraph related={related} target="T" />)
    // title·text 양쪽에 같은 문자열이 실려 매치가 2건 이상 — 존재만 확인
    expect(getAllByText('+2개').length).toBeGreaterThan(0)
  })

  it('svg는 role="img"가 아니라 aria-hidden — 자손 텍스트를 접근성 트리에서 프루닝하지 않는다(task#282)', () => {
    const related = { prerequisites: ['리튬 정제'], derivatives: ['전고체 셀'] }
    const { container } = render(<TechGraph related={related} target="전고체 배터리" />)
    expect(container.querySelectorAll('[role="img"]')).toHaveLength(0)
    const svgs = container.querySelectorAll('svg[aria-hidden="true"]')
    expect(svgs).toHaveLength(1)
  })

  it('sr-only 목록은 SVG가 5개로 캡한 열의 초과분까지 전부 텍스트로 싣는다(task#282)', () => {
    const related = { prerequisites: ['a', 'b', 'c', 'd', 'e', 'f'], derivatives: ['g', 'h'] }
    const { container } = render(<TechGraph related={related} target="T" />)
    const svgNodes = container.querySelectorAll('[data-col="0"]')
    expect(svgNodes).toHaveLength(5) // 4개 개별 + 폴드 1개 — 초과분 f는 SVG에 없음

    const srList = container.querySelector('[data-testid="tech-graph-sr-list"]')
    expect(srList).toBeTruthy()
    expect(srList.className).toContain('sr-only')
    const srText = srList.textContent
    ;['a', 'b', 'c', 'd', 'e', 'f'].forEach((label) => expect(srText).toContain(label))
    expect(srText).toContain('T')
    expect(srText).toContain('g')
    expect(srText).toContain('h')
  })

  it('보완/경합 기술은 칩 그룹으로 렌더된다(그래프 노드가 아님)', () => {
    const related = { complements: ['냉매 기술'], competitors: ['화학전지'] }
    const { getByText, queryByTestId } = render(<TechGraph related={related} target="SMR" />)
    expect(getByText('보완 기술')).toBeTruthy()
    expect(getByText('냉매 기술')).toBeTruthy()
    expect(getByText('경합 기술')).toBeTruthy()
    expect(getByText('화학전지')).toBeTruthy()
    expect(queryByTestId('tech-graph-svg')).toBeTruthy() // target만 있어도 그래프는 그려진다
  })

  it('related·target 전부 비면 아무것도 렌더하지 않는다(null)', () => {
    const { container } = render(<TechGraph related={{}} />)
    expect(container.firstChild).toBeNull()
  })
})

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import BusinessFormationSection from './BusinessFormationSection'
import api from '../../api'

// jsdom에서 recharts ResponsiveContainer는 0크기라 아무것도 렌더되지 않는다(CONVENTIONS §9.6) —
// 관측점은 SVG가 아니라 타일 텍스트·차트 캡션이다.
vi.mock('../../api', () => ({ default: { get: vi.fn() } }))

// jsdom엔 matchMedia·IntersectionObserver가 없다(SectionCard가 쓰는 useReveal 훅).
window.matchMedia = window.matchMedia || (() => ({ matches: false, addEventListener() {}, removeEventListener() {} }))
globalThis.IntersectionObserver = class {
  observe() {} unobserve() {} disconnect() {}
}

beforeEach(() => { vi.clearAllMocks() })

function mockData(data) {
  api.get.mockResolvedValue({ data })
}

function sector(over = {}) {
  return {
    history: [{ date: '2026-05-01', value: 12800 }, { date: '2026-06-01', value: 12999 }],
    ma3: [{ date: '2026-06-01', value: 12510 }],
    latest_raw: 12999, latest_ma3: 12510, latest_date: '2026-06-01', prev_raw: 12800,
    ...over,
  }
}

// SectionCard는 기본 접힘(task#201) — 로딩 중엔 버튼이 없는 정적 div라 title 텍스트로
// 대기하면 로딩 상태를 잡아버린다. 실제 인터랙티브 <button>이 뜨는 순간까지 기다린 뒤 클릭한다.
async function openSection() {
  const { container } = render(<BusinessFormationSection />)
  const button = await screen.findByRole('button')
  fireEvent.click(button)
  return container
}

describe('BusinessFormationSection (task#296 S4)', () => {
  it('정상 렌더 — 부문 2개 타일에 3MA·원계열 값이 함께 보이고 차트 캡션에 3MA 명시', async () => {
    mockData({
      information: sector(),
      professional: sector({ latest_raw: 83500, latest_ma3: 82100, prev_raw: 83000 }),
    })
    const container = await openSection()

    const tiles = [...container.querySelectorAll('.metric-tile')]
    expect(tiles.length).toBe(2)
    expect(tiles[0].textContent).toContain('12,510')   // 3MA
    expect(tiles[0].textContent).toContain('3MA')
    expect(tiles[0].textContent).toContain('12,999')   // 원계열
    expect(tiles[1].textContent).toContain('82,100')
    expect(tiles[1].textContent).toContain('83,500')

    // 원계열이 아니라는 사실이 화면에 보여야 한다
    const captions = [...container.querySelectorAll('.chartbox .sub')].map(el => el.textContent)
    expect(captions.length).toBe(2)
    expect(captions.every(c => c.includes('3개월 이동평균'))).toBe(true)
  })

  it('error 응답 분기 — data.error면 빈상태 문구만 표시하고 타일·차트는 렌더하지 않는다', async () => {
    mockData({ error: 'FRED_API_KEY 환경변수가 필요합니다.' })
    const container = await openSection()

    expect(container.textContent).toMatch(/FRED_API_KEY/)
    expect(container.querySelectorAll('.metric-tile').length).toBe(0)
    expect(container.querySelectorAll('.chartbox').length).toBe(0)
  })

  it('빈 시계열 분기 — 두 부문 모두 데이터가 없어도 크래시 없이 렌더하고 값은 대체 문자로 표시', async () => {
    const empty = sector({ history: [], ma3: [], latest_raw: null, latest_ma3: null, latest_date: null, prev_raw: null })
    mockData({ information: empty, professional: { ...empty } })
    const container = await openSection()

    const tiles = [...container.querySelectorAll('.metric-tile')]
    expect(tiles.length).toBe(2)
    for (const tile of tiles) {
      expect(tile.querySelector('.v').textContent).toContain('-')
      expect(tile.querySelector('.d')).toBeNull()   // 전월 대비 없음(양쪽 값 없음)
    }
  })
})

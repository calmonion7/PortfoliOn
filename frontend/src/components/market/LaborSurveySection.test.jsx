import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import LaborSurveySection, { fmtEokMyeong, fmtManMyeongDelta } from './LaborSurveySection'
import api from '../../api'

// jsdom에서 recharts ResponsiveContainer는 0크기라 아무것도 렌더되지 않는다(CONVENTIONS §9.6) —
// 관측점은 SVG가 아니라 타일 텍스트·차트 캡션·설명문이다. 축·틱·이중축 배선은 여기서 단언하지 않는다.
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

function survey(over = {}) {
  return {
    history: [{ date: '2025-07-01', value: 157000 }, { date: '2026-07-01', value: 158858 }],
    latest: 158858, latest_date: '2026-07-01', change_12m: 1858,
    ...over,
  }
}

// SectionCard는 기본 접힘(task#201) — 로딩 중엔 버튼이 없는 정적 div라 title 텍스트로
// 대기하면 로딩 상태를 잡아버린다. 실제 인터랙티브 <button>이 뜨는 순간까지 기다린 뒤 클릭한다.
async function openSection() {
  const { container } = render(<LaborSurveySection />)
  const button = await screen.findByRole('button')
  fireEvent.click(button)
  return container
}

describe('LaborSurveySection (task#294 S4)', () => {
  it('정상 렌더 — 조사 2개 타일에 최신값·12개월 증감이 부호와 함께 보이고 이중축 설명문이 있다', async () => {
    mockData({
      household: survey({ latest: 162177, change_12m: -500 }),
      establishment: survey({ latest: 158858, change_12m: 1858 }),
    })
    const container = await openSection()

    const tiles = [...container.querySelectorAll('.metric-tile')]
    expect(tiles.length).toBe(2)
    expect(tiles[0].textContent).toContain('1.62억 명')   // 가계조사 최신값
    expect(tiles[0].textContent).toContain('▼')            // 감소 부호
    expect(tiles[0].textContent).toContain('50.0만 명')
    expect(tiles[1].textContent).toContain('1.59억 명')   // 기업조사 최신값
    expect(tiles[1].textContent).toContain('▲')            // 증가 부호
    expect(tiles[1].textContent).toContain('185.8만 명')

    // 이중축 오독 방지 문구가 화면에 있어야 한다
    expect(container.textContent).toMatch(/의미가 아닙니다/)
    const caption = container.querySelector('.chartbox .sub')
    expect(caption.textContent).toMatch(/좌.*우|이중축/)
  })

  it('error 응답 분기 — data.error면 빈상태 문구만 표시하고 타일·차트는 렌더하지 않는다', async () => {
    mockData({ error: 'FRED_API_KEY 환경변수가 필요합니다.' })
    const container = await openSection()

    expect(container.textContent).toMatch(/FRED_API_KEY/)
    expect(container.querySelectorAll('.metric-tile').length).toBe(0)
    expect(container.querySelectorAll('.chartbox').length).toBe(0)
  })

  it('빈 시계열 분기 — 두 조사 모두 데이터가 없어도 크래시 없이 렌더하고 값은 대체 문자로 표시', async () => {
    const empty = survey({ history: [], latest: null, latest_date: null, change_12m: null })
    mockData({ household: empty, establishment: { ...empty } })
    const container = await openSection()

    const tiles = [...container.querySelectorAll('.metric-tile')]
    expect(tiles.length).toBe(2)
    for (const tile of tiles) {
      expect(tile.querySelector('.v').textContent).toContain('-')
      expect(tile.querySelector('.d')).toBeNull()   // 12개월 전 대비 없음(값 없음)
    }
  })

  it('fmtEokMyeong — 천 명 입력을 억 명으로 변환한다(krFmt와 무관한 전용 포매터)', () => {
    expect(fmtEokMyeong(158858)).toBe('1.59억 명')
    expect(fmtEokMyeong(162177)).toBe('1.62억 명')
    expect(fmtEokMyeong(null)).toBe('-')
  })

  it('fmtManMyeongDelta — 천 명 단위 증감을 만 명으로 변환한다', () => {
    expect(fmtManMyeongDelta(1858)).toBe('185.8만 명')
    expect(fmtManMyeongDelta(50)).toBe('5.0만 명')
    expect(fmtManMyeongDelta(null)).toBe('-')
  })
})

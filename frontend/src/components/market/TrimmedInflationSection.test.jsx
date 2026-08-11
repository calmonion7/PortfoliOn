import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import TrimmedInflationSection, { fmtPct2 } from './TrimmedInflationSection'
import api from '../../api'

// jsdom에서 recharts ResponsiveContainer는 0크기라 아무것도 렌더되지 않는다(CONVENTIONS §9.6) —
// 관측점은 SVG가 아니라 범례 텍스트·차트 캡션·설명문이다. 축·틱·4선 배선은 여기서 단언하지 않는다.
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

function series(over = {}) {
  return {
    history: [{ date: '2025-07-01', value: 3.10 }, { date: '2026-07-01', value: 3.294 }],
    latest: 3.294, latest_date: '2026-07-01',
    ...over,
  }
}

// SectionCard는 기본 접힘(task#201) — 로딩 중엔 버튼이 없는 정적 div라 title 텍스트로
// 대기하면 로딩 상태를 잡아버린다. 실제 인터랙티브 <button>이 뜨는 순간까지 기다린 뒤 클릭한다.
async function openSection() {
  const { container } = render(<TrimmedInflationSection />)
  const button = await screen.findByRole('button')
  fireEvent.click(button)
  return container
}

describe('TrimmedInflationSection (task#295 S4)', () => {
  it('정상 렌더 — 범례 4개에 지표별 최신값이 소수 2자리로 보이고 단일축 설명문이 있다', async () => {
    mockData({
      core_pce: series({ latest: 3.294 }),
      headline_pce: series({ latest: 3.671 }),
      dallas_trimmed: series({ latest: 2.85 }),
      cleveland_trimmed: series({ latest: 3.4 }),
    })
    const container = await openSection()

    const items = [...container.querySelectorAll('.chart-legend__item')]
    expect(items.length).toBe(4)
    const text = items.map(el => el.textContent).join(' | ')
    expect(text).toContain('3.29%')   // core_pce, toFixed(2) — 원값 3.294가 잘리지 않고 라운딩됐는지
    expect(text).toContain('3.67%')   // headline_pce
    expect(text).toContain('2.85%')   // dallas_trimmed
    expect(text).toContain('3.40%')   // cleveland_trimmed — 소수 2자리 강제(3.4가 아니라 3.40)

    // 코어와의 차이를 설명하는 문구가 있어야 한다
    expect(container.textContent).toMatch(/그때그때/)
    const caption = container.querySelector('.chartbox .sub')
    expect(caption.textContent).toMatch(/YoY|단일 축/)
  })

  it('error 응답 분기 — data.error면 빈상태 문구만 표시하고 범례·차트는 렌더하지 않는다', async () => {
    mockData({ error: 'FRED_API_KEY 환경변수가 필요합니다.' })
    const container = await openSection()

    expect(container.textContent).toMatch(/FRED_API_KEY/)
    expect(container.querySelectorAll('.chart-legend__item').length).toBe(0)
    expect(container.querySelectorAll('.chartbox').length).toBe(0)
  })

  it('빈 시계열 분기 — 4계열 모두 데이터가 없어도 크래시 없이 렌더하고 값은 대체 문자로 표시', async () => {
    const empty = series({ history: [], latest: null, latest_date: null })
    mockData({
      core_pce: empty, headline_pce: { ...empty },
      dallas_trimmed: { ...empty }, cleveland_trimmed: { ...empty },
    })
    const container = await openSection()

    const items = [...container.querySelectorAll('.chart-legend__item')]
    expect(items.length).toBe(4)
    for (const el of items) expect(el.textContent).toContain('-')
  })

  it('일부 지표만 결손 — core_pce·headline_pce만 값이 있어도 나머지 결손 지표와 함께 4개 전부 그려진다', async () => {
    const empty = series({ history: [], latest: null, latest_date: null })
    mockData({
      core_pce: series({ latest: 3.29 }),
      headline_pce: series({ latest: 3.67 }),
      dallas_trimmed: empty,
      cleveland_trimmed: empty,
    })
    const container = await openSection()

    const items = [...container.querySelectorAll('.chart-legend__item')]
    expect(items.length).toBe(4)   // 결손 지표도 항목 자체는 그려진다 — 통째로 사라지지 않음
    const text = items.map(el => el.textContent)
    expect(text.some(t => t.includes('3.29%'))).toBe(true)
    expect(text.some(t => t.includes('3.67%'))).toBe(true)
    expect(text.filter(t => t.includes('-')).length).toBe(2)   // dallas·cleveland는 대체 문자
  })

  it('fmtPct2 — 소수 2자리 % 포맷(null은 대체 문자)', () => {
    expect(fmtPct2(3.294)).toBe('3.29%')
    expect(fmtPct2(3.4)).toBe('3.40%')
    expect(fmtPct2(null)).toBe('-')
  })
})

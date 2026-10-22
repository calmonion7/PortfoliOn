import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import SemiconductorSection from './SemiconductorSection'
import api from '../../api'

// jsdom: recharts는 0크기라 SVG를 안 그린다 — 관측점은 data-item·행·문구다.
vi.mock('../../api', () => ({ default: { get: vi.fn() } }))
window.matchMedia = window.matchMedia || (() => ({ matches: false, addEventListener() {}, removeEventListener() {} }))
globalThis.IntersectionObserver = class { observe() {} unobserve() {} disconnect() {} }

const hist = [{ date: '2026-10-20', value: 1 }, { date: '2026-10-21', value: 2 }]
const item = (id, name) => ({ id, name, avg: 3.5, high: 4, low: 3, change_pct: 1.2, history: hist })
const SEMI = { fetched_at: null, categories: [
  { key: 'dram_spot', label: 'DRAM 현물', updated_at: '2026-10-21', items: [item('dram:475', 'DDR5 16Gb'), item('dram:999', 'DDR4 8Gb')] },
  { key: 'module', label: '모듈', updated_at: '2026-10-18', items: [item('mod:1', 'DDR5 RDIMM 32GB'), item('mod:2', 'DDR4 UDIMM 16GB')] },
] }
const SOX = { current: 5000, change_pct: -1.5, history: hist }

function mock({ indices = { data: { indices: { sox: SOX } } }, semi = { data: SEMI } } = {}) {
  api.get.mockImplementation(url => {
    const r = url.includes('indices') ? indices : semi
    return r instanceof Error ? Promise.reject(r) : Promise.resolve(r)
  })
}
beforeEach(() => vi.clearAllMocks())

describe('SemiconductorSection (task#403 S5)', () => {
  it('기본 선택은 dram:475이고 분류 헤더에 라벨·갱신일이 보인다', async () => {
    mock()
    render(<SemiconductorSection />)
    expect((await screen.findByTestId('semi-chart')).dataset.item).toBe('dram:475')
    expect(screen.getByTestId('semi-row-dram:475').getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByText('DRAM 현물')).toBeTruthy()
    expect(screen.getByText('2026-10-21')).toBeTruthy()
  })

  it('행을 누르면 차트 품목과 강조가 바뀐다', async () => {
    mock()
    render(<SemiconductorSection />)
    await screen.findByTestId('semi-chart')
    fireEvent.click(screen.getByTestId('semi-row-dram:999'))
    expect(screen.getByTestId('semi-chart').dataset.item).toBe('dram:999')
    expect(screen.getByTestId('semi-row-dram:999').getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByTestId('semi-row-dram:475').getAttribute('aria-pressed')).toBe('false')
  })

  it('0건은 빈 문구, 실패는 오류 문구이며 서로 섞이지 않는다', async () => {
    mock({ semi: { data: { categories: [], fetched_at: null } } })
    const a = render(<SemiconductorSection />)
    expect(await screen.findByText(/아직 없습니다/)).toBeTruthy()
    a.unmount()

    mock({ semi: new Error('x') })
    render(<SemiconductorSection />)
    expect(await screen.findByRole('alert')).toBeTruthy()
    await waitFor(() => expect(screen.queryByText(/아직 없습니다/)).toBeNull())
  })

  it('초기에는 DRAM 현물 분류 표만 렌더한다 (task#404)', async () => {
    mock()
    render(<SemiconductorSection />)
    await screen.findByTestId('semi-chart')
    expect(screen.getByLabelText('메모리 분류').value).toBe('dram_spot')
    expect(screen.getByTestId('semi-cat-dram_spot')).toBeTruthy()
    expect(screen.queryByTestId('semi-cat-module')).toBeNull()
    expect(screen.queryByTestId('semi-row-mod:1')).toBeNull()
  })

  it('분류를 바꾸면 그 분류 행만 보이고 차트는 그 분류 첫 품목이다 (task#404)', async () => {
    mock()
    render(<SemiconductorSection />)
    await screen.findByTestId('semi-chart')
    fireEvent.change(screen.getByTestId('semi-cat-select'), { target: { value: 'module' } })
    expect(screen.queryByTestId('semi-cat-dram_spot')).toBeNull()
    expect(screen.getByTestId('semi-row-mod:1').getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByTestId('semi-row-mod:2')).toBeTruthy()
    expect(screen.queryByTestId('semi-row-dram:475')).toBeNull()
    expect(screen.getByTestId('semi-chart').dataset.item).toBe('mod:1')
    expect(screen.getByTestId('semi-cat-updated').textContent).toBe('2026-10-18')
  })

  it('DEFAULT_ITEM이 응답에 없어도 첫 분류의 첫 품목으로 차트가 렌더된다 (task#404)', async () => {
    mock({ semi: { data: { fetched_at: null, categories: [SEMI.categories[1]] } } })
    render(<SemiconductorSection />)
    expect((await screen.findByTestId('semi-chart')).dataset.item).toBe('mod:1')
    expect(screen.getByTestId('semi-row-mod:1').getAttribute('aria-pressed')).toBe('true')
  })

  it('둘 다 실패하면 섹션 오류만 보이고 빈 문구는 없다', async () => {
    mock({ indices: new Error('x'), semi: new Error('y') })
    render(<SemiconductorSection />)
    expect(await screen.findByText('오류')).toBeTruthy()
    expect(screen.queryByText(/아직 없습니다/)).toBeNull()
  })
})

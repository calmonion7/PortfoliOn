// task#379 S1 — StockSearchBox 검색 이펙트 레이스(B49 §7.3).
//
// 디바운스는 호출을 줄일 뿐 in-flight 응답을 취소하지 않는다. 느린 1차 응답이 늦게 착지하면
// 입력창은 새 검색어인데 드롭다운은 옛 결과(→ 틀린 종목 선택)이고, 옛 finally가 새 요청의
// 로딩 표시를 끈다. 검색어를 바꾸면 옛 결과를 새 검색어 아래 남기지 않는다(보존).
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'

vi.mock('../api', () => ({ default: { get: vi.fn() } }))

import api from '../api'
import StockSearchBox from '../components/StockSearchBox'

function deferred() {
  let resolve, reject
  const promise = new Promise((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}
const hit = (name) => ({ data: [{ ticker: name.toUpperCase(), name, market: 'US', exchange: '', exchange_display: 'NASDAQ' }] })
const flush = () => act(() => new Promise((r) => setTimeout(r, 0)))

function mockQueries(byQ) {
  api.get.mockImplementation((url, config) => byQ[config.params.q].promise)
}
const type = (v) => fireEvent.change(screen.getByRole('textbox'), { target: { value: v } })
const issued = (q) => waitFor(() => expect(api.get).toHaveBeenCalledWith('/api/stocks/search',
  expect.objectContaining({ params: expect.objectContaining({ q }) })), { timeout: 1500 })

beforeEach(() => { vi.clearAllMocks() })

describe('StockSearchBox — 검색어 가드', () => {
  it('옛 검색어 응답이 늦게 착지해도 새 검색어 결과를 덮지 않는다', async () => {
    const a = deferred(); const ab = deferred()
    mockQueries({ sam: a, samsung: ab })
    render(<StockSearchBox onSelect={() => {}} />)
    type('sam'); await issued('sam')
    type('samsung'); await issued('samsung')

    ab.resolve(hit('samsung-electronics'))
    await flush()
    a.resolve(hit('sampo'))   // 옛 검색어가 마지막에 착지
    await flush()
    expect(screen.getByText('samsung-electronics')).toBeInTheDocument()
    expect(screen.queryByText('sampo')).not.toBeInTheDocument()
  })

  it('옛 검색어 요청의 finally가 진행 중인 새 요청의 로딩 표시를 끄지 않는다', async () => {
    const a = deferred(); const ab = deferred()
    mockQueries({ sam: a, samsung: ab })
    render(<StockSearchBox onSelect={() => {}} />)
    type('sam'); await issued('sam')
    type('samsung'); await issued('samsung')

    a.resolve(hit('sampo'))
    await flush()
    expect(screen.getByText('⏳')).toBeInTheDocument()

    ab.resolve(hit('samsung-electronics'))
    await flush()
    expect(screen.getByText('🔍')).toBeInTheDocument()
  })

  it('옛 검색어 요청의 실패가 새 검색어 결과를 지우지 않는다', async () => {
    const a = deferred(); const ab = deferred()
    mockQueries({ sam: a, samsung: ab })
    render(<StockSearchBox onSelect={() => {}} />)
    type('sam'); await issued('sam')
    type('samsung'); await issued('samsung')

    ab.resolve(hit('samsung-electronics'))
    await flush()
    a.reject(new Error('late'))
    await flush()
    expect(screen.getByText('samsung-electronics')).toBeInTheDocument()
  })

  it('새 검색어 요청이 나가면 응답 전까지 옛 결과를 드롭다운에 남기지 않는다(보존)', async () => {
    const a = deferred(); const ab = deferred()
    mockQueries({ sam: a, samsung: ab })
    render(<StockSearchBox onSelect={() => {}} />)
    type('sam'); await issued('sam')
    a.resolve(hit('sampo'))
    expect(await screen.findByText('sampo')).toBeInTheDocument()

    type('samsung'); await issued('samsung')   // 새 검색어로 요청이 나가는 순간 옛 결과를 비운다
    expect(screen.queryByText('sampo')).not.toBeInTheDocument()
  })

  it('디바운스 창 안에 직전 검색어로 되돌아가면 그 결과가 다시 보인다', async () => {
    const a = deferred()
    mockQueries({ sam: a })
    render(<StockSearchBox onSelect={() => {}} />)
    type('sam'); await issued('sam')
    a.resolve(hit('sampo'))
    expect(await screen.findByText('sampo')).toBeInTheDocument()
    type('samx')   // 350ms 안에
    type('sam')    // 되돌림 — 디바운스 값이 안 바뀌어 재조회가 없다
    await new Promise((r) => setTimeout(r, 500))
    await flush()
    expect(screen.getByText('sampo')).toBeInTheDocument()
  })

  it('요청 중 입력을 비우면 로딩 표시가 남지 않는다', async () => {
    const a = deferred()
    mockQueries({ sam: a })
    render(<StockSearchBox onSelect={() => {}} />)
    type('sam'); await issued('sam')
    type('')
    await waitFor(() => expect(screen.getByText('🔍')).toBeInTheDocument(), { timeout: 1500 })
    a.resolve(hit('sampo'))
    await flush()
    expect(screen.queryByText('sampo')).not.toBeInTheDocument()
    expect(screen.getByText('🔍')).toBeInTheDocument()
  })
})

// task#379 S3 — ConsensusSummary 「데이터 갱신」 응답이 다른 종목에 병합되는 레이스(B49, S0 신규 N1).
//
// Reports는 ReportDetailTabs를 key={ticker}로 재마운트하지만, 그건 *자식 내부 state*만 지킨다.
// 갱신 POST가 in-flight인 채 종목을 바꾸면 옛 인스턴스의 응답이 부모 콜백
// (`setDetail(prev => ({...prev, summary: {...prev.summary, ...patched}}))`)을 불러
// **새 종목 화면에 옛 종목 목표가가 병합**된다. key 재마운트(언마운트)와 key 없는 prop 변경 둘 다 막는다.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'

vi.mock('../api', () => ({ default: { get: vi.fn(), post: vi.fn() } }))

import api from '../api'
import { ConsensusSummary } from '../components/reports/DetailTab'

function deferred() {
  let resolve, reject
  const promise = new Promise((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}
const flush = () => act(() => new Promise((r) => setTimeout(r, 0)))
// price null → 「데이터 갱신」 버튼이 보이는 요약
const SUMMARY = { price: null, buy: 0, hold: 0, sell: 0 }

beforeEach(() => { vi.resetAllMocks() })   // mockReturnValueOnce 큐가 다음 테스트로 새지 않게

describe('ConsensusSummary handleRefresh — 종목 가드', () => {
  it('갱신 중 종목이 바뀌어 재마운트되면(key) 옛 응답이 부모 콜백을 부르지 않는다', async () => {
    const post = deferred()
    api.post.mockReturnValue(post.promise)
    const onRefreshSuccess = vi.fn()
    const { rerender } = render(<ConsensusSummary key="AAA" summary={SUMMARY} ticker="AAA" onRefreshSuccess={onRefreshSuccess} />)
    fireEvent.click(screen.getByText('데이터 갱신'))
    rerender(<ConsensusSummary key="BBB" summary={SUMMARY} ticker="BBB" onRefreshSuccess={onRefreshSuccess} />)

    post.resolve({ data: { target_mean: 100 } })
    await flush()
    expect(onRefreshSuccess).not.toHaveBeenCalled()
  })

  it('key 없이 ticker prop만 바뀌어도 옛 응답이 부모 콜백을 부르지 않는다', async () => {
    const post = deferred()
    api.post.mockReturnValue(post.promise)
    const onRefreshSuccess = vi.fn()
    const { rerender } = render(<ConsensusSummary summary={SUMMARY} ticker="AAA" onRefreshSuccess={onRefreshSuccess} />)
    fireEvent.click(screen.getByText('데이터 갱신'))
    rerender(<ConsensusSummary summary={SUMMARY} ticker="BBB" onRefreshSuccess={onRefreshSuccess} />)

    post.resolve({ data: { target_mean: 100 } })
    await flush()
    expect(onRefreshSuccess).not.toHaveBeenCalled()
  })

  it('key 없이 ticker가 바뀐 뒤 옛 요청의 실패가 새 종목에 「갱신 실패」를 띄우지 않는다', async () => {
    const post = deferred()
    api.post.mockReturnValue(post.promise)
    const { rerender } = render(<ConsensusSummary summary={SUMMARY} ticker="AAA" onRefreshSuccess={() => {}} />)
    fireEvent.click(screen.getByText('데이터 갱신'))
    rerender(<ConsensusSummary summary={SUMMARY} ticker="BBB" onRefreshSuccess={() => {}} />)

    post.reject(new Error('late'))
    await flush()
    expect(screen.queryByText('갱신 실패')).not.toBeInTheDocument()
  })

  it('ticker가 바뀌면 옛 종목의 「갱신 중」 표시가 새 종목에 남지 않는다', async () => {
    api.post.mockReturnValue(new Promise(() => {}))
    const { rerender } = render(<ConsensusSummary summary={SUMMARY} ticker="AAA" onRefreshSuccess={() => {}} />)
    fireEvent.click(screen.getByText('데이터 갱신'))
    expect(screen.getByText('갱신 중...')).toBeInTheDocument()
    rerender(<ConsensusSummary summary={SUMMARY} ticker="BBB" onRefreshSuccess={() => {}} />)
    await flush()
    expect(screen.getByText('데이터 갱신')).toBeInTheDocument()
  })

  it('옛 종목 요청의 finally가 새 종목의 진행 중 갱신 표시를 끄지 않는다', async () => {
    const a = deferred(); const b = deferred()
    api.post.mockReturnValueOnce(a.promise).mockReturnValueOnce(b.promise)
    const { rerender } = render(<ConsensusSummary summary={SUMMARY} ticker="AAA" onRefreshSuccess={() => {}} />)
    fireEvent.click(screen.getByText('데이터 갱신'))
    rerender(<ConsensusSummary summary={SUMMARY} ticker="BBB" onRefreshSuccess={() => {}} />)
    await flush()
    fireEvent.click(screen.getByText('데이터 갱신'))   // B 갱신 in-flight

    a.resolve({ data: {} })
    await flush()
    expect(screen.getByText('갱신 중...')).toBeInTheDocument()
  })

  it('같은 종목이면 응답이 부모 콜백으로 전달된다(대조군)', async () => {
    api.post.mockResolvedValue({ data: { target_mean: 100 } })
    const onRefreshSuccess = vi.fn()
    render(<ConsensusSummary summary={SUMMARY} ticker="AAA" onRefreshSuccess={onRefreshSuccess} />)
    fireEvent.click(screen.getByText('데이터 갱신'))
    await flush()
    expect(onRefreshSuccess).toHaveBeenCalledWith({ target_mean: 100 })
  })
})

// 적대 검토 수복 (task#330 review) — 백엔드가 신설한 409를 프론트가 처리하지 않았다.
//
// `POST /api/report/generate{,/{ticker}}`는 진행 중 재요청을 409(`detail: "리포트 생성이 이미
// 진행 중입니다"`)로 거부한다. 그런데 `generateOne`/`generateBatch`는 POST **전에**
// `clearInterval(pollRef.current)`를 하고, POST가 reject되면 bare catch가
// `setGenerating(null)` + `showToast('리포트 생성 실패','error')`만 했다. 결과:
//   ⓐ 실제로는 첫 생성이 정상 진행 중인데 **「생성 실패」라는 거짓 진술**이 뜬다.
//   ⓑ 폴러가 이미 죽어 있어 진행률·완료 토스트·목록 갱신(`/api/report/list`)이 **영구히**
//      오지 않는다. 서버는 계속 생성해 스냅샷이 갱신되지만 화면은 실패로 남는다.
// 수정 전에는 두 번째 POST가 202를 받아 트래커를 리셋했으므로(그것이 B77 버그였지만)
// 폴링은 끊기지 않았다 — 즉 이건 그 변경이 만든 UX 회귀다.
//
// 트래커 키가 user_id 하나이므로 이중 클릭만의 문제가 아니다: admin의 흔한 흐름
// (전체 생성 → 개별 종목 재생성)에서 상시 발생한다.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'

const showToast = vi.fn()
vi.mock('../api', () => ({ default: { get: vi.fn(), post: vi.fn() } }))
vi.mock('../components/Toast', () => ({ useToast: () => ({ showToast }) }))

import api from '../api'
import useReportGeneration from '../hooks/useReportGeneration'

function conflict() {
  const err = new Error('Request failed with status code 409')
  err.response = { status: 409, data: { detail: '리포트 생성이 이미 진행 중입니다' } }
  return err
}

/** progress 폴링 응답을 순서대로 돌려주는 스텁. 마지막 값은 계속 반복된다. */
function progressSequence(states) {
  let i = 0
  return (url) => {
    if (url === '/api/report/progress') {
      const s = states[Math.min(i++, states.length - 1)]
      return Promise.resolve({ data: s })
    }
    if (url === '/api/report/list') return Promise.resolve({ data: [{ ticker: 'AAPL' }] })
    return Promise.resolve({ data: {} })
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.useFakeTimers()
})

describe('409(이미 진행 중)을 실패로 표시하지 않는다', () => {
  it('generateOne — 「생성 실패」 대신 서버 detail을 warning으로 알린다', async () => {
    api.post.mockRejectedValue(conflict())
    api.get.mockImplementation(progressSequence([{ running: true, done: 0, total: 1, failed: [] }]))
    const onApplyList = vi.fn()

    const { result } = renderHook(() => useReportGeneration({ onApplyList }))
    await act(async () => { await result.current.generateOne('MSFT') })

    const msgs = showToast.mock.calls.map(c => c[0])
    expect(msgs).not.toContain('리포트 생성 실패')
    expect(msgs.join(' ')).toContain('이미 진행 중')
    expect(showToast.mock.calls[0][1]).toBe('warning')

    result.current.cleanup()
  })

  it('generateBatch — 같은 규칙이 배치 경로에도 적용된다', async () => {
    api.post.mockRejectedValue(conflict())
    api.get.mockImplementation(progressSequence([{ running: true, done: 1, total: 5, failed: [] }]))

    const { result } = renderHook(() => useReportGeneration({ onApplyList: vi.fn() }))
    await act(async () => { await result.current.generateBatch(['AAPL', 'MSFT']) })

    const msgs = showToast.mock.calls.map(c => c[0])
    expect(msgs).not.toContain('리포트 생성 실패')
    expect(msgs.join(' ')).toContain('이미 진행 중')

    result.current.cleanup()
  })
})

describe('409 뒤에도 진행 중인 생성의 폴링이 이어진다', () => {
  it('진행률이 갱신되고 완료 시 토스트 + 목록 갱신이 온다', async () => {
    api.post.mockRejectedValue(conflict())
    api.get.mockImplementation(progressSequence([
      { running: true, done: 1, total: 3, failed: [] },
      { running: false, done: 3, total: 3, failed: [] },
    ]))
    const onApplyList = vi.fn()

    const { result } = renderHook(() => useReportGeneration({ onApplyList }))
    await act(async () => { await result.current.generateOne('MSFT') })

    // 1차 폴 — 진행 중인 생성의 진행률이 화면에 실린다(수정 전엔 폴러가 없어 0/0 고정).
    await act(async () => { await vi.advanceTimersByTimeAsync(1600) })
    expect(result.current.genProgress).toMatchObject({ done: 1, total: 3 })

    // 2차 폴 — 완료 감지 → 완료 토스트 + 목록 갱신
    await act(async () => { await vi.advanceTimersByTimeAsync(1600) })
    expect(onApplyList).toHaveBeenCalled()
    expect(showToast.mock.calls.map(c => c[0]).join(' ')).toMatch(/완료/)

    result.current.cleanup()
  })

  it('완료 문구는 409로 거부된 종목명을 주장하지 않는다', async () => {
    api.post.mockRejectedValue(conflict())
    api.get.mockImplementation(progressSequence([
      { running: false, done: 3, total: 3, failed: [] },
    ]))

    const { result } = renderHook(() => useReportGeneration({ onApplyList: vi.fn() }))
    await act(async () => { await result.current.generateOne('MSFT') })
    await act(async () => { await vi.advanceTimersByTimeAsync(1600) })

    const done = showToast.mock.calls.map(c => c[0]).filter(m => /완료/.test(m))
    expect(done.length).toBe(1)
    expect(done[0]).not.toContain('MSFT')   // MSFT는 생성되지 않았다

    result.current.cleanup()
  })
})

describe('대조군 — 409가 아닌 실패는 종전대로 「생성 실패」다', () => {
  it('500은 실패 토스트 + 폴링 없음', async () => {
    const err = new Error('boom')
    err.response = { status: 500, data: {} }
    api.post.mockRejectedValue(err)
    api.get.mockImplementation(progressSequence([{ running: false, done: 9, total: 9, failed: [] }]))
    const onApplyList = vi.fn()

    const { result } = renderHook(() => useReportGeneration({ onApplyList }))
    await act(async () => { await result.current.generateOne('MSFT') })

    expect(showToast).toHaveBeenCalledWith('리포트 생성 실패', 'error')
    expect(result.current.generating).toBe(null)

    await act(async () => { await vi.advanceTimersByTimeAsync(5000) })
    expect(onApplyList).not.toHaveBeenCalled()   // 폴러가 서지 않았다
  })

  it('202 성공 경로는 종전대로 폴링·완료 토스트가 종목명을 싣는다', async () => {
    api.post.mockResolvedValue({ data: {} })
    api.get.mockImplementation(progressSequence([
      { running: false, done: 1, total: 1, failed: [] },
    ]))
    const onApplyList = vi.fn()

    const { result } = renderHook(() => useReportGeneration({ onApplyList }))
    await act(async () => { await result.current.generateOne('MSFT') })
    expect(result.current.generating).toBe('MSFT')

    await act(async () => { await vi.advanceTimersByTimeAsync(1600) })
    expect(onApplyList).toHaveBeenCalled()
    expect(showToast).toHaveBeenCalledWith('MSFT 리포트 생성 완료')
  })
})

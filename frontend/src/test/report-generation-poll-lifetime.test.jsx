// 폴링 수명 — 소비처 배선을 태우고 재는 축 (task#343 S1)
//
// **왜 훅만 렌더하면 안 되는가.** 형제 `report-generation-conflict.test.jsx`는
// `renderHook(() => useReportGeneration(...))`로 훅만 렌더하므로 `Reports.jsx`가 실제로 하는
// 배선을 태우지 않는다. 그 배선이 이것이다:
//
//     useEffect(() => cleanup, [cleanup])        // pages/Reports.jsx
//
// `cleanup`은 `useCallback` 없이 **매 렌더 새로 만들어지는** 함수이므로 deps가 매 렌더 바뀌고,
// React는 다음 이펙트를 걸기 전에 직전 destructor(`clearInterval`)를 실행한다. 폴링 틱마다
// `setGenProgress`가 리렌더를 일으키므로 **첫 틱 직후 인터벌이 걷힌다** — 이것이 S1의 가설이다.
//
// ⚠️ **이 파일은 가설을 확증하도록 설계하지 않았다.** 축은 「폴링이 3틱 이상 지속된다」라는
// *구현과 독립인* 성질로 쓴다. 가설이 참이면 이 축은 수정 전 red이고, 거짓이면 green이며
// **어느 쪽이든 그 사실이 산출이다**(task#313~316 — 예고한 관측이 성립하지 않는 것 자체가 결과다).
//
// 이 축이 지키는 것: 서버가 계속 `running: true`를 주는 정상 대량 생성에서 폴링이 살아 있어야
// 진행률·완료 토스트·목록 갱신이 온다. 첫 틱에 폴러가 죽으면 화면은 첫 진행률에서 멈춘 채
// 「생성 중」으로 고착된다.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, act } from '@testing-library/react'
import { useEffect } from 'react'

const showToast = vi.fn()
vi.mock('../api', () => ({ default: { get: vi.fn(), post: vi.fn() } }))
vi.mock('../components/Toast', () => ({ useToast: () => ({ showToast }) }))

import api from '../api'
import useReportGeneration from '../hooks/useReportGeneration'

/** `pages/Reports.jsx`와 **같은 배선**으로 훅을 감싼 소비처. 이 래퍼가 이 파일의 존재 이유다. */
function Consumer({ onApplyList }) {
  const { genProgress, generateBatch, cleanup } = useReportGeneration({ onApplyList })
  useEffect(() => cleanup, [cleanup]) // ← pages/Reports.jsx 의 배선을 그대로 재현
  return (
    <div>
      <span data-testid="progress">{genProgress.done}/{genProgress.total}</span>
      <button onClick={() => generateBatch(['AAPL', 'MSFT'])}>gen</button>
    </div>
  )
}

/** `/api/report/progress` 호출 횟수를 세는 스텁. 항상 같은 진행 중 상태를 돌려준다. */
function countingProgress(state) {
  const calls = { progress: 0 }
  api.get.mockImplementation((url) => {
    if (url === '/api/report/progress') {
      calls.progress += 1
      return Promise.resolve({ data: state })
    }
    if (url === '/api/report/list') return Promise.resolve({ data: [] })
    return Promise.resolve({ data: {} })
  })
  return calls
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.useFakeTimers()
})
afterEach(() => {
  vi.useRealTimers()
})

describe('소비처 배선에서 폴링이 살아 있는다', () => {
  it('서버가 계속 running:true를 주면 폴링이 3틱 이상 지속된다', async () => {
    api.post.mockResolvedValue({ data: {} })
    const calls = countingProgress({ running: true, done: 1, total: 20, failed: [] })

    const { getByText } = render(<Consumer onApplyList={vi.fn()} />)
    await act(async () => { getByText('gen').click() })

    // 5틱을 굴린다. 폴러가 살아 있으면 progress 호출이 그만큼 쌓인다.
    for (let i = 0; i < 5; i++) {
      await act(async () => { await vi.advanceTimersByTimeAsync(1600) })
    }

    // 축: 구현이 아니라 **성질**을 잰다 — 정상 생성 중에는 폴링이 계속돼야 한다.
    expect(calls.progress).toBeGreaterThanOrEqual(3)
  })
})

// ── 유계화 (task#343 S3) ──────────────────────────────────────────────────────
//
// 위 축이 폴러를 **살려 놓자마자** 두 무한 경로가 드러난다. 종전에는 첫 틱 뒤 폴러가 죽어서
// 둘 다 우연히 덮여 있었다 — 덮개를 걷었으니 유계화가 선택이 아니라 필수다(task#283).
//
//   ⓐ 실패 경로  — progress가 계속 실패하면 bare `catch {}`라 setState가 없고, setState가 없으면
//                  리렌더도 없어 인터벌이 **영원히** 산다.
//   ⓑ 죽은 트래커 — `services/progress.py::peek`은 트래커가 없으면 초기상태(`running:false, total:0`)를
//                  준다. 완료조건 `!running && total > 0 && done >= total`은 `total === 0`에서
//                  **영영 불성립**이라 성공 응답인데도 무한 폴링이다(서버 재시작 시 도달).
describe('폴링은 유계다 — 그러나 정상 생성은 끊지 않는다', () => {
  /** 폴러를 띄우고 N틱 굴린 뒤, 「멈췄는가」를 *추가 호출이 없다*로 판정한다. */
  async function runTicks(ticks) {
    const { getByText } = render(<Consumer onApplyList={vi.fn()} />)
    await act(async () => { getByText('gen').click() })
    for (let i = 0; i < ticks; i++) {
      await act(async () => { await vi.advanceTimersByTimeAsync(1600) })
    }
  }

  it('ⓐ progress가 계속 실패하면 5틱 안에 폴링을 접고 생성 상태를 되돌린다', async () => {
    api.post.mockResolvedValue({ data: {} })
    let calls = 0
    api.get.mockImplementation((url) => {
      if (url === '/api/report/progress') { calls += 1; return Promise.reject(new Error('500')) }
      return Promise.resolve({ data: {} })
    })
    vi.spyOn(console, 'warn').mockImplementation(() => {})

    await runTicks(8)
    const atStop = calls
    // 접힌 뒤로는 더 이상 부르지 않는다 — 「몇 번 불렀나」가 아니라 「멈췄나」를 잰다.
    await act(async () => { await vi.advanceTimersByTimeAsync(1600 * 5) })

    expect(calls).toBe(atStop)
    expect(calls).toBeLessThanOrEqual(5)
    expect(showToast.mock.calls.some(c => /불러오지 못했습니다/.test(c[0]) && c[1] === 'error')).toBe(true)
  })

  it('ⓑ running:false·total:0(죽은 트래커)이 반복되면 5틱 안에 접는다', async () => {
    api.post.mockResolvedValue({ data: {} })
    const calls = countingProgress({ running: false, done: 0, total: 0, failed: [] })

    await runTicks(8)
    const atStop = calls.progress
    await act(async () => { await vi.advanceTimersByTimeAsync(1600 * 5) })

    expect(calls.progress).toBe(atStop)
    expect(calls.progress).toBeLessThanOrEqual(5)
    expect(showToast.mock.calls.some(c => /확인할 수 없어/.test(c[0]))).toBe(true)
  })

  it('ⓒ 대조군 — running:true가 20틱 계속돼도 **절대** 끊지 않는다', async () => {
    api.post.mockResolvedValue({ data: {} })
    const calls = countingProgress({ running: true, done: 3, total: 500, failed: [] })

    await runTicks(20)

    // 느린 대량 생성을 벽시계 상한으로 오판해 끊으면 진행률·완료 토스트·목록 갱신이 통째로 사라진다.
    // 이 축이 없으면 「무조건 5틱에 중단」이라는 과잉교정이 통과한다.
    expect(calls.progress).toBeGreaterThanOrEqual(20)
    expect(showToast).not.toHaveBeenCalled()
  })

  it('ⓓ 정상 완료는 그대로 — 완료 응답에서 폴링을 접고 목록을 갱신한다', async () => {
    api.post.mockResolvedValue({ data: {} })
    const onApplyList = vi.fn()
    let i = 0
    const seq = [
      { running: true, done: 1, total: 2, failed: [] },
      { running: false, done: 2, total: 2, failed: [] },
    ]
    let calls = 0
    api.get.mockImplementation((url) => {
      if (url === '/api/report/progress') { calls += 1; return Promise.resolve({ data: seq[Math.min(i++, seq.length - 1)] }) }
      if (url === '/api/report/list') return Promise.resolve({ data: [] })
      return Promise.resolve({ data: {} })
    })

    const { getByText } = render(<Consumer onApplyList={onApplyList} />)
    await act(async () => { getByText('gen').click() })
    for (let t = 0; t < 3; t++) await act(async () => { await vi.advanceTimersByTimeAsync(1600) })
    const atStop = calls
    await act(async () => { await vi.advanceTimersByTimeAsync(1600 * 4) })

    expect(calls).toBe(atStop)          // 완료 후 폴링이 멈춘다
    expect(onApplyList).toHaveBeenCalled()
  })
})

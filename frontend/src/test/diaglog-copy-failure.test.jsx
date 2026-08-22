// B56 — DiagLog 복사 실패가 '복사됨'으로 보고되던 것을 막는 가드.
//
// `document.execCommand('copy')`는 실패를 **예외로 던지지 않고 `false`를 반환**한다. 반환값을
// 확인하지 않으면 폴백이 아무것도 복사하지 못한 상태로 resolve하고, 화면은 「복사됨」이라는
// 거짓 진술을 한다. 이 컴포넌트의 산출물이 「폰에서 채취한 로그」이므로 그 거짓 진술은
// 사용자가 빈 클립보드를 붙여넣게 만든다(wrong < missing의 어포던스판).
//
// 형제 파일 `diag-log.test.jsx`는 성공 경로(writeText 호출·거절 시 폴백 진입)만 단언한다 —
// 폴백이 **실패했을 때** 무엇이 보이는지는 그 파일의 정의역에 없다.
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

import DiagLog from '../components/DiagLog'
import { logDiag, clearDiag } from '../utils/diag'

const setClipboard = (value) =>
  Object.defineProperty(navigator, 'clipboard', { value, configurable: true })

beforeEach(() => {
  localStorage.clear()
  clearDiag()
  logDiag('ev1', { a: 1 })
  setClipboard(undefined) // jsdom 기본값이지만 파일 내 앞선 정의가 남지 않도록 명시한다
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})
afterEach(() => {
  vi.restoreAllMocks()
  delete document.execCommand
  localStorage.clear()
})

describe('폴백 복사 실패 (B56)', () => {
  it('execCommand가 false를 반환하면 「복사됨」이 아니라 실패로 보고된다', async () => {
    document.execCommand = vi.fn(() => false)

    render(<DiagLog />)
    fireEvent.click(screen.getByText('로그 복사'))

    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument())
    expect(screen.getByText('복사 실패')).toBeInTheDocument()
    expect(screen.queryByText('복사됨')).not.toBeInTheDocument()
  })

  it('clipboard 거절 + execCommand 실패(이중 실패)가 빈 catch에 삼켜지지 않는다', async () => {
    setClipboard({ writeText: vi.fn().mockRejectedValue(new Error('denied')) })
    document.execCommand = vi.fn(() => false)

    render(<DiagLog />)
    fireEvent.click(screen.getByText('로그 복사'))

    await waitFor(() => expect(screen.getByText('복사 실패')).toBeInTheDocument())
    expect(document.execCommand).toHaveBeenCalledWith('copy')
    expect(screen.queryByText('복사됨')).not.toBeInTheDocument()
  })

  it('실패를 사용자에게 보이는 것과 별개로 진단 로그를 남긴다', async () => {
    document.execCommand = vi.fn(() => false)

    render(<DiagLog />)
    fireEvent.click(screen.getByText('로그 복사'))

    await waitFor(() => expect(console.warn).toHaveBeenCalled())
    expect(console.warn.mock.calls[0][0]).toContain('[DiagLog]')
  })

  it('실패해도 임시 textarea를 DOM에 남기지 않는다', async () => {
    document.execCommand = vi.fn(() => false)

    render(<DiagLog />)
    fireEvent.click(screen.getByText('로그 복사'))

    await waitFor(() => expect(screen.getByText('복사 실패')).toBeInTheDocument())
    expect(document.querySelectorAll('textarea')).toHaveLength(0)
  })
})

// 대조군 — 성공 경로가 이전과 같이 「복사됨」을 보고해야 한다. 이 두 축이 없으면
// 「무조건 실패로 보고」하는 구현도 위 4축을 통과한다.
describe('대조군 — 성공 경로 보존', () => {
  it('execCommand가 true를 반환하면 「복사됨」', async () => {
    document.execCommand = vi.fn(() => true)

    render(<DiagLog />)
    fireEvent.click(screen.getByText('로그 복사'))

    await waitFor(() => expect(screen.getByText('복사됨')).toBeInTheDocument())
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('clipboard API가 성공하면 폴백을 타지 않고 「복사됨」', async () => {
    const writeText = vi.fn().mockResolvedValue()
    setClipboard({ writeText })
    document.execCommand = vi.fn(() => false)

    render(<DiagLog />)
    fireEvent.click(screen.getByText('로그 복사'))

    await waitFor(() => expect(screen.getByText('복사됨')).toBeInTheDocument())
    expect(document.execCommand).not.toHaveBeenCalled()
    expect(JSON.parse(writeText.mock.calls[0][0])[0].ev).toBe('ev1')
  })
})

// ── 실패 상태의 **수명** — 「지우기」가 리셋해야 한다 ─────────────────────────
// 실패 안내는 「아래 로그를 직접 선택해 복사하세요」인데 「지우기」는 그 로그를 지운다.
// `handleClear`가 status를 리셋하지 않으면 버튼 라벨 「복사 실패」와 role=alert 안내가
// **가리킬 대상이 없는 채로** 남아 화면이 거짓 지시를 한다(3상태 도입 시의 자연스러운 누락).
describe('실패 상태는 「지우기」에서 리셋된다', () => {
  it('실패 → 지우기 순서로 조작하면 라벨·안내가 사라진다', async () => {
    setClipboard(undefined)
    document.execCommand = vi.fn(() => false)

    render(<DiagLog />)
    fireEvent.click(screen.getByText('로그 복사'))
    await waitFor(() => expect(screen.getByText('복사 실패')).toBeInTheDocument())
    expect(screen.getByRole('alert')).toBeInTheDocument()

    fireEvent.click(screen.getByText('지우기'))
    expect(screen.getByText('로그 복사')).toBeInTheDocument()      // 라벨 복귀
    expect(screen.queryByText('복사 실패')).not.toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()    // 가리킬 로그가 없는 안내 제거
  })
})

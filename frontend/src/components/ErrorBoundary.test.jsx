// B48 — 렌더 트리 어디든 예외 1건이 앱 전체를 백지로 만드는 것을 막는 경계.
// 확인 대상: ⓐ 폴백 존재 ⓑ 감싸지 않은 형제 트리는 살아 있다 ⓒ console.error 1회
// ⓓ 「다시 시도」가 에러 상태를 지우고 자식이 다시 렌더된다.
import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

import ErrorBoundary from './ErrorBoundary'
import { readDiag, clearDiag } from '../utils/diag'

// props로만 분기한다(부수효과로 분기하면 안 된다) — React는 DEV 모드에서 렌더 throw를
// 한 번 더 동기 재시도해 스택을 재구성하는데(Boom이 부수효과로 "1회만 throw"를 흉내내면
// 그 2차 재시도에서 안 던져 경계가 아예 안 걸린다, 실측). shouldThrow는 rerender로만 갈아
// 끼워 매 호출이 결정적이게 한다.
function Boom({ shouldThrow }) {
  if (shouldThrow) throw new Error('boom')
  return <div data-testid="recovered">recovered</div>
}

beforeEach(() => {
  localStorage.clear()
  clearDiag()
})
afterEach(() => {
  vi.restoreAllMocks()
  localStorage.clear()
})

describe('ErrorBoundary (B48)', () => {
  it('폴백을 렌더하고, 경계 밖 형제 트리는 살아 있다', () => {
    // React 자체도 캐치된 에러를 console.error로 내보낸다(우리 마커와 무관) — 전역 침묵 대신
    // 스파이로 잡아서 우리 마커([ErrorBoundary])가 붙은 호출만 세어 ⓒ를 검증한다.
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})

    render(
      <div>
        <ErrorBoundary><Boom shouldThrow /></ErrorBoundary>
        <span data-testid="sibling">safe</span>
      </div>,
    )

    expect(screen.getByRole('alert')).toBeInTheDocument()
    expect(screen.getByText('다시 시도')).toBeInTheDocument()
    // 형제는 같은 경계 밖이므로 언마운트되지 않는다.
    expect(screen.getByTestId('sibling')).toHaveTextContent('safe')

    const own = spy.mock.calls.filter(
      (args) => typeof args[0] === 'string' && args[0].includes('[ErrorBoundary]'),
    )
    expect(own).toHaveLength(1)
  })

  it('logDiag에 render-error 1건을 스택 없이 남긴다', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})

    render(<ErrorBoundary><Boom shouldThrow /></ErrorBoundary>)

    const entries = readDiag().filter((e) => e.ev === 'render-error')
    expect(entries).toHaveLength(1)
    expect(entries[0].msg).toBe('boom')
    // 스택은 싣지 않는다 — 링버퍼 50건 상한을 한 항목이 잡아먹지 않게(diag.js).
    expect(entries[0]).not.toHaveProperty('stack')
  })

  it('「다시 시도」를 누르면 에러 상태가 지워지고 자식이 다시 렌더된다', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})

    const { rerender } = render(<ErrorBoundary><Boom shouldThrow /></ErrorBoundary>)
    expect(screen.getByRole('alert')).toBeInTheDocument()

    // 경계는 error 상태인 동안 폴백만 그리므로, 여기서 건 새 children(shouldThrow=false)은
    // 클릭 전까지 화면에 안 보이지만 this.props.children으로는 이미 갈려 있다.
    rerender(<ErrorBoundary><Boom shouldThrow={false} /></ErrorBoundary>)
    fireEvent.click(screen.getByText('다시 시도'))

    expect(screen.getByTestId('recovered')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
})

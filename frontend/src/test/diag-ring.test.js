// task#284 S1 — diag 유틸의 링버퍼(50) 계약.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { logDiag, readDiag, clearDiag } from '../utils/diag'

beforeEach(() => localStorage.clear())
afterEach(() => {
  localStorage.clear()
  vi.restoreAllMocks()
})

describe('diag — 링버퍼 50', () => {
  it('50개 초과분은 오래된 것부터 버려진다', () => {
    for (let i = 0; i < 55; i++) logDiag('x', { i })
    const list = readDiag()
    expect(list.length).toBe(50)
    expect(list[0].i).toBe(5) // 0~4 버려짐
    expect(list[49].i).toBe(54)
  })

  it('항목에 ev·t·rel이 자동으로 실린다', () => {
    logDiag('doc', { url: '/' })
    const [entry] = readDiag()
    expect(entry.ev).toBe('doc')
    expect(entry.url).toBe('/')
    expect(typeof entry.t).toBe('number')
    expect(typeof entry.rel).toBe('number')
  })

  it('clearDiag 후에는 빈 배열', () => {
    logDiag('x', {})
    clearDiag()
    expect(readDiag()).toEqual([])
  })

  it('저장값이 깨져 있어도 readDiag는 예외를 던지지 않고 빈 배열', () => {
    localStorage.setItem('diag_log', 'not-json')
    expect(readDiag()).toEqual([])
  })

  it('localStorage.setItem이 던져도 logDiag는 예외를 삼킨다', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError')
    })
    expect(() => logDiag('x', {})).not.toThrow()
  })
})

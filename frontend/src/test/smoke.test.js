import { describe, it, expect } from 'vitest'

// Vitest 러너 동작 확인용 스모크 테스트 (ADR-0019 하니스 도입)
describe('vitest harness', () => {
  it('runs', () => {
    expect(1 + 1).toBe(2)
  })
})

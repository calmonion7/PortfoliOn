import { describe, it, expect } from 'vitest'
import { splitManagerName } from './guruName'

describe('splitManagerName (task#236 S1)', () => {
  it('"운용역 - 펀드" 형태를 쪼갠다', () => {
    expect(splitManagerName('Alex Roepers - Atlantic Investment Management'))
      .toEqual({ person: 'Alex Roepers', fund: 'Atlantic Investment Management' })
  })

  it('구분자가 없으면 펀드명만 (26명형 — 부제 줄이 사라진다)', () => {
    expect(splitManagerName('AKO Capital')).toEqual({ person: null, fund: 'AKO Capital' })
  })

  it('" - "가 여러 번이면 첫 구분자로만 쪼갠다', () => {
    expect(splitManagerName('Bill Nygren - Oakmark - Harris Associates'))
      .toEqual({ person: 'Bill Nygren', fund: 'Oakmark - Harris Associates' })
  })

  it('앞뒤 공백을 정리한다', () => {
    expect(splitManagerName('  Warren Buffett  -  Berkshire Hathaway  '))
      .toEqual({ person: 'Warren Buffett', fund: 'Berkshire Hathaway' })
  })

  it('빈/undefined 입력에 throw 하지 않는다', () => {
    expect(splitManagerName(undefined)).toEqual({ person: null, fund: '' })
    expect(splitManagerName(null)).toEqual({ person: null, fund: '' })
    expect(splitManagerName('')).toEqual({ person: null, fund: '' })
  })

  it('한쪽이 비는 반쪽 구분자는 전체를 펀드명으로 (빈 부제 방지)', () => {
    expect(splitManagerName('Warren Buffett - ')).toEqual({ person: null, fund: 'Warren Buffett -' })
    expect(splitManagerName(' - Berkshire')).toEqual({ person: null, fund: '- Berkshire' })
  })
})

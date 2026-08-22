import { describe, it, expect } from 'vitest'
import { fmtPrice, fmtUsdCompact, fmtEokWon, fmtSharesKr, fmtSharesUs } from './utils'

// 표시 포매터 정본 5종의 계약 핀 (task#271).
// 이 파일이 정본의 유일한 자동 게이트다 — 소비처 7개 차트 컴포넌트는 recharts라
// jsdom에서 SVG가 아예 안 그려져(§9.3) tickFormatter 출력을 단언할 수 없다.

describe('fmtPrice — 절대 가격', () => {
  it('US는 천단위 쉼표 + 소수 2자리', () => {
    expect(fmtPrice(1234.56, 'US')).toBe('$1,234.56')   // Ranking 로컬본은 toFixed(2)라 쉼표가 없었다
    expect(fmtPrice(9.5, 'US')).toBe('$9.50')
  })
  it('KR은 ₩ 정수', () => {
    expect(fmtPrice(354000, 'KR')).toBe('₩354,000')
  })
  it('빈값·비유한값은 —', () => {
    expect(fmtPrice(null, 'US')).toBe('—')
    expect(fmtPrice(NaN, 'KR')).toBe('—')
  })
})

describe('fmtUsdCompact — 입력 단위: USD 원단위', () => {
  it('1e12 이상은 T (B14 — 총 투자금이 $1,077.0B로 뭉개지던 것)', () => {
    expect(fmtUsdCompact(1.077e12)).toBe('$1.1T')
  })
  it('B 티어 계약 보존', () => {
    expect(fmtUsdCompact(60e9)).toBe('$60.0B')
    expect(fmtUsdCompact(999.9e9)).toBe('$999.9B')
  })
  it('M·K 티어', () => {
    expect(fmtUsdCompact(5.4e6)).toBe('$5.4M')
    expect(fmtUsdCompact(12_345)).toBe('$12K')
  })
  it('1e3 미만은 전액 — $0K 금지', () => {
    expect(fmtUsdCompact(3)).toBe('$3')
    expect(fmtUsdCompact(999)).toBe('$999')
  })
  it('빈값·0·음수는 —', () => {
    expect(fmtUsdCompact(null)).toBe('—')
    expect(fmtUsdCompact(0)).toBe('—')
  })
})

describe('fmtEokWon — 입력 단위: 억원', () => {
  it('10000억 = 1조 티어 경계', () => {
    expect(fmtEokWon(10_000)).toBe('1.0조')
    expect(fmtEokWon(9_999)).toBe('9,999억')
  })
  it('억 단위', () => {
    expect(fmtEokWon(1_234)).toBe('1,234억')
  })
  it('빈값은 —', () => {
    expect(fmtEokWon(null)).toBe('—')
  })
})

describe('fmtSharesKr — 입력 단위: 주(株), 부호 보존', () => {
  it('순매도 누적(음수)의 부호와 단위를 함께 보존 (B13)', () => {
    // krFmt(5_414_000) 이 '541.4조'를 내던 자리 — 주식수는 만/억으로 읽혀야 한다.
    expect(fmtSharesKr(-5_414_000)).toBe('-541만')
    expect(fmtSharesKr(5_414_000)).toBe('541만')
  })
  it('억 티어', () => {
    expect(fmtSharesKr(1.5e8)).toBe('1.5억')
    expect(fmtSharesKr(-1.5e8)).toBe('-1.5억')
  })
  it('1만 미만은 전액', () => {
    expect(fmtSharesKr(-1234)).toBe('-1234')
  })
  it('빈값은 —', () => {
    expect(fmtSharesKr(null)).toBe('—')
  })
})

describe('fmtSharesUs — 입력 단위: 주(株), 해외', () => {
  it('B·M·K 티어', () => {
    expect(fmtSharesUs(1.5e9)).toBe('1.50B')
    expect(fmtSharesUs(2.5e6)).toBe('2.50M')
    expect(fmtSharesUs(1500)).toBe('1.5K')
  })
  it('빈값은 —', () => {
    expect(fmtSharesUs(null)).toBe('—')
  })
  // B34 — 임계 비교가 원값이면 음수가 전 티어를 통과해 전액이 찍혔다.
  // 내부자 순매수(net_shares)는 순매도일 때 음수라 라이브에서 실제로 밟힌다.
  it('음수도 축약되고 부호가 보존된다 (형제 fmtSharesKr와 같은 형태)', () => {
    expect(fmtSharesUs(-1.5e9)).toBe('-1.50B')
    expect(fmtSharesUs(-2.5e6)).toBe('-2.50M')
    expect(fmtSharesUs(-1500)).toBe('-1.5K')
  })
  it('음수가 전액으로 새지 않는다 — 쉼표 표기는 1e3 미만에서만', () => {
    expect(fmtSharesUs(-1.5e9)).not.toContain(',')
    expect(fmtSharesUs(-999)).toBe('-999')
  })
  it('대조군 — 양수·0의 표기는 바뀌지 않는다', () => {
    expect(fmtSharesUs(1.5e9)).toBe('1.50B')
    expect(fmtSharesUs(999)).toBe('999')
    expect(fmtSharesUs(0)).toBe('0')
  })
  it('대조군 — 포매터는 음수 부호만 넣는다(소비처가 +를 붙이므로 이중 부호 금지)', () => {
    expect(fmtSharesUs(1.5e9).startsWith('+')).toBe(false)
    expect(fmtSharesUs(0).startsWith('+')).toBe(false)
  })
})

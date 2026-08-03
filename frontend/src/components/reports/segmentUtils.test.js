import { describe, it, expect } from 'vitest'
import { deriveSegments } from './segmentUtils.js'

// task#275 — market_outlook.segments[]를 렌더용 파생값으로 바꾸는 순수 함수 red-first 테스트.
// 계약: AI는 %만 기입, 금액(매출·시장기회)은 이 모듈이 환산한다.

const FIN = [
  { period: '2023', revenue: 900, is_consensus: false },
  { period: '2024', revenue: 1000, is_consensus: false },
]

describe('deriveSegments — task#275 사업부문 시장 분석 파생', () => {
  it('segments 없음/빈 배열이면 null(섹션 통째 생략)', () => {
    expect(deriveSegments({}, FIN)).toBeNull()
    expect(deriveSegments({ segments: [] }, FIN)).toBeNull()
    expect(deriveSegments(null, FIN)).toBeNull()
  })

  it('① period 불일치 → 그 부문의 매출 금액(revenueCurrent/revenuePrev/revenueChangePct)만 null, 나머지는 남음', () => {
    const mo = {
      segments: [{
        name: '메모리', period: '2025', revenue_share_pct: 58.3,
        market: { size: 1200, unit: '억달러', year: 2024, size_forecast: 1900, forecast_year: 2030, cagr_pct: 8.0 },
        share_pct: 12.0,
      }],
    }
    const { rows } = deriveSegments(mo, FIN)
    const row = rows[0]
    expect(row.revenueCurrent).toBeNull()
    expect(row.revenuePrev).toBeNull()
    expect(row.revenueChangePct).toBeNull()
    expect(row.name).toBe('메모리')
    expect(row.sharePct).toBe(58.3)
    expect(row.market).toEqual({ size: 1200, unit: '억달러', year: 2024, sizeForecast: 1900, forecastYear: 2030, cagrPct: 8.0 })
    expect(row.opportunityCurrent).toBeCloseTo(1200 * 12.0 / 100)
  })

  it('② Σ비중 105(허용치 초과) → 전 부문 매출 금액 null, gate.shareSumExceeded=true, 비중·시장기회는 유지', () => {
    const mo = {
      segments: [
        { name: 'A', period: '2024', revenue_share_pct: 60, market: { size: 1000 }, share_pct: 10 },
        { name: 'B', period: '2024', revenue_share_pct: 45, market: { size: 500 }, share_pct: 20 },
      ],
    }
    const { rows, gate } = deriveSegments(mo, FIN)
    expect(gate.shareSumExceeded).toBe(true)
    expect(gate.shareSum).toBeCloseTo(105)
    rows.forEach((r) => {
      expect(r.revenueCurrent).toBeNull()
      expect(r.revenuePrev).toBeNull()
      expect(r.revenueChangePct).toBeNull()
    })
    expect(rows[0].sharePct).toBe(60)
    expect(rows[0].opportunityCurrent).toBeCloseTo(1000 * 10 / 100)
  })

  it('③ Σ비중 85(허용치 이내, 기타 생략 정상) → 정상 환산, gate.shareSumExceeded=false', () => {
    const mo = {
      segments: [
        { name: 'A', period: '2024', revenue_share_pct: 60 },
        { name: 'B', period: '2024', revenue_share_pct: 25 },
      ],
    }
    const { rows, gate } = deriveSegments(mo, FIN)
    expect(gate.shareSumExceeded).toBe(false)
    expect(rows[0].revenueCurrent).toBeCloseTo(1000 * 60 / 100)
    expect(rows[1].revenueCurrent).toBeCloseTo(1000 * 25 / 100)
  })

  it('④ 전기 비중 결측 → revenueChangePct·shareDeltaPp만 null, 당기 값(revenueCurrent 등)은 정상', () => {
    const mo = {
      segments: [{ name: 'A', period: '2024', prev_period: '2023', revenue_share_pct: 50 }],
    }
    const { rows } = deriveSegments(mo, FIN)
    const row = rows[0]
    expect(row.revenueCurrent).toBeCloseTo(500)
    expect(row.revenuePrev).toBeNull()
    expect(row.revenueChangePct).toBeNull()
    expect(row.shareDeltaPp).toBeNull()
  })

  it('⑤ share_pct_forecast 유무로 scenarioLabel·opportunityForecast가 갈림', () => {
    const mo = {
      segments: [
        { name: 'A', period: '2024', revenue_share_pct: 50, market: { size: 1000, size_forecast: 2000 }, share_pct: 10 },
        { name: 'B', period: '2024', revenue_share_pct: 50, market: { size: 1000, size_forecast: 2000 }, share_pct: 10, share_pct_forecast: 15 },
      ],
    }
    const { rows } = deriveSegments(mo, FIN)
    expect(rows[0].scenarioLabel).toBe('점유율 유지 가정')
    expect(rows[0].opportunityForecast).toBeCloseTo(2000 * 10 / 100)
    expect(rows[1].scenarioLabel).toBe('회사 전망')
    expect(rows[1].opportunityForecast).toBeCloseTo(2000 * 15 / 100)
  })

  it('⑥ NaN/Infinity 입력은 해당 필드만 null로 만들고 다른 필드·부문을 오염시키지 않는다', () => {
    const mo = {
      segments: [
        {
          name: '메모리', period: '2024', revenue_share_pct: NaN,
          market: { size: Infinity, unit: '억달러', year: 2024, size_forecast: 1900, forecast_year: 2030, cagr_pct: 8.0 },
          share_pct: 12.0,
        },
        {
          name: '파운드리', period: '2024', revenue_share_pct: 20,
          market: { size: 500, unit: '억달러', year: 2024 },
          share_pct: NaN,
        },
      ],
    }
    const { rows } = deriveSegments(mo, FIN)
    const [memory, foundry] = rows

    expect(memory.sharePct).toBeNull()
    expect(memory.revenueCurrent).toBeNull()
    expect(memory.market.size).toBeNull()
    expect(memory.market.unit).toBe('억달러')
    expect(memory.market.year).toBe(2024)
    expect(memory.opportunityCurrent).toBeNull()

    expect(foundry.name).toBe('파운드리')
    expect(foundry.sharePct).toBe(20)
    expect(foundry.revenueCurrent).toBeCloseTo(1000 * 20 / 100)
    expect(foundry.market.size).toBe(500)
    expect(foundry.sharePctOfMarket).toBeNull()
    expect(foundry.opportunityCurrent).toBeNull()
  })
})

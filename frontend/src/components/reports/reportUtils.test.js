import { describe, it, expect } from 'vitest'
import { computePeerPremiums } from './reportUtils.jsx'

describe('computePeerPremiums', () => {
  it('median 홀수 peer 기준 할인/할증 방향 판정', () => {
    // self PER 8, peers [10, 12, 14] → median 12 → pct = (8/12-1)*100 = -33% 할인
    const competitors = [
      { is_self: true, per: 8 },
      { per: 10 },
      { per: 12 },
      { per: 14 },
    ]
    const result = computePeerPremiums(competitors)
    const per = result.find((r) => r.metric === 'PER')
    expect(per).toEqual({ metric: 'PER', pct: -33, discount: true })
  })

  it('median 짝수 peer는 가운데 두 값 평균 + 할증 방향', () => {
    // self PBR 15, peers [10, 20] → median 15 → pct 0 → 할증(discount:false)
    const competitors = [
      { is_self: true, pbr: 15 },
      { pbr: 10 },
      { pbr: 20 },
    ]
    const result = computePeerPremiums(competitors)
    const pbr = result.find((r) => r.metric === 'PBR')
    expect(pbr).toEqual({ metric: 'PBR', pct: 0, discount: false })
  })

  it('peer가 1개뿐이면(n<2) 그 지표는 숨김', () => {
    const competitors = [
      { is_self: true, per: 8 },
      { per: 10 },
    ]
    expect(computePeerPremiums(competitors)).toEqual([])
  })

  it('self 값이 결측이면 그 지표는 숨김', () => {
    const competitors = [
      { is_self: true, per: null },
      { per: 10 },
      { per: 12 },
    ]
    expect(computePeerPremiums(competitors)).toEqual([])
  })

  it('필드 자체가 없는 옛 스냅샷은 graceful하게 빈 배열', () => {
    const competitors = [
      { is_self: true, name: 'A' },
      { name: 'B' },
      { name: 'C' },
    ]
    expect(computePeerPremiums(competitors)).toEqual([])
  })

  it('지표 일부만 가용해도(psr/ev_ebitda만) 해당 지표만 판정', () => {
    const competitors = [
      { is_self: true, per: null, pbr: null, psr: 3, ev_ebitda: 20 },
      { per: null, pbr: null, psr: 2, ev_ebitda: 10 },
      { per: null, pbr: null, psr: 4, ev_ebitda: 15 },
    ]
    const result = computePeerPremiums(competitors)
    expect(result.map((r) => r.metric).sort()).toEqual(['EV/EBITDA', 'PSR'])
    // PSR: self 3, peers median 3 → pct 0 → 할증
    expect(result.find((r) => r.metric === 'PSR')).toEqual({ metric: 'PSR', pct: 0, discount: false })
    // EV/EBITDA: self 20, peers median 12.5 → pct = (20/12.5-1)*100 = 60% 할증
    expect(result.find((r) => r.metric === 'EV/EBITDA')).toEqual({ metric: 'EV/EBITDA', pct: 60, discount: false })
  })

  it('is_self 행이 없으면 빈 배열', () => {
    const competitors = [{ per: 10 }, { per: 12 }]
    expect(computePeerPremiums(competitors)).toEqual([])
  })

  it('입력이 배열이 아니면(undefined 등) 빈 배열', () => {
    expect(computePeerPremiums(undefined)).toEqual([])
    expect(computePeerPremiums(null)).toEqual([])
  })
})

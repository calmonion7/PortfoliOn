import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MoatSection, GrowthPlanSection, RisksSection } from './Sections'

describe('빈 오브젝트 enrich 섹션 가드 (L1)', () => {
  it('MoatSection: moat={} 이면 헤더 미렌더', () => {
    render(<MoatSection moat={{}} />)
    expect(screen.queryByText('🏰 경제적 해자')).toBeNull()
  })

  it('GrowthPlanSection: growth_plan={} 이면 헤더 미렌더', () => {
    render(<GrowthPlanSection growth_plan={{}} />)
    expect(screen.queryByText('🌱 장기 성장 계획')).toBeNull()
  })

  it('RisksSection: risks={} 이면 헤더 미렌더', () => {
    render(<RisksSection risks={{}} />)
    expect(screen.queryByText('⚠️ 리스크')).toBeNull()
  })
})

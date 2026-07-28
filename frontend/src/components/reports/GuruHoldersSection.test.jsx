import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import GuruHoldersSection from './GuruHoldersSection'
import api from '../../api'

vi.mock('../../api', () => ({ default: { get: vi.fn() } }))

const BLURB = 'Investment Objective: The Fund seeks long-term capital appreciation...'

function mockManagers(managers) {
  api.get.mockResolvedValue({ data: { managers } })
}

beforeEach(() => { vi.clearAllMocks() })

describe('GuruHoldersSection 운용역·운용사 표기 (task#236 S2)', () => {
  it('운용역·운용사를 name에서 파생 — firm의 소개글은 표에 오지 않는다', async () => {
    mockManagers([
      { name: 'Alex Roepers - Atlantic Investment Management', firm: `Alex Roepers - Atlantic Investment Management ${BLURB}`,
        top10: [{ ticker: 'AAPL', rank: 1, weight_pct: 12.5 }] },
    ])
    const { container } = render(<GuruHoldersSection ticker="AAPL" market="US" />)
    expect(await screen.findByText('Alex Roepers')).toBeTruthy()
    expect(screen.getByText('Atlantic Investment Management')).toBeTruthy()
    expect(container.textContent).not.toContain('Investment Objective')
  })

  it('펀드만인 매니저는 운용사 칸이 "—" — 이름 칸과 같은 값이 반복되지 않는다', async () => {
    mockManagers([
      { name: 'AKO Capital', firm: 'AKO Capital', top10: [{ ticker: 'AAPL', rank: 3, weight_pct: 4.2 }] },
    ])
    const { container } = render(<GuruHoldersSection ticker="AAPL" market="US" />)
    await screen.findByText('AKO Capital')
    const cells = [...container.querySelectorAll('tbody tr td')].map(td => td.textContent)
    expect(cells[0]).toBe('AKO Capital')
    expect(cells[1]).toBe('—')
    expect(screen.getAllByText('AKO Capital').length).toBe(1)
  })
})

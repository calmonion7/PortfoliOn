import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import TechAnatomy from './TechAnatomy'
import { deriveAxes } from '../components/tech/techAnatomyUtils'
import api from '../api'

vi.mock('../api', () => ({ default: { get: vi.fn() } }))

// 축이 실재하는 판 — experts 축 1개가 뜬다.
const WITH_ANATOMY = {
  slug: 'smr', title: 'SMR, 원전의 다음 세대', published_date: '2026-08-03',
  players: [{ name: 'NuScale', tech_level: 4 }],
  composition: { experts: [{ name: '원자로 설계', share_pct: 60, leaders: ['NuScale'] }, { name: '인허가', share_pct: 40 }] },
}

// 발행물은 있으나 해부가 없는 판 — 빈 상태 분기를 탄다.
const WITHOUT_ANATOMY = { slug: 'smr', title: 'SMR, 원전의 다음 세대', published_date: '2026-08-03', players: [] }

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/tech-anatomy/smr']}>
      <Routes><Route path="/tech-anatomy/:slug" element={<TechAnatomy />} /></Routes>
    </MemoryRouter>,
  )
}

beforeEach(() => vi.clearAllMocks())

describe('TechAnatomy 우하단 목록복귀 pill = 정상 상태의 유일한 목록 경로 (task#309 S3)', () => {
  // fixed 좌표는 jsdom이 블라인드 — 여기선 렌더·링크 대상만 단언하고 위치(뷰포트 안인지)는
  // 라이브 프로브 ⓘ가 boundingBox로 검증한다(형제 GuruDetail.test.jsx와 같은 분업).
  const expectPill = (container) => {
    const pills = container.querySelectorAll('.list-pill')
    expect(pills).toHaveLength(1)          // 중복 렌더 방지 — 개수까지 못박는다
    expect(pills[0].getAttribute('href')).toBe('/tech-reports')
    expect(pills[0].textContent).toBe('☰ 목록')
  }

  it('축이 있는 판 — pill 1개', async () => {
    api.get.mockResolvedValue({ data: { reports: [WITH_ANATOMY] } })
    const { container } = renderPage()
    await screen.findByTestId('tech-anatomy')
    // 이 픽스처가 실제로 축 분기를 타는지 게이트 함수를 직접 적용해 못박는다(task#301 —
    // 이빨과 분기 커버리지는 다른 축이고, 전자가 후자의 알리바이가 되지 않는다).
    expect(deriveAxes(WITH_ANATOMY.composition).length).toBeGreaterThan(0)
    expectPill(container)
  })

  it('빈 상태(해부 미기입)에서도 pill 1개 — 같은 return 안이라 따라온다', async () => {
    api.get.mockResolvedValue({ data: { reports: [WITHOUT_ANATOMY] } })
    const { container } = renderPage()
    await screen.findByTestId('anatomy-empty')
    // 이 픽스처가 실제로 빈 상태 분기를 타는지 게이트 함수로 직접 단언한다.
    expect(deriveAxes(WITHOUT_ANATOMY.composition)).toEqual([])
    expectPill(container)
  })

  it('에러 상태엔 pill이 없고 기존 중앙 텍스트 링크가 그대로다 (TechReport 동형)', async () => {
    api.get.mockRejectedValue(new Error('network'))
    const { container } = renderPage()
    await waitFor(() => expect(screen.getByText('리포트를 불러오지 못했습니다.')).toBeTruthy())
    expect(container.querySelectorAll('.list-pill')).toHaveLength(0)
    const back = screen.getByText('← 주요기술 리포트로 돌아가기')
    expect(back.getAttribute('href')).toBe('/tech-reports')
  })
})

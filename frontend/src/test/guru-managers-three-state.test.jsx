/**
 * §7.4 — GuruManagers의 3상태: 「미조회 · 0건 · 실패」 (task#343 S4)
 *
 * **결함**: `/api/guru/managers` 조회에 `.catch`가 없어 실패가 초기값
 * `{ last_updated: null, managers: [] }`로 붕괴했다. 그러면 빈 상태 분기가 렌더되어
 *
 *     「데이터 없음 — 설정 > 구루 탭의 "즉시 크롤링"에서 데이터를 가져오세요.」
 *
 * 가 뜬다. 이건 단순한 거짓 진술을 넘어 **사용자에게 잘못된 행동을 지시**한다 — 크롤링은
 * 조회 실패를 고치지 못하므로, 사용자는 수 분짜리 크롤을 돌리고도 같은 화면을 다시 본다.
 * 형제 `pages/GuruStats.jsx`는 이미 「에러 분기가 빈 상태보다 먼저」로 닫혀 있고 그 이유를
 * 주석에 적어 두었다 — 이 파일은 그 형태를 그대로 이식한 것이다.
 *
 * 대조군을 쌍으로 두는 이유는 형제 파일과 같다: 음성 축만 두면 「항상 실패로 표시」라는
 * 과잉교정이 통과한다. 성공 + `managers: []`는 **사실**이므로 빈 상태가 그대로 나와야 한다.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, act } from '@testing-library/react'

const getMock = vi.fn()
vi.mock('../api', () => ({ default: { get: (...a) => getMock(...a), post: vi.fn() } }))
vi.mock('../hooks/useIsMobile', () => ({ default: () => false }))
vi.mock('../hooks/useTrackedStocks', () => ({
  default: () => ({ stockMap: {}, unknown: false, pending: {}, toggle: vi.fn() }),
}))

import { MemoryRouter } from 'react-router-dom'
import GuruManagers from '../pages/GuruManagers'

const renderPage = () => render(<MemoryRouter><GuruManagers /></MemoryRouter>)

const settle = async (fn) => {
  await act(async () => {
    if (fn) fn()
    await Promise.resolve()
    await new Promise(r => setTimeout(r, 25))
  })
}

beforeEach(() => {
  getMock.mockReset()
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

describe('구루 운용역 조회 실패는 「크롤링을 하라」고 지시하지 않는다', () => {
  it('ⓐ /api/guru/managers 실패 → 「즉시 크롤링」 오지시 대신 실패 문구가 렌더된다', async () => {
    getMock.mockRejectedValue(new Error('500 Internal Server Error'))
    await settle(renderPage)

    // 오지시가 이 결함의 핵심 — 크롤링은 조회 실패를 고치지 못한다.
    expect(screen.queryByText(/즉시 크롤링/)).toBeNull()
    expect(screen.queryByText(/데이터 없음/)).toBeNull()
    expect(screen.getByText(/불러오지 못했습니다/)).toBeTruthy()
  })

  it('ⓑ 대조군 — 성공 + managers:[] 이면 기존 빈 상태 안내가 **그대로** 렌더된다', async () => {
    getMock.mockResolvedValue({ data: { last_updated: null, managers: [] } })
    await settle(renderPage)

    // 조회에 성공한 0건은 사실이다. 여기서도 실패 문구를 띄우면 과잉교정이다.
    expect(screen.getByText(/즉시 크롤링/)).toBeTruthy()
    expect(screen.getByText(/데이터 없음/)).toBeTruthy()
    expect(screen.queryByText(/불러오지 못했습니다/)).toBeNull()
  })
})

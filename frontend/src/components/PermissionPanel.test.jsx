import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

// 기본권한 저장은 낙관적 토글(칩을 먼저 켜고 500ms 후 PUT)이라, 저장 실패 시
// 에러 토스트를 띄우고 서버 실제값을 재조회해 칩을 진실 상태로 되돌려야 한다.
const { showToastMock } = vi.hoisted(() => ({ showToastMock: vi.fn() }))
vi.mock('../api', () => ({ default: { get: vi.fn(), put: vi.fn() } }))
vi.mock('./Toast', () => ({ useToast: () => ({ showToast: showToastMock }) }))

import api from '../api'
import { DefaultPermissionsSection } from './PermissionPanel'

const ALL_OFF = { portfolio: false, research: false, market: false, guru: false, settings: false }

describe('DefaultPermissionsSection 저장 실패 피드백', () => {
  beforeEach(() => {
    api.get.mockReset()
    api.put.mockReset()
    showToastMock.mockReset()
  })

  it('저장 실패 시 에러 토스트 + 서버값 재조회로 낙관적 칩을 복구한다', async () => {
    // 초기 로드: 전부 off
    api.get.mockResolvedValueOnce({ data: { ...ALL_OFF } })
    render(<DefaultPermissionsSection />)
    await waitFor(() => expect(screen.getByText('종목관리')).not.toBeDisabled())

    // '종목관리'(portfolio) 토글 → 낙관적 on → 500ms 후 PUT 실패, 복구 GET은 서버 실제값(off)
    api.put.mockRejectedValueOnce(new Error('500'))
    api.get.mockResolvedValueOnce({ data: { ...ALL_OFF } })
    fireEvent.click(screen.getByText('종목관리'))

    // 실패 토스트가 error 타입으로 뜨고
    await waitFor(() =>
      expect(showToastMock).toHaveBeenCalledWith(expect.stringContaining('실패'), 'error'),
    )
    // 복구용 재조회(GET 2회째)가 서버 진실값을 다시 읽는다
    await waitFor(() => expect(api.get).toHaveBeenCalledTimes(2))
    expect(api.get).toHaveBeenLastCalledWith('/api/admin/default-permissions')
  })

  it('기본권한 GET 대기 중에는 칩이 비활성이고 클릭해도 PUT하지 않는다', async () => {
    api.get.mockReturnValueOnce(new Promise(() => {}))
    render(<DefaultPermissionsSection />)
    const chip = screen.getByText('종목관리')
    expect(chip).toBeDisabled()
    fireEvent.click(chip)
    await new Promise(r => setTimeout(r, 700))
    expect(api.put).not.toHaveBeenCalled()
  })

  it('GET 실패 시 칩은 비활성으로 남고 「불러오지 못했습니다」를 보여준다', async () => {
    api.get.mockRejectedValueOnce(new Error('500'))
    render(<DefaultPermissionsSection />)
    expect(await screen.findByText(/불러오지 못했습니다/)).toBeTruthy()
    expect(screen.getByText('종목관리')).toBeDisabled()
  })

  it('GET 성공 후 토글은 서버값 기준 목록에서 그 항목만 바꿔 PUT한다', async () => {
    const server = { ...ALL_OFF, research: true, guru: true }
    api.get.mockResolvedValueOnce({ data: server })
    api.put.mockResolvedValueOnce({})
    render(<DefaultPermissionsSection />)
    await waitFor(() => expect(screen.getByText('종목관리')).not.toBeDisabled())
    fireEvent.click(screen.getByText('종목관리'))
    await waitFor(() => expect(api.put).toHaveBeenCalledTimes(1), { timeout: 2000 })
    expect(api.put).toHaveBeenCalledWith('/api/admin/default-permissions', {
      permissions: { ...server, portfolio: true },
    })
  })
})

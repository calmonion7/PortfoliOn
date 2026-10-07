// task#379 S3 — SectorTab 마켓 토글 레이스(B49, S0 신규 N3).
//
// 토글은 로딩 중에도 보인다. US(마운트) 요청이 in-flight인 채 KR로 바꾸면, 늦게 착지한 US
// 응답이 KR 레이아웃(업종 헤더) 아래 S&P 섹터를 그리고, 옛 실패가 새 화면을 에러로 바꾼다.
// (이펙트가 진입 시 data를 null로 비우므로 보존 절반은 이미 성립한다.)
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'

vi.mock('../api', () => ({ default: { get: vi.fn() } }))
vi.mock('../hooks/useIsMobile', () => ({ default: () => false }))

import api from '../api'
import SectorTab from '../pages/SectorTab'

function deferred() {
  let resolve, reject
  const promise = new Promise((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}
const sec = (name) => ({ data: { sectors: [{ name, etf: '', return_1w: 1, return_1mo: 1, return_3mo: 1 }], portfolio_sectors: {} } })
const flush = () => act(() => new Promise((r) => setTimeout(r, 0)))

function mockMarkets(byMarket) {
  api.get.mockImplementation((url, config) => byMarket[config.params.market].promise)
}

beforeEach(() => { vi.clearAllMocks() })

describe('SectorTab — 마켓 토글 취소 가드', () => {
  it('옛 마켓 응답이 늦게 착지해도 새 마켓 표를 덮지 않는다', async () => {
    const us = deferred(); const kr = deferred()
    mockMarkets({ US: us, KR: kr })
    render(<SectorTab />)
    fireEvent.click(screen.getByText('🇰🇷 국내'))

    kr.resolve(sec('반도체업종'))
    await flush()
    us.resolve(sec('Technology'))   // 옛 마켓이 마지막에 착지
    await flush()
    expect(screen.getByText('반도체업종')).toBeInTheDocument()
    expect(screen.queryByText('Technology')).not.toBeInTheDocument()
  })

  it('옛 마켓 응답이 새 마켓 로딩 중에 착지해도 표를 그리지 않는다', async () => {
    const us = deferred(); const kr = deferred()
    mockMarkets({ US: us, KR: kr })
    render(<SectorTab />)
    fireEvent.click(screen.getByText('🇰🇷 국내'))

    us.resolve(sec('Technology'))   // 새 마켓(KR)은 아직 in-flight
    await flush()
    expect(screen.queryByText('Technology')).not.toBeInTheDocument()
  })

  it('옛 마켓 요청의 실패가 새 마켓 화면을 에러로 바꾸지 않는다', async () => {
    const us = deferred(); const kr = deferred()
    mockMarkets({ US: us, KR: kr })
    render(<SectorTab />)
    fireEvent.click(screen.getByText('🇰🇷 국내'))

    kr.resolve(sec('반도체업종'))
    await flush()
    us.reject(new Error('late'))
    await flush()
    expect(screen.queryByText(/오류:/)).not.toBeInTheDocument()
    expect(screen.getByText('반도체업종')).toBeInTheDocument()
  })
})

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

// task#347: 「휴장일 건너뛰기」 스위치는 exchange가 있는 배치(리포트 2종)에만 노출된다.
vi.mock('../api', () => ({ default: { put: vi.fn() } }))

import api from '../api'
import BatchScheduleEditor from './BatchScheduleEditor'

const BASE_SCHEDULE = { enabled: true, type: 'daily', time: '20:30' }

describe('BatchScheduleEditor 휴장일 건너뛰기 스위치', () => {
  beforeEach(() => {
    api.put.mockReset()
    api.put.mockResolvedValue({ data: {} })
  })

  it('exchange가 있으면 스위치와 거래소별 보조문구를 렌더한다', () => {
    render(<BatchScheduleEditor jobId="daily_report_kr" schedule={BASE_SCHEDULE} exchange="XKRX" />)
    expect(screen.getByTestId('skip-holidays-switch')).toBeInTheDocument()
    expect(screen.getByText('KRX 휴장일이면 건너뜁니다')).toBeInTheDocument()
  })

  it('XNYS는 미국 세션 기준 보조문구를 렌더한다', () => {
    render(<BatchScheduleEditor jobId="daily_report_us" schedule={BASE_SCHEDULE} exchange="XNYS" />)
    expect(screen.getByText('NYSE 휴장일이면 건너뜁니다 — 전날 미국 세션 기준')).toBeInTheDocument()
  })

  it('exchange가 없으면 스위치를 렌더하지 않는다', () => {
    render(<BatchScheduleEditor jobId="us_rankings_fetch" schedule={BASE_SCHEDULE} />)
    expect(screen.queryByTestId('skip-holidays-switch')).not.toBeInTheDocument()
  })

  it('스위치를 켜고 저장하면 PUT body에 skip_holidays:true가 실린다', async () => {
    render(<BatchScheduleEditor jobId="daily_report_us" schedule={BASE_SCHEDULE} exchange="XNYS" />)
    fireEvent.click(screen.getByTestId('skip-holidays-switch'))
    fireEvent.click(screen.getByText('저장'))
    await waitFor(() => expect(api.put).toHaveBeenCalledTimes(1))
    expect(api.put).toHaveBeenCalledWith(
      '/api/batches/daily_report_us/schedule',
      expect.objectContaining({ skip_holidays: true }),
    )
  })

  it('exchange 없는 배치는 저장 payload에 skip_holidays 키가 없다', async () => {
    render(<BatchScheduleEditor jobId="us_rankings_fetch" schedule={BASE_SCHEDULE} />)
    fireEvent.click(screen.getByText('저장'))
    await waitFor(() => expect(api.put).toHaveBeenCalledTimes(1))
    const body = api.put.mock.calls[0][1]
    expect(body).not.toHaveProperty('skip_holidays')
  })
})

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

vi.mock('../api', () => ({ default: { get: vi.fn(), post: vi.fn(), put: vi.fn() } }))

import api from '../api'
import { ManualRunButton } from './Settings'

const batch = { id: 'monthly_kr', manual_endpoint: '/api/market/refresh-monthly?market=KR' }

const clickRun = async () => {
  render(<ManualRunButton batch={batch} />)
  fireEvent.click(screen.getByText('지금 실행'))
  await waitFor(() => expect(screen.getByText('실행 요청됨')).toBeTruthy())
}

beforeEach(() => vi.clearAllMocks())

// 응답을 버리면 "갱신됨"과 "저장 생략·직전값 유지"가 화면에서 구별되지 않는다.
// job_runs는 예외가 없으면 스킵도 success로 기록하므로 실행이력으로도 못 가른다(task#243).
describe('배치 수동 실행 — 응답을 화면에 표시', () => {
  it('응답 필드를 key: value로 보여주고 ok는 감춘다', async () => {
    api.post.mockResolvedValue({ data: { ok: true, market: 'KR', export_points: 11, saved: true } })
    await clickRun()

    const box = screen.getByTestId('run-result')
    expect(box.textContent).toContain('export_points')
    expect(box.textContent).toContain('11')
    expect(box.textContent).toContain('saved')
    expect(box.textContent).toContain('true')
    expect(box.textContent).toContain('KR')
    // ok는 성공 응답에 항상 true라 정보가 없다
    expect(box.textContent).not.toContain('ok')
  })

  it('saved=false는 약한 값으로 강조된다 — 저장 생략을 초록으로 뭉개지 않는다', async () => {
    api.post.mockResolvedValue({ data: { ok: true, market: 'KR', export_points: 11, saved: false } })
    await clickRun()

    const box = screen.getByTestId('run-result')
    expect(box.textContent).toContain('false')
    const weak = [...box.querySelectorAll('b')].filter(b => b.style.color.includes('--warn'))
    expect(weak.length).toBe(1)
    expect(weak[0].textContent).toBe('false')
  })

  it('0도 약한 값이다 — index: 0은 역인덱스가 비었다는 신호', async () => {
    api.post.mockResolvedValue({ data: { ok: true, sectors: 24, index: 0 } })
    await clickRun()

    const weak = [...screen.getByTestId('run-result').querySelectorAll('b')]
      .filter(b => b.style.color.includes('--warn'))
    expect(weak.map(b => b.textContent)).toEqual(['0'])
  })

  it('비동기 배치의 message 문자열도 그대로 보여준다', async () => {
    api.post.mockResolvedValue({ data: { message: '컨센서스 수집/백필 시작: 168개 종목' } })
    await clickRun()
    expect(screen.getByTestId('run-result').textContent).toContain('168개 종목')
  })

  it('응답이 비면 결과 영역을 만들지 않는다', async () => {
    api.post.mockResolvedValue({ data: { ok: true } })
    await clickRun()
    expect(screen.queryByTestId('run-result')).toBeNull()
  })

  it('실패는 에러로 보이고 결과 영역은 없다', async () => {
    api.post.mockRejectedValue({ response: { data: { detail: 'KOFIA 키 없음' } } })
    render(<ManualRunButton batch={batch} />)
    fireEvent.click(screen.getByText('지금 실행'))
    expect(await screen.findByText('KOFIA 키 없음')).toBeTruthy()
    expect(screen.queryByTestId('run-result')).toBeNull()
    expect(screen.queryByText('실행 요청됨')).toBeNull()
  })

  it('재실행 시 이전 결과가 남지 않는다', async () => {
    api.post.mockResolvedValue({ data: { ok: true, export_points: 11, saved: true } })
    render(<ManualRunButton batch={batch} />)
    fireEvent.click(screen.getByText('지금 실행'))
    await waitFor(() => expect(screen.getByTestId('run-result').textContent).toContain('11'))

    api.post.mockRejectedValue({ response: { data: { detail: '실패' } } })
    fireEvent.click(screen.getByText('지금 실행'))
    await screen.findByText('실패')
    expect(screen.queryByTestId('run-result')).toBeNull()
  })
})

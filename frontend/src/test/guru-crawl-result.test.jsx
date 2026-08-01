// task#262 — 매뉴얼 구루 크롤의 저장 스킵·실패를 초록 "완료"와 구분한다.
//
// 옛 배선은 `!running && total>0 && done>=total`이면 무조건 초록 `완료: N명 …`을 띄웠다.
// 그래서 ① 빈 스크랩(save_guru_managers False → 저장 생략·직전값 유지)도 성공으로 보이고,
// ② 크롤이 초반에 죽으면 total=0이라 종료 조건이 **영영 발화하지 않아** 스피너만 돌았다.
// 판정축을 백엔드가 실어주는 result("saved"|"skipped"|"failed")로 옮긴 것을 여기서 고정한다.
// user-event는 미설치라 기존 테스트 관례대로 fireEvent를 쓴다.
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('../api', () => ({ default: { get: vi.fn(), post: vi.fn() } }))
vi.mock('../contexts/AuthContext', () => ({ useAuth: () => ({ role: 'admin' }) }))

import api from '../api'
import GuruCrawlNow from '../pages/GuruCrawlNow'

// 종료 상태 1종만 계속 돌려주는 진행 응답. `done`/`total`을 케이스마다 달리 줘서
// 옛 조건(done>=total)이 아니라 result가 판정축임을 드러낸다.
function stubProgress(progress) {
  api.get.mockImplementation((url) => {
    if (url === '/api/guru/crawl/progress') return Promise.resolve({ data: progress })
    return Promise.resolve({ data: { last_updated: '2026-08-01T09:00:00' } })
  })
  api.post.mockResolvedValue({ data: { message: 'Crawl started' } })
}

// 클릭 → (async 핸들러의 api.post await 해소) → 폴 1회 발화까지 진행시킨다.
async function clickCrawlAndPoll() {
  render(<GuruCrawlNow />)
  fireEvent.click(await screen.findByRole('button', { name: '지금 갱신' }))
  await vi.advanceTimersByTimeAsync(0)      // startPolling 등록
  await vi.advanceTimersByTimeAsync(2000)   // setInterval 1회 발화 + 콜백 await 해소
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true })
  api.get.mockReset()
  api.post.mockReset()
})
afterEach(() => vi.useRealTimers())

describe('GuruCrawlNow 크롤 결과 표시', () => {
  it('saved면 초록 완료 문구를 띄운다 (BH7-H1: 숫자는 done이 아니라 fresh)', async () => {
    // done=99는 함정 — 옛 배선은 시도 총계인 done을 표시했다. fresh(실제 갱신 건수)를 써야 한다.
    stubProgress({ running: false, done: 99, total: 99, current: '', result: 'saved', fresh: 83, stale: 0 })
    await clickCrawlAndPoll()
    const msg = await screen.findByTestId('crawl-msg')
    expect(msg).toHaveTextContent('완료: 83명 갱신됨')
    expect(msg).not.toHaveTextContent('99')
    expect(msg).toHaveStyle({ color: 'var(--color-success)' })
  })

  it('BH7-H1 — 부분 성공은 초록이 아니고, 갱신·유지 건수를 둘 다 밝힌다', async () => {
    // 옛 배선: result='saved' 초록 + "완료: 83명 매니저 데이터 수집됨"(= 시도 총계).
    // 40명만 저장됐는데 화면이 83을 초록으로 단언하던 것이 결함의 절반이었다.
    stubProgress({ running: false, done: 83, total: 83, current: '', result: 'partial', fresh: 40, stale: 43 })
    await clickCrawlAndPoll()
    const msg = await screen.findByTestId('crawl-msg')
    expect(msg).toHaveTextContent('40')
    expect(msg).toHaveTextContent('43')
    expect(msg).not.toHaveTextContent('83')
    expect(msg).not.toHaveStyle({ color: 'var(--color-success)' })
  })

  it('skipped면 초록이 아니라 경고로 "직전 데이터 유지"를 알린다', async () => {
    stubProgress({ running: false, done: 83, total: 83, current: '', result: 'skipped' })
    await clickCrawlAndPoll()
    const msg = await screen.findByTestId('crawl-msg')
    expect(msg).toHaveTextContent('수집 실패 — 직전 데이터 유지')
    expect(msg).not.toHaveStyle({ color: 'var(--color-success)' })
  })

  it('failed는 total=0이어도 폴링이 종료되고 경고가 뜬다 (무한 스피너 회귀 가드)', async () => {
    // 옛 조건 `total > 0 && done >= total`은 여기서 원리적으로 발화하지 않는다.
    stubProgress({ running: false, done: 0, total: 0, current: '', result: 'failed' })
    await clickCrawlAndPoll()
    const msg = await screen.findByTestId('crawl-msg')
    expect(msg).toHaveTextContent('크롤링 중단 — 직전 데이터 유지')
    expect(msg).not.toHaveStyle({ color: 'var(--color-success)' })
    await waitFor(() => expect(screen.getByRole('button', { name: '지금 갱신' })).toBeEnabled())
  })

  it('result가 아직 없으면(진행 중) 종료하지 않는다', async () => {
    stubProgress({ running: true, done: 40, total: 83, current: 'Buffett', result: null })
    await clickCrawlAndPoll()
    expect(screen.queryByTestId('crawl-msg')).toBeNull()
    expect(screen.getByRole('button', { name: '수집 중...' })).toBeDisabled()
  })
})
